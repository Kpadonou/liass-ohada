import { RestaurantServiceAccess } from "./service-access";
import { ResponsibleStaff } from "./responsible-staff";
import { randomUUID } from "crypto";
import { TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import * as contracts from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";
import {
  RestaurantKind,
  RestaurantParents,
  entitySK,
  entityTypes,
} from "./restaurant-model";
import {
  RestaurantsRepository,
  RestaurantSnapshot,
} from "./restaurant-repository";
import { restaurantsTableName } from "./restaurant-storage";
import {
  RestaurantTransactionsRepository as R,
  transactionFingerprint as fingerprint,
} from "./transaction-repository";
import {
  TransactionKey,
  TransactionKind,
  TransactionRow,
  TransactionScope,
} from "./transaction-model";

export interface RestaurantTransactionContext extends TransactionScope {
  actorId: string;
}
export const transactionRequestSchemas = {
  OPEN_SESSION: contracts.OpenGuestSessionRequestSchema,
  CLOSE_SESSION: contracts.CloseGuestSessionRequestSchema,
  REPLACE_RESPONSIBLE_STAFF:
    contracts.ReplaceGuestSessionResponsibleStaffRequestSchema,
  CREATE_ORDER: contracts.CreateRestaurantOrderRequestSchema,
  ADD_ITEM: contracts.AddRestaurantDraftItemRequestSchema,
  EDIT_ITEM: contracts.EditRestaurantDraftItemRequestSchema,
  CANCEL_ITEM: contracts.CancelRestaurantItemRequestSchema,
  SUBMIT_ORDER: contracts.SubmitRestaurantOrderRequestSchema,
  CANCEL_ORDER: contracts.CancelRestaurantOrderRequestSchema,
  CLOSE_ORDER: contracts.CloseRestaurantOrderRequestSchema,
} as const;
export type RestaurantTransactionCommand =
  keyof typeof transactionRequestSchemas;
type Business =
  | contracts.GuestSession
  | contracts.RestaurantOrder
  | contracts.RestaurantOrderItem;
const fail = (code = "RESTAURANTS_TRANSACTION_STATE", status = 409): never => {
  throw new AppError(status, code);
};
const safeMoney = (value: bigint): number =>
  value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)
    ? fail("RESTAURANTS_TRANSACTION_MONEY", 400)
    : Number(value);
const meta = (pk: string): TransactionKey => ({
  PK: pk,
  SK: K.restaurantTransactionMetaSK(),
});
const day = (t: string) => t.slice(0, 10).replace(/-/g, "");

/** Called only after the existing tenant/ProductAccess/command-permission wrapper authorizes the request. */
export class RestaurantTransactionsService {
  static async session(scope: TransactionScope, id: string) {
    const row = await R.get(
      scope,
      meta(K.restaurantSessionPK(scope.orgId, scope.outletId, id)),
      "SESSION",
    );
    if (
      !row ||
      !("guestSessionId" in row.data) ||
      row.data.guestSessionId !== id
    )
      return fail("RESTAURANTS_NOT_FOUND", 404);
    return row as TransactionRow & { data: contracts.GuestSession };
  }
  static async order(scope: TransactionScope, id: string) {
    const row = await R.get(
      scope,
      meta(K.restaurantOrderPK(scope.orgId, scope.outletId, id)),
      "ORDER",
    );
    if (!row || !("orderId" in row.data) || row.data.orderId !== id)
      return fail("RESTAURANTS_NOT_FOUND", 404);
    return row as TransactionRow & { data: contracts.RestaurantOrder };
  }
  static async line(scope: TransactionScope, orderId: string, itemId: string) {
    const row = await R.get(
      scope,
      {
        PK: K.restaurantOrderPK(scope.orgId, scope.outletId, orderId),
        SK: K.restaurantOrderItemSK(itemId),
      },
      "LINE",
    );
    if (
      !row ||
      !("itemId" in row.data) ||
      row.data.itemId !== itemId ||
      row.data.orderId !== orderId
    )
      return fail("RESTAURANTS_NOT_FOUND", 404);
    return row as TransactionRow & { data: contracts.RestaurantOrderItem };
  }
  static async activeTable(scope: TransactionScope, tableId: string) {
    const row = await R.get(
      scope,
      {
        PK: K.restaurantOccupancyPK(scope.orgId, scope.outletId, tableId),
        SK: K.restaurantOccupancySK(),
      },
      "OCCUPANCY",
    );
    if (!row) return { data: null };
    if (
      !("guestSessionId" in row.data) ||
      !("areaId" in row.data) ||
      row.data.tableId !== tableId
    )
      return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
    const session = await this.session(scope, row.data.guestSessionId);
    if (
      session.data.tableId !== tableId ||
      session.data.areaId !== row.data.areaId ||
      session.data.status !== "OPEN"
    )
      return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
    return { data: session.data };
  }
  private static async config(
    scope: TransactionScope,
    checks: Map<string, RestaurantSnapshot>,
    kind: RestaurantKind,
    parents: RestaurantParents,
    id?: string,
  ) {
    const sk = entitySK(kind, parents, id);
    const cached = checks.get(sk);
    if (cached) return cached;
    const row = await RestaurantsRepository.get(scope.orgId, kind, parents, id);
    if (!row) return fail("RESTAURANTS_NOT_FOUND", 404);
    if (!row.data.isActive) return fail("RESTAURANTS_PARENT_INACTIVE");
    const raced = checks.get(sk);
    if (raced && raced.data.version !== row.data.version)
      return fail("RESTAURANTS_CONFIGURATION_CHANGED");
    checks.set(sk, row);
    return row;
  }
  private static async foundation(
    scope: TransactionScope,
    checks: Map<string, RestaurantSnapshot>,
  ) {
    const root = await this.config(scope, checks, "restaurant", {});
    const outlet = await this.config(
      scope,
      checks,
      "outlet",
      {},
      scope.outletId,
    );
    if (
      !("restaurantId" in outlet.data) ||
      outlet.data.restaurantId !== root.data.id
    )
      return fail("RESTAURANTS_NOT_FOUND", 404);
    const menu = await this.config(scope, checks, "menu", {
      outletId: scope.outletId,
    });
    if (!("currency" in menu.data) || menu.data.outletId !== scope.outletId)
      return fail("RESTAURANTS_NOT_FOUND", 404);
    return menu as RestaurantSnapshot & { data: contracts.Menu };
  }
  private static async prepareLine(
    ctx: RestaurantTransactionContext,
    checks: Map<string, RestaurantSnapshot>,
    orderId: string,
    selected: { itemId: string; expectedVersion: number },
    menu: RestaurantSnapshot & { data: contracts.Menu },
    currency: string,
    now: string,
    submissionId: string,
  ) {
    const line = await this.line(ctx, orderId, selected.itemId);
    if (
      line.data.status !== "DRAFT" ||
      line.data.version !== selected.expectedVersion
    )
      return fail("RESTAURANTS_WRITE_CONFLICT");
    const category = await this.config(
      ctx,
      checks,
      "category",
      { outletId: ctx.outletId },
      line.data.categoryId,
    );
    const item = await this.config(
      ctx,
      checks,
      "item",
      { outletId: ctx.outletId, categoryId: line.data.categoryId },
      line.data.menuItemId,
    );
    if (
      !("menuId" in category.data) ||
      category.data.menuId !== menu.data.id ||
      !("price" in item.data) ||
      item.data.menuId !== menu.data.id ||
      item.data.version !== line.data.expectedMenuItemVersion ||
      item.data.availability !== "AVAILABLE"
    )
      return fail("RESTAURANTS_CONFIGURATION_CHANGED");
    if (item.data.price.currency !== currency)
      return fail("RESTAURANTS_CURRENCY_MISMATCH", 400);
    const station = item.data.preparationStationId
      ? await this.config(
          ctx,
          checks,
          "station",
          { outletId: ctx.outletId },
          item.data.preparationStationId,
        )
      : undefined;
    const amount = safeMoney(
      BigInt(item.data.price.amountMinor) * BigInt(line.data.quantity),
    );
    const snapshot = contracts.AcceptedSaleSnapshotSchema.parse({
      menuItemId: item.data.id,
      categoryId: line.data.categoryId,
      menuId: menu.data.id,
      itemVersion: item.data.version,
      categoryVersion: category.data.version,
      menuVersion: menu.data.version,
      name: item.data.name,
      stationId: item.data.preparationStationId,
      stationVersion: station?.data.version,
      quantity: line.data.quantity,
      unitPriceMinor: item.data.price.amountMinor,
      grossMinor: amount,
      subtotalMinor: amount,
      discountMinor: 0,
      taxMinor: 0,
      lineTotalMinor: amount,
      currency: currency,
      acceptedAt: now,
      acceptedBy: ctx.actorId,
      submissionId,
    });

    return { line, snapshot, amount };
  }
  private static editable(
    order: contracts.RestaurantOrder,
    expectedVersion: number,
  ) {
    if (order.version !== expectedVersion)
      return fail("RESTAURANTS_WRITE_CONFLICT");
    if (order.status !== "DRAFT" && order.status !== "SUBMITTED") return fail();
  }
  static async mutate(
    ctx: RestaurantTransactionContext,
    command: RestaurantTransactionCommand,
    input: unknown,
    ids: { sessionId?: string; orderId?: string; itemId?: string } = {},
  ): Promise<{ data: Business }> {
    const startedAt = Date.now();
    contracts.RestaurantIdSchema.parse(ctx.outletId);
    const request = transactionRequestSchemas[command].parse(input);
    const owner =
      command === "OPEN_SESSION" || command === "CREATE_ORDER"
        ? "NEW"
        : ["CLOSE_SESSION", "REPLACE_RESPONSIBLE_STAFF"].includes(command)
          ? contracts.RestaurantIdSchema.parse(ids.sessionId)
          : contracts.RestaurantIdSchema.parse(ids.orderId);
    const hash = fingerprint([
      ctx.orgId,
      ctx.outletId,
      command,
      owner,
      request.clientRequestId,
    ]);
    const intent = fingerprint([ctx.actorId, command, ids, request]);
    const commandKey = {
      PK: K.restaurantTransactionCommandPK(
        ctx.orgId,
        ctx.outletId,
        command,
        owner,
        hash,
      ),
      SK: K.restaurantTransactionCommandSK(owner, hash),
    };
    const replay = async (): Promise<Business | undefined> => {
      const row = await R.get(ctx, commandKey, "COMMAND");
      if (!row) return undefined;
      if (
        !("lookupHash" in row.data) ||
        row.data.lookupHash !== hash ||
        row.data.commandKind !== command ||
        row.data.ownerId !== owner ||
        row.data.fingerprint !== intent
      )
        return fail("RESTAURANTS_IDEMPOTENCY_CONFLICT");
      return row.data.result;
    };
    const responsibleActor =
      command === "REPLACE_RESPONSIBLE_STAFF"
        ? await ResponsibleStaff.authorize(ctx, ctx.actorId)
        : undefined;
    const serviceAccess =
      command === "OPEN_SESSION"
        ? await RestaurantServiceAccess.authorize(ctx, ctx.actorId)
        : undefined;
    const prior = await replay();
    if (prior) {
      console.info("[RESTAURANTS_TRANSACTION]", {
        command,
        result: "REPLAYED",
        latencyMs: Date.now() - startedAt,
      });
      return { data: prior };
    }
    const now = new Date().toISOString(),
      commandId = randomUUID();
    const checks = new Map<string, RestaurantSnapshot>();
    const actions: TransactWriteItem[] = [...(serviceAccess?.actions ?? [])];
    const serviceGuardCount = actions.length;
    const put = (
      kind: TransactionKind,
      key: TransactionKey,
      data: Parameters<typeof R.row>[3],
      previous?: TransactionRow,
    ) => {
      const row = R.row(ctx, key, kind, data);
      actions.push(R.put(row, previous));
      return row;
    };
    const locator = (
      kind: TransactionKind,
      pk: string,
      target: contracts.GuestSession | contracts.RestaurantOrder,
      sk?: string,
    ) => {
      const session = "guestSessionId" in target && !("orderId" in target);
      const targetId = session
        ? (target as contracts.GuestSession).guestSessionId
        : (target as contracts.RestaurantOrder).orderId;
      const timestamp = session
        ? (target as contracts.GuestSession).openedAt
        : (target as contracts.RestaurantOrder).createdAt;
      return put(
        kind,
        {
          PK: pk,
          SK: sk ?? K.restaurantTransactionLocatorSK(timestamp, targetId),
        },
        {
          targetId,
          targetKind: session ? "SESSION" : "ORDER",
          timestamp,
          ...(target.guestSessionId
            ? { guestSessionId: target.guestSessionId }
            : {}),
          ...(target.tableId ? { tableId: target.tableId } : {}),
        },
      );
    };
    const remove = async (
      kind: TransactionKind,
      key: TransactionKey,
      targetId: string,
    ) => {
      const row = await R.get(ctx, key, kind);
      if (!row || !("targetId" in row.data) || row.data.targetId !== targetId)
        return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
      actions.push(R.remove(row));
    };
    const audit = (
      target: contracts.GuestSession | contracts.RestaurantOrder,
      oldState?: string,
      reason?: string,
      responsibility?: {
        tableId: string;
        before: string | null;
        after: string | null;
        beforeDisplayName: string | null;
        afterDisplayName: string | null;
      },
    ) => {
      const isOrder = "orderId" in target;
      const id = isOrder ? target.orderId : target.guestSessionId;
      const pk = isOrder
        ? K.restaurantOrderPK(ctx.orgId, ctx.outletId, id)
        : K.restaurantSessionPK(ctx.orgId, ctx.outletId, id);
      const data = {
        commandId,
        actorId: ctx.actorId,
        action: command,
        targetId: id,
        committedAt: now,
        version: target.version,
        fromState: oldState,
        toState: target.status,
        reason,
        responsibility,
      };
      put(
        "AUDIT",
        { PK: pk, SK: K.restaurantTransactionAuditSK(now, commandId) },
        data,
      );
      return data;
    };
    let result: Business;
    let activity: ReturnType<typeof audit>;
    if (command === "OPEN_SESSION") {
      const req = contracts.OpenGuestSessionRequestSchema.parse(request);
      const menu = await this.foundation(ctx, checks);
      await this.config(
        ctx,
        checks,
        "serviceArea",
        { outletId: ctx.outletId },
        req.areaId,
      );
      const table = await this.config(
        ctx,
        checks,
        "table",
        { outletId: ctx.outletId, serviceAreaId: req.areaId },
        req.tableId,
      );
      if (
        !("code" in table.data) ||
        table.data.outletId !== ctx.outletId ||
        table.data.serviceAreaId !== req.areaId
      )
        return fail("RESTAURANTS_NOT_FOUND", 404);
      const tableId = req.tableId,
        guestSessionId = randomUUID();
      const occupied = await R.get(
        ctx,
        {
          PK: K.restaurantOccupancyPK(ctx.orgId, ctx.outletId, tableId),
          SK: K.restaurantOccupancySK(),
        },
        "OCCUPANCY",
      );
      if (occupied) return fail("RESTAURANTS_TABLE_OCCUPIED");
      result = contracts.GuestSessionSchema.parse({
        orgId: ctx.orgId,
        outletId: ctx.outletId,
        schemaVersion: 1,
        guestSessionId,
        tableId,
        areaId: req.areaId,
        tableCode: table.data.code,
        tableName: table.data.name,
        currency: menu.data.currency,
        partySize: req.partySize,
        status: "OPEN",
        openedAt: now,
        openedBy: ctx.actorId,
        responsibleStaffId: serviceAccess?.staffId,
        version: 1,
        financialRevision: 0,
        orderCount: 0,
        openOrderCount: 0,
        dueMinor: 0,
        paidMinor: 0,
        reservedMinor: 0,
        pendingPaymentCount: 0,
      });
      put(
        "SESSION",
        meta(K.restaurantSessionPK(ctx.orgId, ctx.outletId, guestSessionId)),
        result,
      );
      put(
        "OCCUPANCY",
        {
          PK: K.restaurantOccupancyPK(ctx.orgId, ctx.outletId, tableId),
          SK: K.restaurantOccupancySK(),
        },
        { guestSessionId, tableId, areaId: req.areaId },
      );
      locator(
        "ACTIVE_SESSION",
        K.restaurantTransactionActivePK(ctx.orgId, ctx.outletId, "GS"),
        result,
      );
      locator(
        "SESSION_HISTORY",
        K.restaurantTransactionHistoryPK(
          ctx.orgId,
          ctx.outletId,
          "GS",
          day(now),
        ),
        result,
      );
      locator(
        "TABLE_SESSION_HISTORY",
        K.restaurantTransactionHistoryPK(
          ctx.orgId,
          ctx.outletId,
          "GS",
          day(now),
          tableId,
        ),
        result,
      );
      activity = audit(
        result,
        undefined,
        undefined,
        serviceAccess?.staffId
          ? {
              tableId,
              before: null,
              after: serviceAccess.staffId,
              beforeDisplayName: null,
              afterDisplayName: serviceAccess.displayName ?? null,
            }
          : undefined,
      );
    } else if (command === "CREATE_ORDER") {
      const req = contracts.CreateRestaurantOrderRequestSchema.parse(request);
      const menu = await this.foundation(ctx, checks);
      const session = req.guestSessionId
        ? await this.session(ctx, req.guestSessionId)
        : undefined;
      if (
        session &&
        (session.data.status !== "OPEN" ||
          session.data.orderCount >= 50 ||
          session.data.currency !== menu.data.currency)
      )
        return fail();
      const orderId = randomUUID();
      result = contracts.RestaurantOrderSchema.parse({
        orgId: ctx.orgId,
        outletId: ctx.outletId,
        schemaVersion: 1,
        orderId,
        orderType: req.orderType,
        guestSessionId: session?.data.guestSessionId,
        tableId: session?.data.tableId,
        status: "DRAFT",
        currency: menu.data.currency,
        createdAt: now,
        createdBy: ctx.actorId,
        version: 1,
        financialRevision: 0,
        lineCount: 0,
        acceptedLineCount: 0,
        draftLineCount: 0,
        dueMinor: 0,
        paidMinor: 0,
        reservedMinor: 0,
        pendingPaymentCount: 0,
      });
      put(
        "ORDER",
        meta(K.restaurantOrderPK(ctx.orgId, ctx.outletId, orderId)),
        result,
      );
      locator(
        "ACTIVE_ORDER",
        K.restaurantTransactionActivePK(ctx.orgId, ctx.outletId, "ORD"),
        result,
      );
      locator(
        "ORDER_HISTORY",
        K.restaurantTransactionHistoryPK(
          ctx.orgId,
          ctx.outletId,
          "ORD",
          day(now),
        ),
        result,
      );
      if (session) {
        const next = {
          ...session.data,
          orderCount: session.data.orderCount + 1,
          openOrderCount: session.data.openOrderCount + 1,
          version: session.data.version + 1,
        };
        put("SESSION", { PK: session.PK, SK: session.SK }, next, session);
        locator(
          "SESSION_ORDER",
          session.PK,
          result,
          K.restaurantSessionOrderSK(now, orderId),
        );
        locator(
          "OPEN_SESSION_ORDER",
          session.PK,
          result,
          K.restaurantSessionOrderSK(now, orderId, true),
        );
        audit(next, session.data.status);
      }
      activity = audit(result);
    } else if (command === "REPLACE_RESPONSIBLE_STAFF") {
      const req =
        contracts.ReplaceGuestSessionResponsibleStaffRequestSchema.parse(
          request,
        );
      const session = await this.session(ctx, owner);
      if (session.data.version !== req.expectedVersion)
        return fail("RESTAURANTS_WRITE_CONFLICT");
      if (session.data.status !== "OPEN") return fail();
      if (req.staffId !== null)
        await this.config(ctx, checks, "outlet", {}, ctx.outletId);
      actions.push(
        ...(await ResponsibleStaff.checks(ctx, responsibleActor!, req.staffId)),
      );
      const names = await ResponsibleStaff.read(
        ctx,
        [session.data.responsibleStaffId, req.staffId].filter(
          (id): id is string => !!id,
        ),
      );
      result = contracts.GuestSessionSchema.parse({
        ...session.data,
        responsibleStaffId: req.staffId ?? undefined,
        version: session.data.version + 1,
      });
      put("SESSION", { PK: session.PK, SK: session.SK }, result, session);
      activity = audit(result, session.data.status, undefined, {
        tableId: session.data.tableId,
        before: session.data.responsibleStaffId ?? null,
        after: req.staffId,
        beforeDisplayName:
          names.get(session.data.responsibleStaffId ?? "")?.displayName ?? null,
        afterDisplayName: names.get(req.staffId ?? "")?.displayName ?? null,
      });
    } else if (command === "CLOSE_SESSION") {
      const req = contracts.CloseGuestSessionRequestSchema.parse(request),
        session = await this.session(ctx, owner);
      if (session.data.version !== req.expectedVersion)
        return fail("RESTAURANTS_WRITE_CONFLICT");
      if (
        session.data.status !== "OPEN" ||
        session.data.openOrderCount ||
        session.data.dueMinor !== session.data.paidMinor ||
        session.data.reservedMinor ||
        session.data.pendingPaymentCount
      )
        return fail("RESTAURANTS_UNPAID_CLOSE");
      result = {
        ...session.data,
        status: "CLOSED",
        closedAt: now,
        closedBy: ctx.actorId,
        version: session.data.version + 1,
      };
      put("SESSION", { PK: session.PK, SK: session.SK }, result, session);
      const pointer = await R.get(
        ctx,
        {
          PK: K.restaurantOccupancyPK(
            ctx.orgId,
            ctx.outletId,
            session.data.tableId,
          ),
          SK: K.restaurantOccupancySK(),
        },
        "OCCUPANCY",
      );
      if (
        !pointer ||
        !("guestSessionId" in pointer.data) ||
        pointer.data.guestSessionId !== owner
      )
        return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
      actions.push(R.remove(pointer));
      await remove(
        "ACTIVE_SESSION",
        {
          PK: K.restaurantTransactionActivePK(ctx.orgId, ctx.outletId, "GS"),
          SK: K.restaurantTransactionLocatorSK(session.data.openedAt, owner),
        },
        owner,
      );
      activity = audit(result, session.data.status);
    } else {
      const order = await this.order(ctx, owner);
      this.editable(
        order.data,
        (request as { expectedVersion: number }).expectedVersion,
      );
      const next = { ...order.data, version: order.data.version + 1 };
      let delta = 0;
      let financialChanged = false;
      if (command === "ADD_ITEM" || command === "EDIT_ITEM") {
        const req =
          command === "ADD_ITEM"
            ? contracts.AddRestaurantDraftItemRequestSchema.parse(request)
            : contracts.EditRestaurantDraftItemRequestSchema.parse(request);
        const old =
          command === "EDIT_ITEM"
            ? await this.line(
                ctx,
                owner,
                contracts.RestaurantIdSchema.parse(ids.itemId),
              )
            : undefined;
        if (
          old &&
          (old.data.status !== "DRAFT" ||
            old.data.version !==
              contracts.EditRestaurantDraftItemRequestSchema.parse(request)
                .expectedItemVersion)
        )
          return fail("RESTAURANTS_WRITE_CONFLICT");
        if (!old && order.data.lineCount >= 200)
          return fail("RESTAURANTS_TRANSACTION_LIMIT", 400);
        const menu = await this.foundation(ctx, checks);
        const category = await this.config(
          ctx,
          checks,
          "category",
          { outletId: ctx.outletId },
          req.categoryId,
        );
        const item = await this.config(
          ctx,
          checks,
          "item",
          { outletId: ctx.outletId, categoryId: req.categoryId },
          req.menuItemId,
        );
        if (
          !("menuId" in category.data) ||
          category.data.menuId !== menu.data.id ||
          !("price" in item.data) ||
          item.data.menuId !== menu.data.id ||
          item.data.categoryId !== req.categoryId ||
          item.data.version !== req.expectedMenuItemVersion
        )
          return fail("RESTAURANTS_CONFIGURATION_CHANGED");
        const itemId = old?.data.itemId ?? randomUUID();
        result = contracts.RestaurantOrderItemSchema.parse({
          orgId: ctx.orgId,
          outletId: ctx.outletId,
          schemaVersion: 1,
          orderId: owner,
          itemId,
          menuItemId: req.menuItemId,
          categoryId: req.categoryId,
          quantity: req.quantity,
          notes: req.notes,
          expectedMenuItemVersion: req.expectedMenuItemVersion,
          status: "DRAFT",
          version: (old?.data.version ?? 0) + 1,
          createdAt: old?.data.createdAt ?? now,
        });
        put(
          "LINE",
          { PK: order.PK, SK: K.restaurantOrderItemSK(itemId) },
          result,
          old,
        );
        if (!old) {
          next.lineCount++;
          next.draftLineCount++;
        }
      } else if (command === "SUBMIT_ORDER") {
        const req = contracts.SubmitRestaurantOrderRequestSchema.parse(request),
          menu = await this.foundation(ctx, checks),
          submissionId = randomUUID();
        if (menu.data.currency !== order.data.currency)
          return fail("RESTAURANTS_CURRENCY_MISMATCH", 400);
        const prepared: Awaited<ReturnType<typeof this.prepareLine>>[] = [];
        for (let offset = 0; offset < req.items.length; offset += 4) {
          const results = await Promise.allSettled(
            req.items
              .slice(offset, offset + 4)
              .map((selected) =>
                this.prepareLine(
                  ctx,
                  checks,
                  owner,
                  selected,
                  menu,
                  order.data.currency,
                  now,
                  submissionId,
                ),
              ),
          );
          for (const result of results) {
            if (result.status === "rejected") throw result.reason;
            prepared.push(result.value);
          }
        }
        for (const { line, snapshot, amount } of prepared) {
          put(
            "LINE",
            { PK: line.PK, SK: line.SK },
            {
              ...line.data,
              status: "ACCEPTED",
              snapshot,
              version: line.data.version + 1,
            },
            line,
          );
          delta = safeMoney(BigInt(delta) + BigInt(amount));
        }
        next.status = "SUBMITTED";
        next.acceptedLineCount += req.items.length;
        next.draftLineCount -= req.items.length;
        next.financialRevision++;
        financialChanged = true;
        put(
          "SUBMISSION",
          { PK: order.PK, SK: K.restaurantSubmissionSK(submissionId) },
          {
            orderId: owner,
            submissionId,
            count: req.items.length,
            fingerprint: intent,
            actorId: ctx.actorId,
            committedAt: now,
          },
        );
        result = next;
      } else if (command === "CANCEL_ITEM") {
        const req = contracts.CancelRestaurantItemRequestSchema.parse(request),
          line = await this.line(
            ctx,
            owner,
            contracts.RestaurantIdSchema.parse(ids.itemId),
          );
        if (line.data.version !== req.expectedItemVersion)
          return fail("RESTAURANTS_WRITE_CONFLICT");
        if (line.data.status === "CANCELLED") return fail();
        if (line.data.status === "ACCEPTED") {
          if (!line.data.snapshot)
            return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
          delta = -line.data.snapshot.lineTotalMinor;
          next.financialRevision++;
          financialChanged = true;
        } else next.draftLineCount--;
        result = {
          ...line.data,
          status: "CANCELLED",
          cancelledAt: now,
          cancelledBy: ctx.actorId,
          cancellationReason: req.reason,
          version: line.data.version + 1,
        };
        put("LINE", { PK: line.PK, SK: line.SK }, result, line);
      } else {
        const cancel = command === "CANCEL_ORDER";
        if (
          next.dueMinor !== next.paidMinor ||
          next.reservedMinor ||
          next.pendingPaymentCount ||
          next.draftLineCount ||
          (cancel && next.paidMinor)
        )
          return fail("RESTAURANTS_UNPAID_CLOSE");
        if (!cancel && (next.status !== "SUBMITTED" || !next.acceptedLineCount))
          return fail();
        // Do not pretend station-routed complimentary items were fulfilled before LR-TX-2.
        if (!cancel) {
          const lines = await this.allLines(ctx, owner);
          if (
            lines.some((l) => l.status === "ACCEPTED" && l.snapshot?.stationId)
          )
            return fail("RESTAURANTS_PREPARATION_DEFERRED");
        }
        next.status = cancel ? "CANCELLED" : "CLOSED";
        next.closedAt = now;
        next.closedBy = ctx.actorId;
        await remove(
          "ACTIVE_ORDER",
          {
            PK: K.restaurantTransactionActivePK(ctx.orgId, ctx.outletId, "ORD"),
            SK: K.restaurantTransactionLocatorSK(next.createdAt, owner),
          },
          owner,
        );
        result = next;
      }
      next.dueMinor = safeMoney(BigInt(next.dueMinor) + BigInt(delta));
      if (next.dueMinor < next.paidMinor + next.reservedMinor) return fail();
      put("ORDER", { PK: order.PK, SK: order.SK }, next, order);
      const isTerminal =
        next.status === "CLOSED" || next.status === "CANCELLED";
      if (isTerminal && next.waiterId)
        await remove(
          "WAITER",
          {
            PK: K.restaurantWaiterActivePK(
              ctx.orgId,
              ctx.outletId,
              next.waiterId,
            ),
            SK: K.restaurantTransactionLocatorSK(next.createdAt, owner),
          },
          owner,
        );
      if (
        order.data.dueMinor > order.data.paidMinor &&
        next.dueMinor === next.paidMinor
      )
        await remove(
          "UNPAID",
          {
            PK: K.restaurantTransactionActivePK(
              ctx.orgId,
              ctx.outletId,
              "UNPAID",
            ),
            SK: K.restaurantTransactionLocatorSK(next.createdAt, owner),
          },
          owner,
        );
      if (
        order.data.dueMinor === order.data.paidMinor &&
        next.dueMinor > next.paidMinor
      )
        locator(
          "UNPAID",
          K.restaurantTransactionActivePK(ctx.orgId, ctx.outletId, "UNPAID"),
          next,
        );
      if (next.guestSessionId && (financialChanged || isTerminal)) {
        const session = await this.session(ctx, next.guestSessionId);
        if (
          session.data.status !== "OPEN" ||
          session.data.currency !== next.currency ||
          (isTerminal && !session.data.openOrderCount)
        )
          return fail();
        const updated = {
          ...session.data,
          dueMinor: safeMoney(BigInt(session.data.dueMinor) + BigInt(delta)),
          openOrderCount: session.data.openOrderCount - (isTerminal ? 1 : 0),
          financialRevision:
            session.data.financialRevision + (financialChanged ? 1 : 0),
          version: session.data.version + 1,
        };
        if (updated.dueMinor < updated.paidMinor + updated.reservedMinor)
          return fail();
        put("SESSION", { PK: session.PK, SK: session.SK }, updated, session);
        if (isTerminal)
          await remove(
            "OPEN_SESSION_ORDER",
            {
              PK: session.PK,
              SK: K.restaurantSessionOrderSK(next.createdAt, owner, true),
            },
            owner,
          );
        audit(updated, session.data.status);
      }
      activity = audit(
        next,
        order.data.status,
        "reason" in request && typeof request.reason === "string"
          ? request.reason
          : undefined,
      );
    }
    put(
      "ACTIVITY",
      {
        PK: K.restaurantTransactionHistoryPK(
          ctx.orgId,
          ctx.outletId,
          "ACT",
          day(now),
        ),
        SK: K.restaurantTransactionLocatorSK(now, commandId),
      },
      activity,
    );
    put("COMMAND", commandKey, {
      commandId,
      commandKind: command,
      ownerId: owner,
      lookupHash: hash,
      fingerprint: intent,
      committedAt: now,
      result,
    });
    for (const [sk, check] of checks)
      actions.push({
        ConditionCheck: {
          TableName: restaurantsTableName(),
          Key: marshall({ PK: K.orgKey(ctx.orgId), SK: sk }),
          ConditionExpression:
            "entityType = :type AND orgId = :org AND #data.#id = :id AND #data.#version = :version AND #data.#active = :active",
          ExpressionAttributeNames: {
            "#data": "data",
            "#id": "id",
            "#version": "version",
            "#active": "isActive",
          },
          ExpressionAttributeValues: marshall({
            ":org": ctx.orgId,
            ":type": entityTypes[check.kind],
            ":id": check.data.id,
            ":version": check.data.version,
            ":active": true,
          }),
        },
      });
    try {
      await R.commit(actions);
    } catch (error) {
      const serviceGuardFailed =
        serviceGuardCount > 0 &&
        error &&
        typeof error === "object" &&
        "CancellationReasons" in error &&
        Array.isArray(error.CancellationReasons) &&
        error.CancellationReasons.slice(0, serviceGuardCount).some(
          (reason: { Code?: string }) =>
            reason.Code === "ConditionalCheckFailed",
        );
      if (serviceGuardFailed)
        throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
      if (serviceAccess)
        await RestaurantServiceAccess.authorize(ctx, ctx.actorId);
      const committed = await replay();
      if (committed) return { data: committed };
      const name = error instanceof Error ? error.name : "";
      const reasons =
        error &&
        typeof error === "object" &&
        "CancellationReasons" in error &&
        Array.isArray(error.CancellationReasons)
          ? error.CancellationReasons.slice(0, 90).map((reason: unknown) =>
              reason &&
              typeof reason === "object" &&
              "Code" in reason &&
              typeof reason.Code === "string"
                ? reason.Code
                : "Unknown",
            )
          : [];
      const configurationConflict = reasons.some(
        (code, index) =>
          code === "ConditionalCheckFailed" &&
          index >= actions.length - checks.size,
      );
      const cancellationCategories = [
        ...new Set(
          reasons.filter((code) =>
            [
              "ConditionalCheckFailed",
              "TransactionConflict",
              "ProvisionedThroughputExceeded",
              "ThrottlingError",
              "ValidationError",
              "ItemCollectionSizeLimitExceeded",
            ].includes(code),
          ),
        ),
      ];
      console.warn("[RESTAURANTS_TRANSACTION]", {
        command,
        result: "REJECTED",
        conflictClass: name,
        cancellationCategories,
        latencyMs: Date.now() - startedAt,
      });
      if (
        name === "TransactionCanceledException" ||
        name === "ConditionalCheckFailedException"
      )
        return fail(
          configurationConflict
            ? "RESTAURANTS_CONFIGURATION_CHANGED"
            : command === "OPEN_SESSION"
              ? "RESTAURANTS_TABLE_OCCUPIED"
              : "RESTAURANTS_WRITE_CONFLICT",
        );
      throw error;
    }
    console.info("[RESTAURANTS_TRANSACTION]", {
      command,
      result: "COMMITTED",
      actionCount: actions.length,
      aggregateId: activity.targetId,
      commandId,
      latencyMs: Date.now() - startedAt,
    });
    return { data: result };
  }
  static async allLines(
    scope: TransactionScope,
    orderId: string,
  ): Promise<contracts.RestaurantOrderItem[]> {
    const items: contracts.RestaurantOrderItem[] = [];
    let cursor: string | undefined;
    do {
      const page = await R.query(
        scope,
        K.restaurantOrderPK(scope.orgId, scope.outletId, orderId),
        K.restaurantOrderItemPrefix(),
        "LINE",
        { limit: 100, cursor },
      );
      for (const row of page.rows) {
        const line = contracts.RestaurantOrderItemSchema.parse(row.data);
        if (line.orderId !== orderId)
          return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
        items.push(line);
      }
      cursor = page.nextCursor;
      if (items.length > 200) return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
    } while (cursor);
    return items;
  }
}
