import { randomUUID } from "crypto";
import { z } from "zod";
import {
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  GuestActivityResponseSchema,
  GuestWaiterCallResponseSchema,
  AcknowledgeWaiterCallResponseSchema,
} from "@liass-ohada/shared/restaurants";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";
import { GuestService } from "./guest-service";
import { RestaurantServiceAccess } from "./service-access";
import { RestaurantsRepository as Config } from "./restaurant-repository";
import { restaurantsTableName } from "./restaurant-storage";

const CallSchema = z
  .object({
    entityType: z.literal("RESTAURANT_WAITER_CALL"),
    schemaVersion: z.literal(1),
    orgId: z.string(),
    outletId: z.string(),
    tableId: z.string().uuid(),
    tableName: z.string().min(1).max(160),
    areaId: z.string().uuid(),
    callId: z.string().uuid(),
    sessionId: z.string().uuid().optional(),
    status: z.enum(["REQUESTED", "ACKNOWLEDGED"]),
    requestedAt: z.string().datetime(),
    operationalExpiresAt: z.number().int(),
    version: z.number().int().positive(),
    acknowledgedAt: z.string().datetime().optional(),
    acknowledgedBy: z.string().optional(),
    cooldownUntil: z.number().int().optional(),
  })
  .passthrough();
type Call = z.infer<typeof CallSchema>;
type Scope = { orgId: string; outletId: string };
type Key = { PK: string; SK: string };
const deny = (): never => {
  throw new AppError(404, "RESTAURANTS_NOT_FOUND");
};
const conflict = (): never => {
  throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
};
const isConflict = (error: unknown) => {
  const e = error as {
    name?: string;
    CancellationReasons?: { Code?: string }[];
  };
  return (
    e.name === "TransactionCanceledException" &&
    !!e.CancellationReasons?.some((r) => r.Code === "ConditionalCheckFailed")
  );
};
export class WaiterCalls {
  static async read(scope: Scope, key: Key): Promise<Call | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: restaurantsTableName(),
        Key: marshall(key),
        ConsistentRead: true,
      }),
    );
    if (!result.Item) return undefined;
    const raw = unmarshall(result.Item),
      call = CallSchema.parse(raw);
    if (
      raw.PK !== key.PK ||
      raw.SK !== key.SK ||
      call.orgId !== scope.orgId ||
      call.outletId !== scope.outletId
    )
      return conflict();
    return call;
  }
  private static put(key: Key, call: Call, old?: Call): TransactWriteItem {
    return {
      Put: {
        TableName: restaurantsTableName(),
        Item: marshall({ ...call, ...key }, { removeUndefinedValues: true }),
        ConditionExpression: old
          ? "#v = :v AND callId = :id"
          : "attribute_not_exists(PK)",
        ...(old
          ? {
              ExpressionAttributeNames: { "#v": "version" },
              ExpressionAttributeValues: marshall({
                ":v": old.version,
                ":id": old.callId,
              }),
            }
          : {}),
      },
    };
  }
  private static activityKey(scope: Scope, call: Call) {
    return K.restaurantWaiterActivityKey(
      scope.orgId,
      scope.outletId,
      call.requestedAt,
      call.callId,
    );
  }
  static async request(capability: string) {
    // Every request (including duplicates/cooldown) crosses canonical validation first.
    const verified = await GuestService.verify(capability);
    if (!("principal" in verified))
      return GuestWaiterCallResponseSchema.parse(verified);
    const { principal, context } = verified;
    if (!principal.rights.includes("CALL_WAITER"))
      return { state: "UNAVAILABLE" as const };
    const scope = { orgId: principal.orgId, outletId: principal.outletId };
    return this.create(scope, {
      tableId: principal.tableId,
      areaId: principal.areaId,
      tableName: context.table.name.trim() || context.table.code,
      sessionId: context.sessionId,
    });
  }
  static async create(
    scope: Scope,
    table: {
      tableId: string;
      areaId: string;
      tableName: string;
      sessionId?: string;
    },
  ) {
    const key = K.restaurantWaiterSlotKey(
      scope.orgId,
      scope.outletId,
      table.tableId,
    );
    for (let attempt = 0; attempt < 4; attempt++) {
      const old = await this.read(scope, key),
        now = Date.now();
      if (old && (old.tableId !== table.tableId || old.areaId !== table.areaId))
        return conflict();
      if (old?.status === "REQUESTED" && now < old.operationalExpiresAt)
        return GuestWaiterCallResponseSchema.parse({
          state: "REQUESTED",
          requestedAt: old.requestedAt,
        });
      if (old?.status === "ACKNOWLEDGED" && now < (old.cooldownUntil ?? 0))
        return GuestWaiterCallResponseSchema.parse({
          state: "COOLDOWN",
          retryAfterSeconds: Math.min(
            60,
            Math.ceil((old.cooldownUntil! - now) / 1000),
          ),
        });
      const call: Call = {
        entityType: "RESTAURANT_WAITER_CALL",
        schemaVersion: 1,
        ...scope,
        ...table,
        callId: randomUUID(),
        status: "REQUESTED",
        requestedAt: new Date(now).toISOString(),
        operationalExpiresAt: now + 600000,
        version: (old?.version ?? 0) + 1,
      };
      const actions = [
        this.put(key, call, old),
        this.put(
          K.restaurantWaiterCallKey(scope.orgId, scope.outletId, call.callId),
          call,
        ),
        this.put(this.activityKey(scope, call), call),
      ];
      if (old?.status === "REQUESTED")
        actions.push({
          Delete: {
            TableName: restaurantsTableName(),
            Key: marshall(this.activityKey(scope, old)),
          },
        });
      try {
        await dynamoClient.send(
          new TransactWriteItemsCommand({ TransactItems: actions }),
        );
        return GuestWaiterCallResponseSchema.parse({
          state: "REQUESTED",
          requestedAt: call.requestedAt,
        });
      } catch (error) {
        if (!isConflict(error)) throw error;
      }
    }
    return conflict();
  }
  static async authorize(scope: Scope, actorId: string) {
    const access = await RestaurantServiceAccess.authorize(scope, actorId);
    if (!["OWNER", "MANAGER", "WAITER"].includes(access.role ?? ""))
      throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
    const outlet = await Config.get(scope.orgId, "outlet", {}, scope.outletId);
    if (!outlet?.data.isActive) return deny();
    return access;
  }
  static async activity(scope: Scope, actorId: string, cursor?: string) {
    await this.authorize(scope, actorId);
    const PK = K.restaurantWaiterActivityPK(scope.orgId, scope.outletId);
    let start: Key | undefined;
    if (cursor) {
      try {
        const v = JSON.parse(Buffer.from(cursor, "base64url").toString());
        if (v.PK !== PK || typeof v.SK !== "string") return deny();
        start = { PK, SK: v.SK };
      } catch {
        return deny();
      }
    }
    // Key-range bounds exclude permanent expired history; a page evaluates at most 100 items.
    const now = Date.now();
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: restaurantsTableName(),
        ConsistentRead: true,
        KeyConditionExpression: "PK = :pk AND SK BETWEEN :lo AND :hi",
        ExpressionAttributeValues: marshall({
          ":pk": PK,
          ":lo": new Date(now - 600000).toISOString(),
          ":hi": new Date(now).toISOString() + "~",
        }),
        Limit: 100,
        ScanIndexForward: true,
        ...(start ? { ExclusiveStartKey: marshall(start) } : {}),
      }),
    );
    const items = (result.Items ?? [])
      .map((raw) => CallSchema.parse(unmarshall(raw)))
      .filter(
        (c) =>
          c.orgId === scope.orgId &&
          c.outletId === scope.outletId &&
          c.status === "REQUESTED" &&
          now < c.operationalExpiresAt,
      )
      .map((c) => ({
        waiterCallId: c.callId,
        tableId: c.tableId,
        tableName: c.tableName,
        requestedAt: c.requestedAt,
        operationalExpiresAt: new Date(c.operationalExpiresAt).toISOString(),
        hasSession: !!c.sessionId,
      }));
    return GuestActivityResponseSchema.parse({
      items,
      ...(result.LastEvaluatedKey
        ? {
            nextCursor: Buffer.from(
              JSON.stringify(unmarshall(result.LastEvaluatedKey)),
            ).toString("base64url"),
          }
        : {}),
    });
  }
  static async acknowledge(scope: Scope, actorId: string, callId: string) {
    const access = await this.authorize(scope, actorId);
    const key = K.restaurantWaiterCallKey(scope.orgId, scope.outletId, callId);
    for (let attempt = 0; attempt < 4; attempt++) {
      const call = await this.read(scope, key);
      if (!call || call.callId !== callId) return deny();
      const response = (c: Call) =>
        AcknowledgeWaiterCallResponseSchema.parse({
          waiterCallId: c.callId,
          state: c.status,
          acknowledgedAt: c.acknowledgedAt,
        });
      if (call.status === "ACKNOWLEDGED") return response(call);
      const now = Date.now();
      if (now >= call.operationalExpiresAt) return conflict();
      const slotKey = K.restaurantWaiterSlotKey(
          scope.orgId,
          scope.outletId,
          call.tableId,
        ),
        slot = await this.read(scope, slotKey);
      if (!slot || slot.callId !== call.callId || slot.status !== "REQUESTED")
        continue;
      const updated: Call = {
        ...call,
        status: "ACKNOWLEDGED",
        acknowledgedAt: new Date(now).toISOString(),
        acknowledgedBy: actorId,
        cooldownUntil: now + 60000,
        version: call.version + 1,
      };
      const auditKey = K.restaurantWaiterAuditKey(
        scope.orgId,
        scope.outletId,
        callId,
      );
      const actions: TransactWriteItem[] = [
        ...access.actions,
        this.put(key, updated, call),
        this.put(slotKey, updated, slot),
        {
          Delete: {
            TableName: restaurantsTableName(),
            Key: marshall(this.activityKey(scope, call)),
          },
        },
        {
          Put: {
            TableName: restaurantsTableName(),
            Item: marshall({
              ...auditKey,
              entityType: "RESTAURANT_WAITER_CALL_ACK_AUDIT",
              ...scope,
              callId,
              actorId,
              acknowledgedAt: updated.acknowledgedAt,
            }),
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
      ];
      try {
        await dynamoClient.send(
          new TransactWriteItemsCommand({ TransactItems: actions }),
        );
        return response(updated);
      } catch (error) {
        if (!isConflict(error)) throw error;
      }
    }
    return conflict();
  }
}
