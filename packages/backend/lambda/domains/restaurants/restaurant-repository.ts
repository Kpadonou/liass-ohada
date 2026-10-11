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
  RestaurantIdSchema,
  RestaurantTableQrResponseSchema,
  RestaurantsListRequest,
} from "@liass-ohada/shared/restaurants";
import { AppError } from "@/lambda/shared/app-error";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { restaurantsTableName } from "./restaurant-storage";
import { KeyFactory } from "@/lambda/shared/key-builder";
import {
  collectionPrefix,
  entitySchemas,
  entitySK,
  entityTypes,
  RestaurantEntities,
  RestaurantKind,
  RestaurantParents,
} from "./restaurant-model";

const StoredConfigurationSchema = z
  .object({
    PK: z.string(),
    SK: z.string(),
    orgId: z.string().min(1),
    entityType: z.string(),
    createFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    data: z.unknown(),
    qrToken: RestaurantTableQrResponseSchema.shape.token.optional(),
  })
  .strict();
const QrLookupSchema = z
  .object({
    PK: z.string(),
    SK: z.string(),
    entityType: z.literal("RESTAURANT_TABLE_QR"),
    orgId: z.string().min(1),
    restaurantId: RestaurantIdSchema,
    outletId: RestaurantIdSchema,
    serviceAreaId: RestaurantIdSchema,
    tableId: RestaurantIdSchema,
  })
  .strict();
export interface RestaurantSnapshot<K extends RestaurantKind = RestaurantKind> {
  kind: K;
  parents: RestaurantParents;
  data: RestaurantEntities[K];
  createFingerprint: string;
  qrToken?: string;
}
export interface ParentCheck {
  snapshot: RestaurantSnapshot;
  requireActive: boolean;
}
const key = (
  orgId: string,
  kind: RestaurantKind,
  parents: RestaurantParents,
  id?: string,
) => ({
  PK: { S: KeyFactory.orgKey(orgId) },
  SK: { S: entitySK(kind, parents, id) },
});
const qrKey = (token: string) => ({
  PK: {
    S: KeyFactory.restaurantQrPK(
      createHash("sha256").update(token).digest("hex"),
    ),
  },
  SK: { S: KeyFactory.restaurantQrSK() },
});
const stored = (orgId: string, snapshot: RestaurantSnapshot) =>
  StoredConfigurationSchema.parse({
    ...unmarshall(
      key(orgId, snapshot.kind, snapshot.parents, snapshot.data.id),
    ),
    entityType: entityTypes[snapshot.kind],
    orgId,
    data: snapshot.data,
    createFingerprint: snapshot.createFingerprint,
    qrToken: snapshot.qrToken,
  });
const writeCondition = (snapshot: RestaurantSnapshot) => ({
  ConditionExpression:
    "#type = :type AND #org = :org AND #data.#id = :id AND #data.#version = :version",
  ExpressionAttributeNames: {
    "#type": "entityType",
    "#org": "orgId",
    "#data": "data",
    "#id": "id",
    "#version": "version",
  },
  ExpressionAttributeValues: {
    ":type": { S: entityTypes[snapshot.kind] },
    ":id": { S: snapshot.data.id },
    ":version": { N: String(snapshot.data.version) },
  },
});
function decode<K extends RestaurantKind>(
  orgId: string,
  kind: K,
  parents: RestaurantParents,
  item: Record<string, AttributeValue>,
  id?: string,
): RestaurantSnapshot<K> | undefined {
  const raw = StoredConfigurationSchema.safeParse(unmarshall(item));
  if (!raw.success) return undefined;
  const data = entitySchemas[kind].safeParse(raw.data.data);
  if (!data.success) return undefined;
  if (
    raw.data.orgId !== orgId ||
    raw.data.entityType !== entityTypes[kind] ||
    raw.data.PK !== KeyFactory.orgKey(orgId) ||
    raw.data.SK !== entitySK(kind, parents, data.data.id) ||
    (id && data.data.id !== id)
  )
    return undefined;
  for (const field of ["outletId", "serviceAreaId", "categoryId"] as const) {
    if (
      parents[field] &&
      (!Object.hasOwn(data.data, field) ||
        (data.data as Record<string, unknown>)[field] !== parents[field])
    )
      return undefined;
  }
  // The schema indexed by K validated the matching public DTO, never persistence keys.
  return {
    kind,
    parents,
    data: data.data as RestaurantEntities[K],
    createFingerprint: raw.data.createFingerprint,
    qrToken: raw.data.qrToken,
  };
}
export class RestaurantsRepository {
  static async get<K extends RestaurantKind>(
    orgId: string,
    kind: K,
    parents: RestaurantParents,
    id?: string,
  ): Promise<RestaurantSnapshot<K> | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: restaurantsTableName(),
        Key: key(orgId, kind, parents, id),
        ConsistentRead: true,
      }),
    );
    return result.Item
      ? decode(orgId, kind, parents, result.Item, id)
      : undefined;
  }

  static async list<K extends RestaurantKind>(
    orgId: string,
    kind: K,
    parents: RestaurantParents,
    input: RestaurantsListRequest,
  ): Promise<{ items: RestaurantEntities[K][]; nextCursor?: string }> {
    const prefix = collectionPrefix(kind, parents);
    const scope = createHash("sha256")
      .update(JSON.stringify([orgId, kind, parents]))
      .digest("hex");
    let exclusiveStartKey: Record<string, AttributeValue> | undefined;
    if (input.cursor) {
      try {
        const cursor = z
          .object({ id: RestaurantIdSchema, scope: z.literal(scope) })
          .strict()
          .parse(
            JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")),
          );
        exclusiveStartKey = key(orgId, kind, parents, cursor.id);
      } catch {
        throw new AppError(400, "ERROR_INVALID_CURSOR");
      }
    }
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: restaurantsTableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.orgKey(orgId),
          ":prefix": prefix,
        }),
        Limit: input.limit,
        ExclusiveStartKey: exclusiveStartKey,
        ConsistentRead: true,
        ScanIndexForward: true,
      }),
    );
    const items = (result.Items ?? []).flatMap((item) => {
      const snapshot = decode(orgId, kind, parents, item);
      return snapshot ? [snapshot.data] : [];
    });
    let nextCursor: string | undefined;
    if (result.LastEvaluatedKey) {
      const last = unmarshall(result.LastEvaluatedKey);
      if (
        last.PK !== KeyFactory.orgKey(orgId) ||
        typeof last.SK !== "string" ||
        !last.SK.startsWith(prefix)
      )
        throw new AppError(500, "ERROR_INTERNAL_SERVER");
      const id = RestaurantIdSchema.parse(last.SK.slice(prefix.length));
      nextCursor = Buffer.from(JSON.stringify({ id, scope })).toString(
        "base64url",
      );
    }
    return { items, nextCursor };
  }

  /** Configuration, parent versions, uniqueness reservations and QR mapping commit together. */
  static async save(
    orgId: string,
    next: RestaurantSnapshot,
    parents: ParentCheck[],
    previous?: RestaurantSnapshot,
    restaurantId?: string,
  ): Promise<void> {
    const item = stored(orgId, next);
    const conditions = previous
      ? writeCondition(previous)
      : {
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        };
    const transaction: TransactWriteItem[] = [
      {
        Put: {
          TableName: restaurantsTableName(),
          Item: marshall(item, { removeUndefinedValues: true }),
          ...conditions,
          ...(previous
            ? {
                ExpressionAttributeValues: {
                  ...writeCondition(previous).ExpressionAttributeValues,
                  ":org": { S: orgId },
                },
              }
            : {}),
        },
      },
    ];
    for (const check of parents) {
      const condition = writeCondition(check.snapshot);
      transaction.push({
        ConditionCheck: {
          TableName: restaurantsTableName(),
          Key: key(
            orgId,
            check.snapshot.kind,
            check.snapshot.parents,
            check.snapshot.data.id,
          ),
          ...condition,
          ConditionExpression:
            condition.ConditionExpression +
            (check.requireActive ? " AND #data.#active = :active" : ""),
          ExpressionAttributeNames: {
            ...condition.ExpressionAttributeNames,
            ...(check.requireActive ? { "#active": "isActive" } : {}),
          },
          ExpressionAttributeValues: {
            ...condition.ExpressionAttributeValues,
            ":org": { S: orgId },
            ...(check.requireActive ? { ":active": { BOOL: true } } : {}),
          },
        },
      });
    }
    if (next.kind === "table") {
      const data = entitySchemas.table.parse(next.data);
      const old = previous
        ? entitySchemas.table.parse(previous.data)
        : undefined;
      if (!old || old.code !== data.code) {
        transaction.push({
          Put: {
            TableName: restaurantsTableName(),
            Item: marshall({
              PK: KeyFactory.orgKey(orgId),
              SK: KeyFactory.restaurantTableCodeSK(data.outletId, data.code),
              entityType: "RESTAURANT_TABLE_CODE",
              orgId,
              outletId: data.outletId,
              tableId: data.id,
            }),
            ConditionExpression:
              "attribute_not_exists(PK) AND attribute_not_exists(SK)",
          },
        });
        if (old)
          transaction.push({
            Delete: {
              TableName: restaurantsTableName(),
              Key: {
                PK: { S: KeyFactory.orgKey(orgId) },
                SK: {
                  S: KeyFactory.restaurantTableCodeSK(old.outletId, old.code),
                },
              },
              ConditionExpression:
                "entityType = :type AND orgId = :org AND tableId = :id",
              ExpressionAttributeValues: {
                ":type": { S: "RESTAURANT_TABLE_CODE" },
                ":org": { S: orgId },
                ":id": { S: data.id },
              },
            },
          });
      }
      if (!previous) {
        const token = RestaurantTableQrResponseSchema.shape.token.parse(
          next.qrToken,
        );
        transaction.push({
          Put: {
            TableName: restaurantsTableName(),
            Item: marshall(
              QrLookupSchema.parse({
                ...unmarshall(qrKey(token)),
                entityType: "RESTAURANT_TABLE_QR",
                orgId,
                restaurantId,
                outletId: data.outletId,
                serviceAreaId: data.serviceAreaId,
                tableId: data.id,
              }),
            ),
            ConditionExpression:
              "attribute_not_exists(PK) AND attribute_not_exists(SK)",
          },
        });
      }
    }
    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({ TransactItems: transaction }),
      );
    } catch (error) {
      const name = (error as { name?: string } | undefined)?.name;
      if (
        name === "TransactionCanceledException" ||
        name === "ConditionalCheckFailedException"
      )
        throw new AppError(409, "RESTAURANTS_WRITE_CONFLICT");
      throw error;
    }
  }

  /** Internal future QR access pattern. No public endpoint; never returns physical keys. */
  static async getQrLookup(token: string) {
    RestaurantTableQrResponseSchema.shape.token.parse(token);
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: restaurantsTableName(),
        Key: qrKey(token),
        ConsistentRead: true,
      }),
    );
    if (!result.Item) return undefined;
    const parsed = QrLookupSchema.safeParse(unmarshall(result.Item));
    if (
      !parsed.success ||
      parsed.data.PK !== qrKey(token).PK.S ||
      parsed.data.SK !== KeyFactory.restaurantQrSK()
    )
      return undefined;
    const { PK, SK, entityType, ...locator } = parsed.data;
    return locator;
  }
}
