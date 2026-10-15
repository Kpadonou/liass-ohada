import { restaurantBatchRead } from "./restaurant-batch-read";
import { createHash } from "crypto";
import {
  AttributeValue,
  GetItemCommand,
  QueryCommand,
  TransactWriteItem,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import {
  RestaurantsListRequest,
  RestaurantIdSchema,
  RestaurantStaffUserIdSchema,
} from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { AppError } from "@/lambda/shared/app-error";
import { restaurantsTableName } from "./restaurant-storage";
import {
  StaffDataSchemas,
  staffEntityTypes,
  StaffKey,
  StaffKind,
  StaffRowSchema,
} from "./staff-model";

type Data<T extends StaffKind> = z.infer<(typeof StaffDataSchemas)[T]>;
const integrity = () => new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
export class RestaurantStaffRepository {
  static staffKey(orgId: string, userId: string): StaffKey {
    return { PK: K.orgKey(orgId), SK: K.restaurantStaffSK(userId) };
  }
  static assignmentKeys(
    orgId: string,
    userId: string,
    outletId: string,
  ): StaffKey[] {
    return [
      K.restaurantStaffOutletSK(userId, outletId),
      K.restaurantOutletStaffSK(outletId, userId),
    ].map((SK) => ({ PK: K.orgKey(orgId), SK }));
  }
  static decode<T extends StaffKind>(
    orgId: string,
    key: StaffKey,
    kind: T,
    raw: Record<string, AttributeValue>,
  ): Data<T> {
    const row = StaffRowSchema.safeParse(unmarshall(raw));
    if (
      !row.success ||
      row.data.orgId !== orgId ||
      row.data.PK !== key.PK ||
      row.data.SK !== key.SK ||
      row.data.entityType !== staffEntityTypes[kind]
    )
      throw integrity();
    const value = StaffDataSchemas[kind].safeParse(row.data.data);
    if (!value.success) throw integrity();
    if (
      kind === "STAFF" &&
      "userId" in value.data &&
      key.SK !== K.restaurantStaffSK(value.data.userId)
    )
      throw integrity();
    if (
      kind === "ASSIGNMENT" &&
      "outletId" in value.data &&
      value.data.outletId &&
      "userId" in value.data &&
      !this.assignmentKeys(orgId, value.data.userId, value.data.outletId).some(
        (candidate) => candidate.PK === key.PK && candidate.SK === key.SK,
      )
    )
      throw integrity();
    return value.data as Data<T>;
  }
  static async get<T extends StaffKind>(
    orgId: string,
    key: StaffKey,
    kind: T,
  ): Promise<Data<T> | undefined> {
    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: restaurantsTableName(),
        Key: marshall(key),
        ConsistentRead: true,
      }),
    );
    return response.Item
      ? this.decode(orgId, key, kind, response.Item)
      : undefined;
  }
  static async batch<T extends "STAFF" | "ASSIGNMENT">(
    orgId: string,
    keys: StaffKey[],
    kind: T,
  ): Promise<(Data<T> | undefined)[]> {
    const raw = await restaurantBatchRead(keys);
    return raw.map((item, index) =>
      item ? this.decode(orgId, keys[index], kind, item) : undefined,
    );
  }
  static put<T extends StaffKind>(
    orgId: string,
    key: StaffKey,
    kind: T,
    data: Data<T>,
    previousVersion?: number,
  ): TransactWriteItem {
    const row = StaffRowSchema.parse({
      ...key,
      orgId,
      schemaVersion: 1,
      entityType: staffEntityTypes[kind],
      data: StaffDataSchemas[kind].parse(data),
    });
    return {
      Put: {
        TableName: restaurantsTableName(),
        Item: marshall(row, { removeUndefinedValues: true }),
        ...(previousVersion === undefined
          ? {
              ConditionExpression:
                "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            }
          : {
              ConditionExpression:
                "entityType = :type AND orgId = :org AND #data.#version = :version",
              ExpressionAttributeNames: {
                "#data": "data",
                "#version": "version",
              },
              ExpressionAttributeValues: marshall({
                ":type": staffEntityTypes[kind],
                ":org": orgId,
                ":version": previousVersion,
              }),
            }),
      },
    };
  }
  static async commit(actions: TransactWriteItem[]) {
    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({ TransactItems: actions }),
      );
    } catch (error) {
      if (
        [
          "TransactionCanceledException",
          "ConditionalCheckFailedException",
        ].includes((error as Error).name)
      )
        throw new AppError(409, "RESTAURANTS_WRITE_CONFLICT");
      throw error;
    }
  }
  static async list<T extends "STAFF" | "ASSIGNMENT">(
    orgId: string,
    scopeIds: { userId?: string; outletId?: string },
    kind: T,
    input: RestaurantsListRequest,
  ) {
    const prefix =
      kind === "STAFF"
        ? K.restaurantStaffPrefix()
        : scopeIds.userId
          ? K.restaurantStaffOutletPrefix(scopeIds.userId)
          : K.restaurantOutletStaffPrefix(scopeIds.outletId!);
    const keyFor = (suffix: string): StaffKey =>
      kind === "STAFF"
        ? this.staffKey(orgId, suffix)
        : scopeIds.userId
          ? this.assignmentKeys(orgId, scopeIds.userId, suffix)[0]
          : this.assignmentKeys(orgId, suffix, scopeIds.outletId!)[1];
    const PK = K.orgKey(orgId);
    const scope = createHash("sha256")
      .update(JSON.stringify([orgId, prefix, kind]))
      .digest("hex");
    const position = z
      .object({
        scope: z.literal(scope),
        suffix: scopeIds.userId
          ? RestaurantIdSchema
          : RestaurantStaffUserIdSchema,
      })
      .strict();
    let start: Record<string, AttributeValue> | undefined;
    if (input.cursor) {
      try {
        const value = position.parse(
          JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")),
        );
        start = marshall(keyFor(value.suffix));
      } catch {
        throw new AppError(400, "ERROR_INVALID_CURSOR");
      }
    }
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: restaurantsTableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: marshall({ ":pk": PK, ":prefix": prefix }),
        Limit: input.limit,
        ExclusiveStartKey: start,
        ConsistentRead: true,
        ScanIndexForward: true,
      }),
    );
    const items = (result.Items ?? []).map((raw) => {
      const key = unmarshall(raw);
      if (
        key.PK !== PK ||
        typeof key.SK !== "string" ||
        !key.SK.startsWith(prefix)
      )
        throw integrity();
      return this.decode(orgId, { PK, SK: key.SK }, kind, raw);
    });
    let nextCursor: string | undefined;
    if (result.LastEvaluatedKey) {
      const last = unmarshall(result.LastEvaluatedKey);
      if (
        last.PK !== PK ||
        typeof last.SK !== "string" ||
        !last.SK.startsWith(prefix)
      )
        throw integrity();
      const suffix = position.shape.suffix.parse(last.SK.slice(prefix.length));
      nextCursor = Buffer.from(JSON.stringify({ scope, suffix })).toString(
        "base64url",
      );
    }
    return { items, nextCursor };
  }
}
