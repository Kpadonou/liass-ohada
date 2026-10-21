import { ResponsibleStaff } from "./responsible-staff";
import { RestaurantServiceFloor } from "./service-floor-query";
import { z } from "zod";
import * as contracts from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";
import { RestaurantsService } from "./restaurant-service";
import {
  RestaurantTransactionsRepository as R,
  transactionFingerprint,
} from "./transaction-repository";
import { RestaurantTransactionsService as S } from "./transaction-service";
import { TransactionRow, TransactionScope } from "./transaction-model";

export type TransactionQuery =
  | "SERVICE_FLOOR"
  | "GET_SESSION"
  | "GET_ORDER"
  | "ACTIVE_TABLE"
  | "ACTIVE_SESSIONS"
  | "ACTIVE_ORDERS"
  | "UNPAID_ORDERS"
  | "SESSION_ORDERS"
  | "TABLE_ORDERS"
  | "ORDER_ITEMS"
  | "SESSION_HISTORY"
  | "TABLE_SESSION_HISTORY"
  | "ORDER_HISTORY";
type QueryIds = { sessionId?: string; orderId?: string; tableId?: string };
type QueryPage = {
  items: (
    | contracts.GuestSession
    | contracts.RestaurantOrder
    | contracts.RestaurantOrderItem
  )[];
  nextCursor?: string;
};
type QueryResult =
  | QueryPage
  | contracts.RestaurantServiceFloorResponse
  | { data: contracts.GuestSession | contracts.RestaurantOrder | null };
export class RestaurantTransactionQueries {
  static async hydrate(
    scope: TransactionScope,
    rows: TransactionRow[],
    expectedSession?: string,
  ) {
    const items: (contracts.GuestSession | contracts.RestaurantOrder)[] = [];
    for (let i = 0; i < rows.length; i += 8) {
      const page = await Promise.all(
        rows.slice(i, i + 8).map(async (row) => {
          if (!("targetKind" in row.data) || !("targetId" in row.data))
            throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
          const target =
            row.data.targetKind === "SESSION"
              ? await S.session(scope, row.data.targetId)
              : await S.order(scope, row.data.targetId);
          if (expectedSession && target.data.guestSessionId !== expectedSession)
            throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
          return target.data;
        }),
      );
      items.push(...page);
    }
    const sessions = await ResponsibleStaff.sessions(
      scope,
      items.filter(
        (item): item is contracts.GuestSession => !("orderId" in item),
      ),
    );
    const byId = new Map(sessions.map((s) => [s.guestSessionId, s]));
    return items.map((item) =>
      "orderId" in item ? item : byId.get(item.guestSessionId)!,
    );
  }
  static run(
    scope: TransactionScope,
    query: Exclude<
      TransactionQuery,
      "GET_SESSION" | "GET_ORDER" | "ACTIVE_TABLE" | "SERVICE_FLOOR"
    >,
    request: unknown,
    ids?: QueryIds,
    serviceOrderRead?: boolean,
    checkoutRead?: boolean,
  ): Promise<QueryPage>;
  static run(
    scope: TransactionScope,
    query: TransactionQuery,
    request: unknown,
    ids?: QueryIds,
    serviceOrderRead?: boolean,
    checkoutRead?: boolean,
  ): Promise<QueryResult>;
  static async run(
    scope: TransactionScope,
    query: TransactionQuery,
    request: unknown,
    ids: QueryIds = {},
    serviceOrderRead = false,
    checkoutRead = false,
  ): Promise<QueryResult> {
    await RestaurantsService.get(scope.orgId, "outlet", {}, scope.outletId);
    if (query === "SERVICE_FLOOR")
      return RestaurantServiceFloor.read(scope, request);
    if (query === "GET_SESSION") {
      const session = (
        await S.session(
          scope,
          contracts.RestaurantIdSchema.parse(ids.sessionId),
        )
      ).data;
      if (checkoutRead && session.status !== "OPEN")
        throw new AppError(404, "RESTAURANTS_NOT_FOUND");
      return { data: (await ResponsibleStaff.sessions(scope, [session]))[0] };
    }
    if (query === "GET_ORDER") {
      const order = (
        await S.order(scope, contracts.RestaurantIdSchema.parse(ids.orderId))
      ).data;
      if (serviceOrderRead) await this.requireOpenOrderSession(scope, order);
      return { data: order };
    }
    if (query === "ACTIVE_TABLE") {
      const result = await S.activeTable(
        scope,
        contracts.RestaurantIdSchema.parse(ids.tableId),
      );
      return {
        data: result.data
          ? (await ResponsibleStaff.sessions(scope, [result.data]))[0]
          : null,
      };
    }
    if (
      query === "SESSION_HISTORY" ||
      query === "TABLE_SESSION_HISTORY" ||
      query === "ORDER_HISTORY"
    )
      return this.history(scope, query, request, ids.tableId);
    const input =
      contracts.RestaurantTransactionListRequestSchema.parse(request);
    if (query === "ORDER_ITEMS") {
      const orderId = contracts.RestaurantIdSchema.parse(ids.orderId);
      const order = (await S.order(scope, orderId)).data;
      if (serviceOrderRead) await this.requireOpenOrderSession(scope, order);
      const page = await R.query(
        scope,
        K.restaurantOrderPK(scope.orgId, scope.outletId, orderId),
        K.restaurantOrderItemPrefix(),
        "LINE",
        input,
      );
      const items = page.rows.map((row) => {
        const line = contracts.RestaurantOrderItemSchema.parse(row.data);
        if (
          line.orderId !== orderId ||
          row.SK !== K.restaurantOrderItemSK(line.itemId)
        )
          throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
        return line;
      });
      return {
        items: checkoutRead
          ? items.filter((line) => line.snapshot !== undefined)
          : items,
        nextCursor: page.nextCursor,
      };
    }
    if (query === "SESSION_ORDERS" || query === "TABLE_ORDERS") {
      const sessionId =
        query === "TABLE_ORDERS"
          ? (
              await S.activeTable(
                scope,
                contracts.RestaurantIdSchema.parse(ids.tableId),
              )
            ).data?.guestSessionId
          : contracts.RestaurantIdSchema.parse(ids.sessionId);
      if (!sessionId) return { items: [] };
      const session = (await S.session(scope, sessionId)).data;
      if (serviceOrderRead && session.status !== "OPEN")
        throw new AppError(404, "RESTAURANTS_NOT_FOUND");
      const open = query === "TABLE_ORDERS";
      const page = await R.query(
        scope,
        K.restaurantSessionPK(scope.orgId, scope.outletId, sessionId),
        K.restaurantSessionOrderPrefix(open),
        open ? "OPEN_SESSION_ORDER" : "SESSION_ORDER",
        input,
      );
      const items = await this.hydrate(scope, page.rows, sessionId);
      if (
        serviceOrderRead &&
        items.some(
          (item) =>
            !("orderId" in item) ||
            item.orderType !== "DINE_IN" ||
            item.tableId !== session.tableId,
        )
      )
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      return { items, nextCursor: page.nextCursor };
    }
    const kind =
      query === "ACTIVE_SESSIONS"
        ? "GS"
        : query === "UNPAID_ORDERS"
          ? "UNPAID"
          : "ORD";
    const page = await R.query(
      scope,
      K.restaurantTransactionActivePK(scope.orgId, scope.outletId, kind),
      undefined,
      kind === "GS"
        ? "ACTIVE_SESSION"
        : kind === "ORD"
          ? "ACTIVE_ORDER"
          : "UNPAID",
      input,
    );
    return {
      items: await this.hydrate(scope, page.rows),
      nextCursor: page.nextCursor,
    };
  }
  /** Authorization has already validated outlet service access once for this request. */
  static async requireOpenOrderSession(
    scope: TransactionScope,
    order: contracts.RestaurantOrder,
  ) {
    if (order.orderType !== "DINE_IN" || !order.guestSessionId)
      throw new AppError(404, "RESTAURANTS_NOT_FOUND");
    const session = (await S.session(scope, order.guestSessionId)).data;
    if (session.status !== "OPEN")
      throw new AppError(404, "RESTAURANTS_NOT_FOUND");
    if (session.tableId !== order.tableId)
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
  }
  private static async history(
    scope: TransactionScope,
    query: "SESSION_HISTORY" | "TABLE_SESSION_HISTORY" | "ORDER_HISTORY",
    request: unknown,
    tableId?: string,
  ) {
    const input =
      contracts.RestaurantTransactionHistoryRequestSchema.parse(request);
    if (query === "TABLE_SESSION_HISTORY")
      contracts.RestaurantIdSchema.parse(tableId);
    const start = new Date(input.start).toISOString(),
      end = new Date(input.end).toISOString();
    const first = new Date(start.slice(0, 10) + "T00:00:00.000Z"),
      last = new Date(
        new Date(new Date(end).getTime() - 1).toISOString().slice(0, 10) +
          "T00:00:00.000Z",
      );
    const days: string[] = [];
    for (let t = first.getTime(); t <= last.getTime(); t += 86400000)
      days.push(new Date(t).toISOString().slice(0, 10).replace(/-/g, ""));
    if (days.length > 31) throw new AppError(400, "RESTAURANTS_HISTORY_WINDOW");
    if (input.direction === "DESC") days.reverse();
    const digest = transactionFingerprint([
      { orgId: scope.orgId, outletId: scope.outletId },
      query,
      tableId,
      start,
      end,
      input.direction,
    ]);
    let index = 0,
      inner: string | undefined;
    if (input.cursor) {
      try {
        const c = z
          .object({
            scope: z.literal(digest),
            bucket: z
              .number()
              .int()
              .min(0)
              .max(days.length - 1),
            inner: z.string().optional(),
          })
          .strict()
          .parse(
            JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")),
          );
        index = c.bucket;
        inner = c.inner;
      } catch {
        throw new AppError(400, "ERROR_INVALID_CURSOR");
      }
    }
    const items: (contracts.GuestSession | contracts.RestaurantOrder)[] = [];
    for (; index < days.length; index++) {
      const pk = K.restaurantTransactionHistoryPK(
        scope.orgId,
        scope.outletId,
        query === "ORDER_HISTORY" ? "ORD" : "GS",
        days[index],
        tableId,
      );
      const page = await R.query(
        scope,
        pk,
        undefined,
        query === "ORDER_HISTORY"
          ? "ORDER_HISTORY"
          : query === "TABLE_SESSION_HISTORY"
            ? "TABLE_SESSION_HISTORY"
            : "SESSION_HISTORY",
        {
          limit: input.limit - items.length,
          cursor: inner,
          direction: input.direction,
        },
        [start, end, days[index]],
        { start, end },
      );
      const targets = await this.hydrate(scope, page.rows);
      if (tableId && targets.some((target) => target.tableId !== tableId))
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      items.push(...targets);
      if (
        page.nextCursor ||
        (items.length === input.limit && index + 1 < days.length)
      )
        return {
          items,
          nextCursor: Buffer.from(
            JSON.stringify({
              scope: digest,
              bucket: page.nextCursor ? index : index + 1,
              inner: page.nextCursor,
            }),
          ).toString("base64url"),
        };
      inner = undefined;
    }
    return { items };
  }
}
