import { RestaurantTransactionsRepository as R } from "./transaction-repository";
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
import { config, dynamoClient } from "@/lambda/shared/dynamo-client";
import { AppError } from "@/lambda/shared/app-error";
import { GuestService } from "./guest-service";
import { openReference, publicReference } from "./guest-references";
import { RestaurantsRepository as Config } from "./restaurant-repository";
import { RestaurantTransactionsService as Engine } from "./transaction-service";
import { WaiterCalls } from "./waiter-call";
import { restaurantsTableName } from "./restaurant-storage";

type Scope = {
  orgId: string;
  outletId: string;
  sessionId?: string;
  tableId?: string;
};
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
    sessionId: z.string().uuid().optional(),
    areaId: z.string().uuid().optional(),
    qrFingerprint: z.string().optional(),
    preService: z.boolean().optional(),
    tableId: z.string().uuid(),
    guestHandle: z.string(),
    fingerprint: z.string(),
    policyVersion: z.number().int().positive(),
    mode: z.enum(["STAFF_APPROVAL", "DIRECT"]).default("STAFF_APPROVAL"),
    directStage: z
      .object({
        order: c.RestaurantOrderSchema,
        lines: z.array(c.RestaurantOrderItemSchema).min(1).max(12),
      })
      .strict()
      .optional(),
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
    return s.sessionId
      ? K.restaurantGuestRequestKey(s.orgId, s.outletId, s.sessionId, r)
      : K.restaurantPreServiceRequestKey(s.orgId, s.outletId, s.tableId!, r);
  }
  static coordKey(s: Scope) {
    return s.sessionId
      ? K.restaurantGuestRequestCoordKey(s.orgId, s.outletId, s.sessionId)
      : K.restaurantPreServiceCoordKey(s.orgId, s.outletId, s.tableId!);
  }
  static async row(s: Scope, r: string): Promise<RequestRow | undefined> {
    const raw = await this.raw(this.key(s, r));
    if (!raw) return undefined;
    const v = Row.parse(raw);
    if (
      v.orgId !== s.orgId ||
      v.outletId !== s.outletId ||
      (s.sessionId ? v.sessionId !== s.sessionId : v.tableId !== s.tableId) ||
      v.data.requestId !== r
    )
      return fail();
    // The original pre-service item remains an immutable ownership/idempotency link.
    if (!s.sessionId && v.sessionId)
      return this.row({ ...s, sessionId: v.sessionId }, r);
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
    const raw = await this.raw(this.coordKey(s));
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
        ["PENDING_SERVICE", "PENDING_APPROVAL", "PROCESSING"].includes(
          r.data.state,
        ) &&
        (!valid || Date.parse(r.data.expiresAt) <= Date.now())
          ? "EXPIRED"
          : r.data.state,
    });
  }
  static async policy(s: Scope, policyVersion?: number) {
    const session = await Engine.session(s, s.sessionId!);
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
    const mode = context.root.guestOrderingPolicy;
    const s = {
      orgId: p.orgId,
      outletId: p.outletId,
      sessionId: p.sessionId,
      tableId: p.tableId,
    };
    const preScope = {
      orgId: p.orgId,
      outletId: p.outletId,
      tableId: p.tableId,
    };
    const preId = id([preScope, p.guestHandle, request.clientRequestId]);
    const preExisting = p.sessionId
      ? await this.row(preScope, preId)
      : undefined;
    if (preExisting && preExisting.sessionId !== p.sessionId)
      return { state: "REVIEW_REQUIRED" as const };
    const requestId = preExisting
      ? preId
      : p.sessionId
        ? id([
            { orgId: p.orgId, outletId: p.outletId, sessionId: p.sessionId },
            p.guestHandle,
            request.clientRequestId,
          ])
        : preId;
    const fingerprint = hash(request);
    const previous = preExisting ?? (await this.row(s, requestId));
    if (
      previous &&
      (previous.guestHandle !== p.guestHandle ||
        previous.fingerprint !== fingerprint)
    )
      return { state: "REVIEW_REQUIRED" as const };
    if (previous?.mode === "DIRECT" && previous.data.state === "ACCEPTED")
      return {
        state: "CONFIRMED" as const,
        request: await this.directStatus(previous),
      };
    if (!p.rights.includes("ORDER_SUBMIT") || mode === "DISABLED")
      return { state: "NOT_ALLOWED" as const };
    if (previous) {
      if (previous.data.state === "PENDING_SERVICE")
        return {
          state: "CONFIRMED" as const,
          request: this.projection(
            previous,
            previous.policyVersion === context.root.version &&
              previous.mode === mode,
          ),
        };
      if (previous.mode === "DIRECT")
        return this.acceptDirect(capability, previous);
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
    let selectionExpiry = Number.MAX_SAFE_INTEGER;
    const items: z.infer<typeof item>[] = [];
    const lines: z.infer<typeof c.GuestOrderRequestSchema>["lines"] = [];
    try {
      for (const line of request.lines) {
        const opened = await openReference(p, "selection", line.selectionRef);
        selectionExpiry = Math.min(selectionExpiry, opened.exp * 1000);
        const ref = item.parse(JSON.parse(opened.value));
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
        if (
          old.fingerprint !== fingerprint ||
          old.guestHandle !== p.guestHandle
        )
          return { state: "REVIEW_REQUIRED" as const };
        if (old.data.state === "PENDING_SERVICE")
          return { state: "CONFIRMED" as const, request: this.projection(old) };
        if (old.mode === "DIRECT") return this.acceptDirect(capability, old);
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
          ["PENDING_SERVICE", "PENDING_APPROVAL", "PROCESSING"].includes(
            r.data.state,
          ) &&
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
      const session = s.sessionId
        ? await Engine.session(s, s.sessionId)
        : undefined;
      if (session && session.data.status !== "OPEN")
        return { state: "VISIT_ENDED" as const };
      const data = c.GuestOrderRequestSchema.parse({
        requestId,
        state: !session
          ? "PENDING_SERVICE"
          : mode === "DIRECT"
            ? "PROCESSING"
            : "PENDING_APPROVAL",
        mode,
        clientRequestId: request.clientRequestId,
        submittedAt: new Date(now).toISOString(),
        expiresAt: new Date(
          mode === "DIRECT"
            ? Math.min(now + 900000, selectionExpiry)
            : now + 900000,
        ).toISOString(),
        lines,
      });
      const row: RequestRow = {
        entityType: "RESTAURANT_GUEST_ORDER_REQUEST",
        schemaVersion: 1,
        ...s,
        tableId: p.tableId,
        areaId: p.areaId,
        qrFingerprint: p.qrFingerprint,
        ...(!session ? { preService: true } : {}),
        guestHandle: p.guestHandle,
        fingerprint,
        policyVersion: context.root.version,
        mode,
        ...(mode === "DIRECT" && session
          ? {
              orderId: id([requestId, "order"]),
              directStage: Engine.stageGuestOrder(
                { ...s, actorId: "guest:" + p.guestHandle },
                session.data,
                id([requestId, "order"]),
                items.map((ref, i) => ({
                  itemId: id([requestId, "line", i]),
                  menuItemId: ref.itemId,
                  categoryId: ref.categoryId,
                  quantity: lines[i].quantity,
                  notes: lines[i].note,
                  expectedMenuItemVersion: ref.itemVersion,
                })),
              ),
            }
          : {}),
        version: 1,
        data,
        items,
      };
      const actions: TransactWriteItem[] = [
        this.put(this.key(s, requestId), row),
        this.put(
          this.coordKey(s),
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
        session
          ? {
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
            }
          : {
              ConditionCheck: {
                TableName: restaurantsTableName(),
                Key: marshall({
                  PK: K.restaurantOccupancyPK(s.orgId, s.outletId, p.tableId),
                  SK: K.restaurantOccupancySK(),
                }),
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
      ];
      if (!session)
        actions.push(
          this.put(
            K.restaurantWaiterActivityKey(
              s.orgId,
              s.outletId,
              data.submittedAt,
              requestId,
            ),
            {
              entityType: "RESTAURANT_GUEST_PRE_SERVICE_ACTIVITY",
              orgId: s.orgId,
              outletId: s.outletId,
              tableId: p.tableId,
              tableName: context.table.name.trim() || context.table.code,
              requestId,
              requestedAt: data.submittedAt,
              operationalExpiresAt: data.expiresAt,
            },
          ),
        );
      if (mode === "DIRECT")
        actions.push({
          ConditionCheck: {
            TableName: config.PLATFORM_TABLE_NAME,
            Key: marshall({
              PK: K.orgKey(s.orgId),
              SK: K.productAccessSK("RESTAURANTS"),
            }),
            ConditionExpression:
              "entityType = :type AND orgId = :org AND productCode = :product AND #status = :active",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: marshall({
              ":type": "PRODUCT_ACCESS",
              ":org": s.orgId,
              ":product": "RESTAURANTS",
              ":active": "ACTIVE",
            }),
          },
        });
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
        if (mode === "DIRECT" && session)
          return await this.acceptDirect(capability, row);
        return { state: "CONFIRMED" as const, request: data };
      } catch (e) {
        if (!conflict(e)) throw e;
      }
    }
    return fail();
  }
  private static async acceptDirect(
    capability: string | undefined,
    row: RequestRow,
  ) {
    if (row.data.state === "EXPIRED")
      return { state: "CONFIRMED" as const, request: this.projection(row) };
    if (row.data.state === "ACCEPTED")
      return {
        state: "CONFIRMED" as const,
        request: await this.directStatus(row),
      };
    const bound = row.preService && !capability;
    const verified = bound
      ? await GuestService.verifyBound({
          ...row,
          expiresAt: row.data.expiresAt,
        })
      : await GuestService.verify(capability!);
    if (!("principal" in verified))
      return bound ? this.expireBound(row) : verified;
    const p = verified.principal;
    if (
      p.guestHandle !== row.guestHandle ||
      p.orgId !== row.orgId ||
      p.outletId !== row.outletId ||
      p.sessionId !== row.sessionId ||
      verified.context.root.guestOrderingPolicy !== "DIRECT" ||
      verified.context.root.version !== row.policyVersion ||
      Date.parse(row.data.expiresAt) <= Date.now()
    )
      return bound
        ? this.expireBound(row)
        : {
            state: "CONFIRMED" as const,
            request: this.projection(row, false),
          };
    if (
      !row.sessionId ||
      row.mode !== "DIRECT" ||
      row.data.state !== "PROCESSING" ||
      !row.directStage ||
      !row.orderId
    )
      return fail();
    const scope = {
      orgId: row.orgId,
      outletId: row.outletId,
      sessionId: row.sessionId,
    };
    const accepted = {
      ...row,
      version: row.version + 1,
      data: { ...row.data, state: "ACCEPTED" as const },
    };
    const lines = row.directStage.lines.map((line) => ({
      itemId: line.itemId,
      menuItemId: line.menuItemId,
      categoryId: line.categoryId,
      quantity: line.quantity,
      notes: line.notes ?? "",
      expectedMenuItemVersion: line.expectedMenuItemVersion,
    }));
    try {
      await Engine.mutate(
        { ...scope, actorId: "guest:" + p.guestHandle },
        "SUBMIT_ORDER",
        {
          clientRequestId: id([row.data.requestId, "accept"]),
          expectedVersion: 1,
          items: lines.map((line) => ({
            itemId: line.itemId,
            expectedVersion: 1,
          })),
        },
        { orderId: row.orderId },
        {
          sessionId: row.sessionId,
          expiresAt: row.data.expiresAt,
          policyVersion: row.policyVersion,
          lines,
          direct: capability
            ? { capability, stage: row.directStage }
            : {
                bound: { ...row, expiresAt: row.data.expiresAt },
                stage: row.directStage,
              },
          actions: [
            this.put(
              this.key(scope, row.data.requestId),
              accepted,
              row.version,
            ),
          ],
        },
      );
    } catch (error) {
      const current = await this.row(scope, row.data.requestId);
      if (current?.data.state === "ACCEPTED")
        return {
          state: "CONFIRMED" as const,
          request: await this.directStatus(current),
        };
      if (
        error instanceof AppError &&
        [
          "RESTAURANTS_CONFIGURATION_CHANGED",
          "RESTAURANTS_PARENT_INACTIVE",
          "RESTAURANTS_CURRENCY_MISMATCH",
        ].includes(error.messageCode) &&
        current?.data.state === "PROCESSING"
      ) {
        const reconciled = await this.expireBound(current);
        return row.preService
          ? reconciled
          : { state: "REVIEW_REQUIRED" as const };
      }
      throw error;
    }
    return {
      state: "CONFIRMED" as const,
      request: await this.directStatus(accepted),
    };
  }
  private static async expireBound(row: RequestRow) {
    const scope = {
      orgId: row.orgId,
      outletId: row.outletId,
      sessionId: row.sessionId,
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.row(scope, row.data.requestId);
      if (!current) return fail();
      if (current.data.state === "ACCEPTED")
        return {
          state: "CONFIRMED" as const,
          request: await this.directStatus(current),
        };
      if (current.data.state === "EXPIRED")
        return { state: "CONFIRMED" as const, request: current.data };
      if (current.data.state !== "PROCESSING") return fail();
      const expired = {
        ...current,
        version: current.version + 1,
        data: { ...current.data, state: "EXPIRED" as const },
      };
      try {
        await dynamoClient.send(
          new TransactWriteItemsCommand({
            TransactItems: [
              this.put(
                this.key(scope, row.data.requestId),
                expired,
                current.version,
              ),
            ],
          }),
        );
        return { state: "CONFIRMED" as const, request: expired.data };
      } catch (error) {
        if (!conflict(error)) throw error;
      }
    }
    return fail();
  }
  private static async directStatus(row: RequestRow) {
    if (!row.orderId || !row.directStage || !row.sessionId) return fail();
    const scope = { orgId: row.orgId, outletId: row.outletId };
    const order = await Engine.order(scope, row.orderId);
    if (
      order.data.guestSessionId !== row.sessionId ||
      order.data.tableId !== row.tableId
    )
      return fail();
    const pk = K.restaurantOrderPK(scope.orgId, scope.outletId, row.orderId);
    const lines = (
      await R.batch(
        scope,
        row.directStage.lines.map((line) => ({
          PK: pk,
          SK: K.restaurantOrderItemSK(line.itemId),
        })),
        "LINE",
      )
    ).map((line) => {
      if (!line) return fail();
      return c.RestaurantOrderItemSchema.parse(line.data);
    });
    const preparationKeys = lines
      .filter((line) => line.status !== "CANCELLED" && line.snapshot?.stationId)
      .map((line) => {
        if (!line.latestFireId) return fail();
        return {
          PK: pk,
          SK: K.restaurantPreparationSK(line.itemId, line.latestFireId),
        };
      });
    const tasks = (await R.batch(scope, preparationKeys, "PREPARATION")).map(
      (row) => {
        if (!row) return fail();
        return c.RestaurantPreparationSchema.parse(row.data);
      },
    );
    const taskMap = new Map(tasks.map((task) => [task.itemId, task]));
    const statuses: (
      | "CONFIRMED"
      | "PREPARING"
      | "READY"
      | "SERVED"
      | "CANCELLED"
    )[] = lines.map((line) => {
      if (order.data.status === "CANCELLED" || line.status === "CANCELLED")
        return "CANCELLED";
      if (!line.snapshot?.stationId) return "CONFIRMED";
      const task = taskMap.get(line.itemId);
      if (!task || task.fireId !== line.latestFireId) return fail();
      return task.state === "SERVED"
        ? "SERVED"
        : task.state === "READY"
          ? "READY"
          : task.state === "CANCELLED"
            ? "CANCELLED"
            : "PREPARING";
    });
    const orderStatus = statuses.every((s) => s === "CANCELLED")
      ? "CANCELLED"
      : statuses.every((s) => s === "SERVED")
        ? "SERVED"
        : statuses.includes("PREPARING")
          ? "PREPARING"
          : statuses.includes("READY")
            ? "READY"
            : "CONFIRMED";
    return c.GuestOrderRequestSchema.parse({
      ...row.data,
      orderStatus,
      lines: row.data.lines.map((line, index) => ({
        ...line,
        fulfillment: statuses[index],
      })),
    });
  }
  /** Included in the canonical opening transaction: no orphan can migrate after opening. */
  static async bindOpening(
    session: c.GuestSession,
  ): Promise<TransactWriteItem[]> {
    const pre = {
      orgId: session.orgId,
      outletId: session.outletId,
      tableId: session.tableId,
    };
    const { coord, rows } = await this.rows(pre);
    if (!coord)
      return [
        {
          ConditionCheck: {
            TableName: restaurantsTableName(),
            Key: marshall(this.coordKey(pre)),
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
      ];
    const root = await Config.get(session.orgId, "restaurant", {});
    const table = await Config.get(
      session.orgId,
      "table",
      { outletId: session.outletId, serviceAreaId: session.areaId },
      session.tableId,
    );
    const qrFingerprint =
      table?.qrToken && !table.qrRevoked
        ? createHash("sha256").update(table.qrToken).digest("hex")
        : undefined;
    const actions: TransactWriteItem[] = [];
    const bound: string[] = [];
    for (const row of rows) {
      if (row.sessionId) continue;
      const valid =
        row.data.state === "PENDING_SERVICE" &&
        Date.parse(row.data.expiresAt) > Date.now() &&
        row.areaId === session.areaId &&
        !!qrFingerprint &&
        row.qrFingerprint === qrFingerprint &&
        root?.data.isActive &&
        root.data.guestOrderingPolicy === row.mode &&
        root.data.version === row.policyVersion;
      const next: RequestRow = {
        ...row,
        version: row.version + 1,
        ...(valid ? { sessionId: session.guestSessionId } : {}),
        data: {
          ...row.data,
          state: valid
            ? row.mode === "DIRECT"
              ? "PROCESSING"
              : "PENDING_APPROVAL"
            : "EXPIRED",
        },
      };
      if (valid && row.mode === "DIRECT") {
        next.orderId = id([row.data.requestId, "order"]);
        next.directStage = Engine.stageGuestOrder(
          { ...pre, actorId: "guest:" + row.guestHandle },
          session,
          next.orderId,
          row.items.map((ref, i) => ({
            itemId: id([row.data.requestId, "line", i]),
            menuItemId: ref.itemId,
            categoryId: ref.categoryId,
            quantity: row.data.lines[i].quantity,
            notes: row.data.lines[i].note,
            expectedMenuItemVersion: ref.itemVersion,
          })),
        );
      }
      actions.push(
        this.put(this.key(pre, row.data.requestId), next, row.version),
      );
      if (valid) {
        bound.push(row.data.requestId);
        actions.push(
          this.put(
            this.key(
              { ...pre, sessionId: session.guestSessionId },
              row.data.requestId,
            ),
            next,
          ),
        );
      }
      actions.push({
        Delete: {
          TableName: restaurantsTableName(),
          Key: marshall(
            K.restaurantWaiterActivityKey(
              pre.orgId,
              pre.outletId,
              row.data.submittedAt,
              row.data.requestId,
            ),
          ),
        },
      });
    }
    // Reclaim the bounded pre-service window. Old request keys stay for idempotency only.
    actions.push(
      this.put(
        this.coordKey(pre),
        {
          entityType: "RESTAURANT_GUEST_REQUEST_COORD",
          ...pre,
          version: coord.version + 1,
          ids: [],
        },
        coord.version,
      ),
    );
    if (bound.length)
      actions.push(
        this.put(this.coordKey({ ...pre, sessionId: session.guestSessionId }), {
          entityType: "RESTAURANT_GUEST_REQUEST_COORD",
          ...pre,
          sessionId: session.guestSessionId,
          version: 1,
          ids: bound,
        }),
      );
    return actions;
  }
  /** Retryable from opening replay and owned-state reads after a lost response. */
  static async continueOpening(session: c.GuestSession) {
    for (const row of (
      await this.rows({
        orgId: session.orgId,
        outletId: session.outletId,
        sessionId: session.guestSessionId,
      })
    ).rows) {
      if (
        row.preService &&
        row.mode === "DIRECT" &&
        row.data.state === "PROCESSING"
      )
        await this.continueBound(row);
    }
  }
  private static async continueBound(row: RequestRow) {
    return this.acceptDirect(undefined, row);
  }
  static async own(capability: string) {
    const v = await GuestService.verify(capability);
    if (!("principal" in v)) return v;
    const p = v.principal;

    const s = {
      orgId: p.orgId,
      outletId: p.outletId,
      sessionId: p.sessionId,
      tableId: p.tableId,
    };
    const { rows } = await this.rows(s);
    return {
      state: "READY" as const,
      waiterCall: await WaiterCalls.own(capability),
      requests: await Promise.all(
        rows
          .filter((r) => r.guestHandle === p.guestHandle)
          .map(async (r) => {
            if (
              r.preService &&
              r.mode === "DIRECT" &&
              r.data.state === "PROCESSING"
            ) {
              const result = await this.continueBound(r);
              if ("request" in result && result.request) return result.request;
              return this.projection(r, false);
            }
            const projected = this.projection(
              r,
              v.context.root.guestOrderingPolicy === r.mode &&
                r.policyVersion === v.context.root.version,
            );
            return r.mode === "DIRECT" && r.data.state === "ACCEPTED"
              ? this.directStatus(r)
              : projected;
          }),
      ),
    };
  }
  static async list(s: Scope, actor: string) {
    await WaiterCalls.authorize(s, actor);
    const valid = await this.policy(s);
    const root = await Config.get(s.orgId, "restaurant", {});
    return {
      requests: (await this.rows(s)).rows
        .filter(
          (r) =>
            r.mode === "STAFF_APPROVAL" ||
            (r.preService && r.mode === "DIRECT" && r.data.state === "EXPIRED"),
        )
        .map((r) =>
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
      if (!row || row.mode === "DIRECT")
        throw new AppError(404, "RESTAURANTS_NOT_FOUND");
      if (row.data.state === "ACCEPTED" && row.orderId)
        await Engine.order(s, row.orderId);
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
                    s.sessionId!,
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
            sessionId: s.sessionId!,
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
