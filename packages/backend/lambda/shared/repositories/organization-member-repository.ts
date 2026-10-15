import { createHash } from "crypto";
import {
  AttributeValue,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import {
  OrganizationAccessStatusSchema,
  type ListOrganizationMembersRequest,
} from "@liass-ohada/shared/shared";
import { AppError } from "../app-error";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory as K } from "../key-builder";

// Persistence projection only. Never serialize membership rows as public DTOs.
const MembershipProjectionSchema = z.object({
  PK: z.string(),
  SK: z.string(),
  entityType: z.literal("USER_ORG_ACCESS"),
  orgId: z.string().min(1),
  userId: z.string().min(1).max(256),
  status: OrganizationAccessStatusSchema,
  workspaceType: z.enum(["COMPANY", "ACCOUNTING_FIRM"]),
  accessSource: z.string().optional(),
});

export class OrganizationMemberRepository {
  static async requireActiveCompany(orgId: string): Promise<void> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.PLATFORM_TABLE_NAME,
        Key: marshall({ PK: K.orgKey(orgId), SK: K.organizationSK() }),
        ConsistentRead: true,
      }),
    );
    const row = result.Item ? unmarshall(result.Item) : undefined;
    if (
      !row ||
      row.PK !== K.orgKey(orgId) ||
      row.SK !== K.organizationSK() ||
      row.entityType !== "ORGANIZATION" ||
      row.orgId !== orgId ||
      row.workspaceType !== "COMPANY" ||
      row.status !== "ACTIVE"
    )
      throw new AppError(403, "ERROR_ORG_ACCESS_DENIED");
  }

  static async list(
    orgId: string,
    actorUserId: string,
    request: ListOrganizationMembersRequest,
  ) {
    const PK = K.orgKey(orgId);
    const prefix = K.orgUserAccessPrefix();
    // Follow the existing scoped base64url cursor convention; never accept client keys.
    const scope = createHash("sha256")
      .update(
        JSON.stringify([
          "company-members-v1",
          orgId,
          actorUserId,
          prefix,
          request.limit,
        ]),
      )
      .digest("hex");
    const position = z
      .object({ scope: z.literal(scope), userId: z.string().min(1).max(256) })
      .strict();
    let start: Record<string, AttributeValue> | undefined;
    if (request.cursor) {
      try {
        const decoded = position.parse(
          JSON.parse(Buffer.from(request.cursor, "base64url").toString("utf8")),
        );
        start = marshall({ PK, SK: K.orgUserAccessSK(decoded.userId) });
      } catch {
        throw new AppError(400, "ERROR_INVALID_CURSOR");
      }
    }
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.PLATFORM_TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: marshall({ ":pk": PK, ":prefix": prefix }),
        Limit: request.limit,
        ExclusiveStartKey: start,
        ConsistentRead: true,
        ScanIndexForward: true,
      }),
    );
    const items = (result.Items ?? [])
      .map((raw) => {
        const parsed = MembershipProjectionSchema.safeParse(unmarshall(raw));
        if (
          !parsed.success ||
          parsed.data.PK !== PK ||
          parsed.data.orgId !== orgId ||
          parsed.data.SK !== K.orgUserAccessSK(parsed.data.userId)
        )
          throw new AppError(500, "ERROR_INTERNAL_SERVER");
        return parsed.data;
      })
      .filter(
        (row) =>
          row.workspaceType === "COMPANY" &&
          (row.accessSource === undefined || row.accessSource === "DIRECT"),
      );
    let nextCursor: string | undefined;
    if (result.LastEvaluatedKey) {
      const last = unmarshall(result.LastEvaluatedKey);
      if (
        last.PK !== PK ||
        typeof last.SK !== "string" ||
        !last.SK.startsWith(prefix)
      )
        throw new AppError(500, "ERROR_INTERNAL_SERVER");
      const userId = position.shape.userId.parse(last.SK.slice(prefix.length));
      nextCursor = Buffer.from(JSON.stringify({ scope, userId })).toString(
        "base64url",
      );
    }
    return { items, nextCursor };
  }
}
