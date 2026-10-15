import {
  GetItemCommand,
  TransactWriteItem,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import {
  AssignInitialProductRoleResponseSchema,
  type AssignInitialProductRoleRequest,
} from "@liass-ohada/shared/shared";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory as K } from "../key-builder";
import { AppError } from "../app-error";

const CommandSchema = z
  .object({
    PK: z.string(),
    SK: z.string(),
    entityType: z.literal("INITIAL_PRODUCT_ROLE_COMMAND"),
    orgId: z.string(),
    actorUserId: z.string(),
    fingerprint: z.string(),
    result: AssignInitialProductRoleResponseSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();
const AuditSchema = z
  .object({
    PK: z.string(),
    SK: z.string(),
    entityType: z.literal("PRODUCT_ROLE_ASSIGNMENT_AUDIT"),
    orgId: z.string(),
    actorUserId: z.string(),
    targetUserId: z.string(),
    action: z.literal("ASSIGN_INITIAL_PRODUCT_ROLE"),
    productCode: z.literal("RESTAURANTS"),
    before: z.null(),
    after: AssignInitialProductRoleResponseSchema.shape.role,
    createdAt: z.iso.datetime(),
  })
  .strict();

export class InitialProductRoleRepository {
  private static async read(orgId: string, SK: string) {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.PLATFORM_TABLE_NAME,
        Key: marshall({ PK: K.orgKey(orgId), SK }),
        ConsistentRead: true,
      }),
    );
    if (!result.Item) return undefined;
    const row = unmarshall(result.Item);
    if (row.PK !== K.orgKey(orgId) || row.SK !== SK || row.orgId !== orgId)
      throw new AppError(403, "ERROR_ORG_ACCESS_DENIED");
    return row;
  }
  static async target(orgId: string, userId: string) {
    const row = await this.read(orgId, K.orgUserAccessSK(userId));
    if (
      !row ||
      row.entityType !== "USER_ORG_ACCESS" ||
      row.userId !== userId ||
      row.status !== "ACTIVE" ||
      row.workspaceType !== "COMPANY" ||
      (row.accessSource !== undefined && row.accessSource !== "DIRECT")
    )
      throw new AppError(403, "ERROR_ORG_ACCESS_DENIED");
    if (
      row.productRoles !== undefined &&
      !z.record(z.string(), z.unknown()).safeParse(row.productRoles).success
    )
      throw new AppError(409, "PLATFORM_PRODUCT_ROLE_CONFLICT");
    return row;
  }
  static async replay(
    orgId: string,
    actorUserId: string,
    requestId: string,
    fingerprint: string,
  ) {
    const row = await this.read(
      orgId,
      K.organizationProductRoleCommandSK(requestId),
    );
    if (!row) return undefined;
    const parsed = CommandSchema.safeParse(row);
    if (!parsed.success) throw new AppError(500, "ERROR_INTERNAL_SERVER");
    const command = parsed.data;
    if (
      command.actorUserId !== actorUserId ||
      command.fingerprint !== fingerprint
    )
      throw new AppError(409, "PLATFORM_PRODUCT_ROLE_IDEMPOTENCY_CONFLICT");
    return command.result;
  }
  static async commit(
    orgId: string,
    actorUserId: string,
    request: AssignInitialProductRoleRequest,
    target: Record<string, unknown>,
    fingerprint: string,
  ) {
    const table = config.PLATFORM_TABLE_NAME;
    const PK = K.orgKey(orgId);
    const now = new Date().toISOString();
    const result = AssignInitialProductRoleResponseSchema.parse({
      userId: request.memberUserId,
      productCode: request.productCode,
      role: request.role,
    });
    const current = (
      target.productRoles as Record<string, unknown> | undefined
    )?.[request.productCode];
    if (current !== undefined && current !== request.role)
      throw new AppError(409, "PLATFORM_PRODUCT_ROLE_CONFLICT");
    const memberCheck = (userId: string, owner: boolean) => ({
      TableName: table,
      Key: marshall({ PK, SK: K.orgUserAccessSK(userId) }),
      ConditionExpression:
        "entityType = :member AND orgId = :org AND userId = :user AND #status = :active AND workspaceType = :company AND (attribute_not_exists(accessSource) OR accessSource = :direct)" +
        (owner ? " AND #role = :owner" : ""),
      ExpressionAttributeNames: {
        "#status": "status",
        ...(owner ? { "#role": "role" } : {}),
      },
      ExpressionAttributeValues: marshall({
        ":member": "USER_ORG_ACCESS",
        ":org": orgId,
        ":user": userId,
        ":active": "ACTIVE",
        ":company": "COMPANY",
        ":direct": "DIRECT",
        ...(owner ? { ":owner": "OWNER" } : {}),
      }),
    });
    const actions: TransactWriteItem[] = [
      {
        ConditionCheck: {
          TableName: table,
          Key: marshall({ PK, SK: K.organizationSK() }),
          ConditionExpression:
            "entityType = :type AND orgId = :org AND workspaceType = :company AND #status = :active",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: marshall({
            ":type": "ORGANIZATION",
            ":org": orgId,
            ":company": "COMPANY",
            ":active": "ACTIVE",
          }),
        },
      },
      {
        ConditionCheck: {
          TableName: table,
          Key: marshall({ PK, SK: K.productAccessSK(request.productCode) }),
          ConditionExpression:
            "entityType = :type AND orgId = :org AND productCode = :product AND #status = :active",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: marshall({
            ":type": "PRODUCT_ACCESS",
            ":org": orgId,
            ":product": request.productCode,
            ":active": "ACTIVE",
          }),
        },
      },
    ];
    if (actorUserId !== request.memberUserId)
      actions.push({ ConditionCheck: memberCheck(actorUserId, true) });
    const guard = memberCheck(
      request.memberUserId,
      actorUserId === request.memberUserId,
    );
    const names = {
      ...guard.ExpressionAttributeNames,
      "#roles": "productRoles",
      "#product": request.productCode,
    };
    const values = {
      ...guard.ExpressionAttributeValues,
      ...marshall({ ":assigned": request.role }),
    };
    if (current !== undefined) {
      actions.push({
        ConditionCheck: {
          ...guard,
          ConditionExpression:
            guard.ConditionExpression + " AND #roles.#product = :assigned",
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        },
      });
    } else {
      const mapAbsent = target.productRoles === undefined;
      const updateNames = mapAbsent ? guard.ExpressionAttributeNames : names;
      actions.push({
        Update: {
          ...guard,
          ConditionExpression:
            guard.ConditionExpression +
            (mapAbsent
              ? " AND attribute_not_exists(productRoles)"
              : " AND attribute_not_exists(#roles.#product)"),
          UpdateExpression:
            (mapAbsent
              ? "SET productRoles = :initial"
              : "SET #roles.#product = :assigned") +
            ", updatedAt = :now, updatedBy = :actor",
          ExpressionAttributeNames: updateNames,
          ExpressionAttributeValues: {
            ...guard.ExpressionAttributeValues,
            ...marshall({
              ...(mapAbsent
                ? { ":initial": { [request.productCode]: request.role } }
                : { ":assigned": request.role }),
              ":now": now,
              ":actor": actorUserId,
            }),
          },
        },
      });
      actions.push({
        Put: {
          TableName: table,
          Item: marshall(
            AuditSchema.parse({
              PK,
              SK: K.organizationProductRoleAuditSK(
                now,
                request.clientRequestId,
              ),
              entityType: "PRODUCT_ROLE_ASSIGNMENT_AUDIT",
              orgId,
              actorUserId,
              targetUserId: request.memberUserId,
              action: "ASSIGN_INITIAL_PRODUCT_ROLE",
              productCode: request.productCode,
              before: null,
              after: request.role,
              createdAt: now,
            }),
          ),
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        },
      });
    }
    actions.push({
      Put: {
        TableName: table,
        Item: marshall(
          CommandSchema.parse({
            PK,
            SK: K.organizationProductRoleCommandSK(request.clientRequestId),
            entityType: "INITIAL_PRODUCT_ROLE_COMMAND",
            orgId,
            actorUserId,
            fingerprint,
            result,
            createdAt: now,
          }),
        ),
        ConditionExpression:
          "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      },
    });
    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: actions }),
    );
    if (current === undefined)
      console.info("[PLATFORM_PRODUCT_ROLE_AUDIT]", {
        action: "ASSIGN_INITIAL_PRODUCT_ROLE",
        orgId,
        actorUserId,
        targetUserId: request.memberUserId,
        productCode: request.productCode,
        before: null,
        after: request.role,
        timestamp: now,
      });
    return result;
  }
}
