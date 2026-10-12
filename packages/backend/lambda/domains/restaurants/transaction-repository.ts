import {
  AttributeValue,
  GetItemCommand,
  QueryCommand,
  TransactWriteItem,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { createHash } from "crypto";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { restaurantsTableName } from "./restaurant-storage";
import {
  TransactionData,
  TransactionKey,
  TransactionKind,
  TransactionRow,
  TransactionSchemas,
  TransactionScope,
} from "./transaction-model";

export function transactionFingerprint(value: unknown): string {
  const normalize = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(normalize)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, normalize(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(normalize(value)))
    .digest("hex");
}
export class RestaurantTransactionsRepository {
  static row(
    scope: TransactionScope,
    key: TransactionKey,
    kind: TransactionKind,
    data: TransactionData,
  ): TransactionRow {
    if (
      !key.PK.startsWith(
        K.restaurantTransactionScope(scope.orgId, scope.outletId) + "#",
      )
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    return TransactionSchemas[kind].parse({
      ...key,
      orgId: scope.orgId,
      outletId: scope.outletId,
      schemaVersion: 1,
      entityType: TransactionSchemas[kind].shape.entityType.value,
      data,
    });
  }
  static decode(
    scope: TransactionScope,
    key: TransactionKey,
    kind: TransactionKind,
    raw: Record<string, AttributeValue>,
  ): TransactionRow {
    if (
      !key.PK.startsWith(
        K.restaurantTransactionScope(scope.orgId, scope.outletId) + "#",
      )
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    const row = TransactionSchemas[kind].safeParse(unmarshall(raw));
    if (
      !row.success ||
      row.data.orgId !== scope.orgId ||
      row.data.outletId !== scope.outletId ||
      row.data.PK !== key.PK ||
      row.data.SK !== key.SK
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    const data = row.data.data;
    if (
      "orgId" in data &&
      (data.orgId !== scope.orgId || data.outletId !== scope.outletId)
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    if (
      "result" in data &&
      (data.result.orgId !== scope.orgId ||
        data.result.outletId !== scope.outletId)
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    if (
      kind === "SESSION" &&
      "guestSessionId" in data &&
      key.PK !==
        K.restaurantSessionPK(scope.orgId, scope.outletId, data.guestSessionId!)
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    if (
      kind === "ORDER" &&
      "orderId" in data &&
      key.PK !== K.restaurantOrderPK(scope.orgId, scope.outletId, data.orderId)
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    if (
      kind === "LINE" &&
      "itemId" in data &&
      (key.PK !==
        K.restaurantOrderPK(scope.orgId, scope.outletId, data.orderId) ||
        key.SK !== K.restaurantOrderItemSK(data.itemId))
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    if ("targetId" in data && "timestamp" in data) {
      if (
        (kind === "SESSION_ORDER" || kind === "OPEN_SESSION_ORDER") &&
        (!data.guestSessionId ||
          key.PK !==
            K.restaurantSessionPK(
              scope.orgId,
              scope.outletId,
              data.guestSessionId,
            ))
      )
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      const expectedSK =
        kind === "SESSION_ORDER" || kind === "OPEN_SESSION_ORDER"
          ? K.restaurantSessionOrderSK(
              data.timestamp,
              data.targetId,
              kind === "OPEN_SESSION_ORDER",
            )
          : K.restaurantTransactionLocatorSK(data.timestamp, data.targetId);
      if (key.SK !== expectedSK)
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      if (
        (kind.includes("SESSION") &&
          !kind.endsWith("ORDER") &&
          data.targetKind !== "SESSION") ||
        ((kind.includes("ORDER") || kind === "UNPAID" || kind === "WAITER") &&
          data.targetKind !== "ORDER")
      )
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    }
    return row.data;
  }
  static async get(
    scope: TransactionScope,
    key: TransactionKey,
    kind: TransactionKind,
  ): Promise<TransactionRow | undefined> {
    if (
      !key.PK.startsWith(
        K.restaurantTransactionScope(scope.orgId, scope.outletId) + "#",
      )
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: restaurantsTableName(),
        Key: marshall(key),
        ConsistentRead: true,
      }),
    );
    return result.Item ? this.decode(scope, key, kind, result.Item) : undefined;
  }
  static put(
    row: TransactionRow,
    previous?: TransactionRow,
  ): TransactWriteItem {
    return {
      Put: {
        TableName: restaurantsTableName(),
        Item: marshall(row, { removeUndefinedValues: true }),
        ...(previous
          ? this.conditions(previous)
          : {
              ConditionExpression:
                "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            }),
      },
    };
  }
  static conditions(row: TransactionRow) {
    const version = "version" in row.data ? row.data.version : undefined;
    return {
      ConditionExpression:
        "entityType = :type AND orgId = :org AND outletId = :out" +
        (version === undefined ? "" : " AND #data.#version = :version"),
      ExpressionAttributeNames:
        version === undefined
          ? undefined
          : { "#data": "data", "#version": "version" },
      ExpressionAttributeValues: marshall({
        ":type": row.entityType,
        ":org": row.orgId,
        ":out": row.outletId,
        ...(version === undefined ? {} : { ":version": version }),
      }),
    };
  }
  static remove(row: TransactionRow): TransactWriteItem {
    if (
      ![
        "RESTAURANT_TABLE_OCCUPANCY",
        "RESTAURANT_ACTIVE_SESSION",
        "RESTAURANT_ACTIVE_ORDER",
        "RESTAURANT_UNPAID_ORDER",
        "RESTAURANT_WAITER_ORDER",
        "RESTAURANT_OPEN_SESSION_ORDER",
      ].includes(row.entityType)
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_STATE");
    const ownership =
      "targetId" in row.data
        ? "targetId"
        : "guestSessionId" in row.data
          ? "guestSessionId"
          : undefined;
    const conditions = this.conditions(row);
    return {
      Delete: {
        TableName: restaurantsTableName(),
        Key: marshall({ PK: row.PK, SK: row.SK }),
        ...conditions,
        ConditionExpression:
          conditions.ConditionExpression +
          (ownership ? ` AND #data.#owner = :owner` : ""),
        ExpressionAttributeNames: {
          ...conditions.ExpressionAttributeNames,
          ...(ownership ? { "#data": "data", "#owner": ownership } : {}),
        },
        ExpressionAttributeValues: {
          ...conditions.ExpressionAttributeValues,
          ...(ownership
            ? marshall({
                ":owner": (row.data as Record<string, unknown>)[ownership],
              })
            : {}),
        },
      },
    };
  }
  static async commit(actions: TransactWriteItem[]): Promise<void> {
    const actualKeys = actions.map((a) => {
      const k = a.Put?.Item ?? a.Delete?.Key ?? a.ConditionCheck?.Key;
      return JSON.stringify([k?.PK, k?.SK]);
    });
    if (
      !actions.length ||
      actions.length > 90 ||
      new Set(actualKeys).size !== actions.length ||
      Buffer.byteLength(JSON.stringify(actions), "utf8") > 3 * 1024 * 1024 ||
      actions.some(
        (a) =>
          a.Put &&
          Buffer.byteLength(JSON.stringify(a.Put.Item), "utf8") >= 350 * 1024,
      )
    )
      throw new AppError(400, "RESTAURANTS_TRANSACTION_LIMIT");
    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: actions }),
    );
  }
  static async query(
    scope: TransactionScope,
    pk: string,
    prefix: string,
    kind: TransactionKind,
    input: { limit: number; cursor?: string; direction?: "ASC" | "DESC" },
    extraScope: unknown = null,
    range?: { start: string; end: string },
  ): Promise<{ rows: TransactionRow[]; nextCursor?: string }> {
    if (
      !pk.startsWith(
        K.restaurantTransactionScope(scope.orgId, scope.outletId) + "#",
      ) ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    )
      throw new AppError(400, "ERROR_INVALID_CURSOR");
    const digest = transactionFingerprint([
      { orgId: scope.orgId, outletId: scope.outletId },
      pk,
      prefix,
      kind,
      extraScope,
      input.direction ?? "ASC",
    ]);
    let start: Record<string, AttributeValue> | undefined;
    const cursorSK = (id: string, timestamp?: string) => {
      if (kind === "LINE") {
        if (timestamp) throw new Error("Unexpected cursor timestamp");
        return K.restaurantOrderItemSK(id);
      }
      if (!timestamp) throw new Error("Missing cursor timestamp");
      if (kind === "SESSION_ORDER" || kind === "OPEN_SESSION_ORDER")
        return K.restaurantSessionOrderSK(
          timestamp,
          id,
          kind === "OPEN_SESSION_ORDER",
        );
      if (kind === "AUDIT")
        return K.restaurantTransactionAuditSK(timestamp, id);
      return K.restaurantTransactionLocatorSK(timestamp, id);
    };
    if (input.cursor) {
      try {
        const cursor = z
          .object({
            scope: z.literal(digest),
            id: z.string().uuid(),
            timestamp: z.string().datetime().optional(),
          })
          .strict()
          .parse(
            JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")),
          );
        const sk = cursorSK(cursor.id, cursor.timestamp);
        if (
          !sk.startsWith(prefix) ||
          (range && (sk < range.start || sk >= range.end))
        )
          throw Error();
        start = marshall({ PK: pk, SK: sk });
      } catch {
        throw new AppError(400, "ERROR_INVALID_CURSOR");
      }
    }
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: restaurantsTableName(),
        KeyConditionExpression: range
          ? "PK = :pk AND SK BETWEEN :start AND :end"
          : "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: marshall(
          range
            ? {
                ":pk": pk,
                ":start": K.restaurantTransactionTimeBoundSK(range.start),
                ":end": K.restaurantTransactionTimeBoundSK(range.end),
              }
            : { ":pk": pk, ":prefix": prefix },
        ),
        ConsistentRead: true,
        ScanIndexForward: input.direction !== "DESC",
        Limit: input.limit,
        ExclusiveStartKey: start,
      }),
    );
    const rows = (result.Items ?? []).map((raw) => {
      const k = unmarshall(raw);
      if (k.PK !== pk || typeof k.SK !== "string" || !k.SK.startsWith(prefix))
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      return this.decode(scope, { PK: pk, SK: k.SK }, kind, raw);
    });
    let nextCursor: string | undefined;
    if (result.LastEvaluatedKey) {
      const k = unmarshall(result.LastEvaluatedKey);
      if (k.PK !== pk || typeof k.SK !== "string" || !k.SK.startsWith(prefix))
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      const logical = k.SK.slice(prefix.length);
      let id: string, timestamp: string | undefined;
      try {
        id = z
          .string()
          .uuid()
          .parse(kind === "LINE" ? logical : logical.slice(25));
        timestamp = kind === "LINE" ? undefined : logical.slice(0, 24);
        if (cursorSK(id, timestamp) !== k.SK)
          throw new Error("Invalid cursor position");
      } catch {
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      }
      nextCursor = Buffer.from(
        JSON.stringify({ scope: digest, id, timestamp }),
      ).toString("base64url");
    }
    return { rows, nextCursor };
  }
}
