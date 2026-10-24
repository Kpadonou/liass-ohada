import { createHash } from "crypto";
import { z } from "zod";
import {
  GetItemCommand,
  TransactWriteItemsCommand,
  TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { AppError } from "@/lambda/shared/app-error";
import { GuestService } from "./guest-service";
import { openReference, publicReference } from "./guest-references";
import { RestaurantsRepository as Config } from "./restaurant-repository";
import { RestaurantTransactionsService as Engine } from "./transaction-service";
import { WaiterCalls } from "./waiter-call";
import { restaurantsTableName } from "./restaurant-storage";

type Scope = { orgId: string; outletId: string; sessionId: string };
type Key = { PK: string; SK: string };
const item = z
  .object({
    menuId: z.string().uuid(),
    menuVersion: z.number().int(),
    categoryId: z.string().uuid(),
    categoryVersion: z.number().int(),
    itemId: z.string().uuid(),
    itemVersion: z.number().int(),
  })
  .strict();
const Row = z
  .object({
    entityType: z.literal("RESTAURANT_GUEST_ORDER_REQUEST"),
    schemaVersion: z.literal(1),
    orgId: z.string(),
    outletId: z.string().uuid(),
    sessionId: z.string().uuid(),
    tableId: z.string().uuid(),
    guestHandle: z.string(),
    fingerprint: z.string(),
    policyVersion: z.number().int().positive(),
    version: z.number().int().positive(),
    data: c.GuestOrderRequestSchema,
    items: z.array(item).max(12),
    orderId: z.string().uuid().optional(),
  })
  .passthrough();
type RequestRow = z.infer<typeof Row>;
const Coord = z.object({
  version: z.number().int().positive(),
  ids: z.array(z.string().uuid()).max(20),
});
const Rate = z.object({
  version: z.number().int().positive(),
  at: z.number().int(),
});
const fail = (): never => {
  throw new AppError(409, "RESTAURANTS_WRITE_CONFLICT");
};
const id = (parts: unknown[]) => {
  const h = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const conflict = (e: unknown) => {
  const v = e as { name?: string; CancellationReasons?: { Code?: string }[] };
  return (
    v.name === "TransactionCanceledException" &&
    v.CancellationReasons?.some((r) => r.Code === "ConditionalCheckFailed")
  );
};
export class GuestSubmissions {
  static async raw(key: Key) {
    const r = await dynamoClient.send(
      new GetItemCommand({
        TableName: restaurantsTableName(),
        Key: marshall(key),
        ConsistentRead: true,
      }),
    );
    return r.Item ? unmarshall(r.Item) : undefined;
  }
  static key(s: Scope, r: string) {
    return K.restaurantGuestRequestKey(s.orgId, s.outletId, s.sessionId, r);
  }
  static async row(s: Scope, r: string) {
    const raw = await this.raw(this.key(s, r));
    if (!raw) return undefined;
    const v = Row.parse(raw);
    if (
      v.orgId !== s.orgId ||
      v.outletId !== s.outletId ||
      v.sessionId !== s.sessionId ||
      v.data.requestId !== r
    )
      return fail();
    return v;
  }
  static put(key: Key, value: object, version?: number): TransactWriteItem {
    return {
      Put: {
        TableName: restaurantsTableName(),
        Item: marshall({ ...value, ...key }, { removeUndefinedValues: true }),
        ConditionExpression: version ? "#v = :v" : "attribute_not_exists(PK)",
        ...(version
          ? {
              ExpressionAttributeNames: { "#v": "version" },
              ExpressionAttributeValues: marshall({ ":v": version }),
            }
          : {}),
      },
    };
  }
  static async rows(s: Scope) {
    const raw = await this.raw(
      K.restaurantGuestRequestCoordKey(s.orgId, s.outletId, s.sessionId),
    );
    const coord = raw ? Coord.parse(raw) : undefined;
    return {
      coord,
      rows: (
        await Promise.all((coord?.ids ?? []).map((r) => this.row(s, r)))
      ).filter((r): r is RequestRow => !!r),
    };
  }
  static projection(r: RequestRow, valid = true) {
    return c.GuestOrderRequestSchema.parse({
      ...r.data,
      state:
        r.data.state === "PENDING_APPROVAL" &&
        (!valid || Date.parse(r.data.expiresAt) <= Date.now())
          ? "EXPIRED"
          : r.data.state,
    });
  }
  static async policy(s: Scope, policyVersion?: number) {
    const session = await Engine.session(s, s.sessionId);
    const root = await Config.get(s.orgId, "restaurant", {});
    return (
      session.data.status === "OPEN" &&
      root?.data.isActive &&
      root.data.guestOrderingPolicy === "STAFF_APPROVAL" &&
      (policyVersion === undefined || root.data.version === policyVersion)
    );
  }
  static async submit(capability: string, input: unknown) {
    const request = c.GuestSubmissionRequestSchema.parse(input);
    const verified = await GuestService.verify(capability);
    if (!("principal" in verified)) return verified;
    const { principal: p, context } = verified;
    if (
      !p.sessionId ||
      !p.rights.includes("ORDER_SUBMIT") ||
      context.root.guestOrderingPolicy !== "STAFF_APPROVAL"
    )
      return { state: "NOT_ALLOWED" as const };
    const s = { orgId: p.orgId, outletId: p.outletId, sessionId: p.sessionId };
    const requestId = id([s, p.guestHandle, request.clientRequestId]);
    const fingerprint = hash(request);
    const previous = await this.row(s, requestId);
    if (previous) {
      if (
        previous.guestHandle !== p.guestHandle ||
        previous.fingerprint !== fingerprint
      )
        return { state: "REVIEW_REQUIRED" as const };
      return {
        state: "CONFIRMED" as const,
        request: this.projection(
          previous,
          previous.policyVersion === context.root.version,
        ),
      };
    }
    const guards = new Map<string, number>([
      [K.restaurantSK(), context.root.version],
      [K.restaurantOutletSK(p.outletId), context.outlet.version],
      [
        K.restaurantTableSK(p.outletId, p.areaId, p.tableId),
        context.table.version,
      ],
    ]);
    const area = await Config.get(
      p.orgId,
      "serviceArea",
      { outletId: p.outletId },
      p.areaId,
    );
    if (!area?.data.isActive) return { state: "UNAVAILABLE" as const };
    guards.set(
      K.restaurantServiceAreaSK(p.outletId, p.areaId),
      area.data.version,
    );
    const items: z.infer<typeof item>[] = [];
    const lines: z.infer<typeof c.GuestOrderRequestSchema>["lines"] = [];
    try {
      for (const line of request.lines) {
        const ref = item.parse(
          JSON.parse(
            (await openReference(p, "selection", line.selectionRef)).value,
          ),
        );
        const [menu, category, entry] = await Promise.all([
          Config.get(s.orgId, "menu", { outletId: s.outletId }),
          Config.get(
            s.orgId,
            "category",
            { outletId: s.outletId },
            ref.categoryId,
          ),
          Config.get(
            s.orgId,
            "item",
            { outletId: s.outletId, categoryId: ref.categoryId },
            ref.itemId,
          ),
        ]);
        if (
          !menu?.data.isActive ||
          !category?.data.isActive ||
          !entry?.data.isActive ||
          entry.data.availability !== "AVAILABLE" ||
          menu.data.id !== ref.menuId ||
          category.data.menuId !== ref.menuId ||
          entry.data.menuId !== ref.menuId ||
          menu.data.version !== ref.menuVersion ||
          category.data.version !== ref.categoryVersion ||
          entry.data.version !== ref.itemVersion ||
          line.reference !== (await publicReference(p, ref.itemId)) ||
          entry.data.price.amountMinor !== line.presentedAmountMinor ||
          entry.data.price.currency !== line.currency
        )
          throw new Error("review");
        guards.set(K.restaurantMenuSK(s.outletId), ref.menuVersion);
        guards.set(
          K.restaurantCategorySK(s.outletId, ref.categoryId),
          ref.categoryVersion,
        );
        guards.set(
          K.restaurantMenuItemSK(s.outletId, ref.categoryId, ref.itemId),
          ref.itemVersion,
        );
        items.push(ref);
        lines.push({
          name: entry.data.name,
          quantity: line.quantity,
          note: line.note,
          amountMinor: entry.data.price.amountMinor,
          currency: entry.data.price.currency,
        });
      }
    } catch {
      return { state: "REVIEW_REQUIRED" as const };
    }
    for (let n = 0; n < 4; n++) {
      const old = await this.row(s, requestId);
      if (old) {
        if (old.fingerprint !== fingerprint)
          return { state: "REVIEW_REQUIRED" as const };
        return {
          state: "CONFIRMED" as const,
          request: this.projection(
            old,
            old.policyVersion === context.root.version,
          ),
        };
      }
      const { coord, rows } = await this.rows(s);
      const now = Date.now();
      const pending = rows.filter(
        (r) =>
          r.data.state === "PENDING_APPROVAL" &&
          r.policyVersion === context.root.version &&
          Date.parse(r.data.expiresAt) > now,
      );
      if (
        (coord?.ids.length ?? 0) >= 20 ||
        pending.length >= 10 ||
        pending.filter((r) => r.guestHandle === p.guestHandle).length >= 2
      )
        return { state: "LIMIT_REACHED" as const };
      const rateKey = K.restaurantGuestSubmissionRateKey(
        s.orgId,
        s.outletId,
        p.tableId,
      );
      const raw = await this.raw(rateKey),
        rate = raw ? Rate.parse(raw) : undefined;
      if (rate && now - rate.at < 5000)
        return {
          state: "RATE_LIMITED" as const,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((5000 - now + rate.at) / 1000),
          ),
        };
      const session = await Engine.session(s, s.sessionId);
      if (session.data.status !== "OPEN")
        return { state: "VISIT_ENDED" as const };
      const data = c.GuestOrderRequestSchema.parse({
        requestId,
        state: "PENDING_APPROVAL",
        submittedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 900000).toISOString(),
        lines,
      });
      const row: RequestRow = {
        entityType: "RESTAURANT_GUEST_ORDER_REQUEST",
        schemaVersion: 1,
        ...s,
        tableId: p.tableId,
        guestHandle: p.guestHandle,
        fingerprint,
        policyVersion: context.root.version,
        version: 1,
        data,
        items,
      };
      const actions: TransactWriteItem[] = [
        this.put(this.key(s, requestId), row),
        this.put(
          K.restaurantGuestRequestCoordKey(s.orgId, s.outletId, s.sessionId),
          {
            entityType: "RESTAURANT_GUEST_REQUEST_COORD",
            ...s,
            version: (coord?.version ?? 0) + 1,
            ids: [...(coord?.ids ?? []), requestId],
          },
          coord?.version,
        ),
        this.put(
          rateKey,
          {
            entityType: "RESTAURANT_GUEST_SUBMISSION_RATE",
            ...s,
            version: (rate?.version ?? 0) + 1,
            at: now,
          },
          rate?.version,
        ),
        {
          ConditionCheck: {
            TableName: restaurantsTableName(),
            Key: marshall({ PK: session.PK, SK: session.SK }),
            ConditionExpression: "#d.#v = :v AND #d.#s = :s",
            ExpressionAttributeNames: {
              "#d": "data",
              "#v": "version",
              "#s": "status",
            },
            ExpressionAttributeValues: marshall({
              ":v": session.data.version,
              ":s": "OPEN",
            }),
          },
        },
      ];
      for (const [sk, version] of guards)
        actions.push({
          ConditionCheck: {
            TableName: restaurantsTableName(),
            Key: marshall({ PK: K.orgKey(s.orgId), SK: sk }),
            ConditionExpression: "#d.#v = :v",
            ExpressionAttributeNames: { "#d": "data", "#v": "version" },
            ExpressionAttributeValues: marshall({ ":v": version }),
          },
        });
      try {
        await dynamoClient.send(
          new TransactWriteItemsCommand({ TransactItems: actions }),
        );
        return { state: "CONFIRMED" as const, request: data };
      } catch (e) {
        if (!conflict(e)) throw e;
      }
    }
    return fail();
  }
  static async own(capability: string) {
    const v = await GuestService.verify(capability);
    if (!("principal" in v)) return v;
    const p = v.principal;
    if (!p.sessionId) return { state: "NOT_ALLOWED" as const };
    const s = { orgId: p.orgId, outletId: p.outletId, sessionId: p.sessionId };
    const { rows } = await this.rows(s);
    return {
      state: "READY" as const,
      requests: rows
        .filter((r) => r.guestHandle === p.guestHandle)
        .map((r) =>
          this.projection(
            r,
            v.context.root.guestOrderingPolicy === "STAFF_APPROVAL" &&
              r.policyVersion === v.context.root.version,
          ),
        ),
    };
  }
  static async list(s: Scope, actor: string) {
    await WaiterCalls.authorize(s, actor);
    const valid = await this.policy(s);
    const root = await Config.get(s.orgId, "restaurant", {});
    return {
      requests: (await this.rows(s)).rows.map((r) =>
        this.projection(r, valid && r.policyVersion === root?.data.version),
      ),
    };
  }
  static async review(
    s: Scope,
    actor: string,
    requestId: string,
    operation: "approve" | "reject",
    reason?: string,
  ) {
    const access = await WaiterCalls.authorize(s, actor);
    for (let attempt = 0; attempt < 4; attempt++) {
      let row = await this.row(s, requestId);
      if (!row) throw new AppError(404, "RESTAURANTS_NOT_FOUND");
      if (row.data.state !== "PENDING_APPROVAL")
        return { request: this.projection(row) };
      if (
        !(await this.policy(s, row.policyVersion)) ||
        Date.parse(row.data.expiresAt) <= Date.now()
      )
        return { request: this.projection(row, false) };
      if (operation === "reject") {
        const next = {
          ...row,
          version: row.version + 1,
          data: {
            ...row.data,
            state: "REJECTED" as const,
            reason: c.RejectGuestRequestSchema.parse({ reason }).reason,
          },
        };
        try {
          await dynamoClient.send(
            new TransactWriteItemsCommand({
              TransactItems: [
                ...access.actions,
                this.put(this.key(s, requestId), next, row.version),
                this.put(
                  K.restaurantGuestRequestAuditKey(
                    s.orgId,
                    s.outletId,
                    s.sessionId,
                    requestId,
                  ),
                  {
                    entityType: "RESTAURANT_GUEST_REQUEST_REJECTION_AUDIT",
                    ...s,
                    requestId,
                    actorId: actor,
                    at: new Date().toISOString(),
                  },
                ),
              ],
            }),
          );
          return { request: next.data };
        } catch (e) {
          if (conflict(e)) continue;
          throw e;
        }
      }
      const ctx = { orgId: s.orgId, outletId: s.outletId, actorId: actor };
      const orderId = id([requestId, "order"]);
      const lines = row.items.map((ref, i) => ({
        itemId: id([requestId, "line", i]),
        menuItemId: ref.itemId,
        categoryId: ref.categoryId,
        quantity: row.data.lines[i].quantity,
        notes: row.data.lines[i].note,
        expectedMenuItemVersion: ref.itemVersion,
      }));
      const accepted = {
        ...row,
        version: row.version + 1,
        orderId,
        data: { ...row.data, state: "ACCEPTED" as const },
      };
      try {
        await Engine.mutate(
          ctx,
          "SUBMIT_ORDER",
          {
            clientRequestId: id([requestId, "accept"]),
            expectedVersion: 1,
            items: lines.map((l) => ({ itemId: l.itemId, expectedVersion: 1 })),
          },
          { orderId },
          {
            sessionId: s.sessionId,
            expiresAt: row.data.expiresAt,
            policyVersion: row.policyVersion,
            lines,
            actions: [this.put(this.key(s, requestId), accepted, row.version)],
          },
        );
      } catch (error) {
        const canonical = await this.row(s, requestId);
        if (canonical && canonical.data.state !== "PENDING_APPROVAL")
          return { request: this.projection(canonical) };
        throw error;
      }
      return { request: accepted.data };
    }
    return fail();
  }
}
