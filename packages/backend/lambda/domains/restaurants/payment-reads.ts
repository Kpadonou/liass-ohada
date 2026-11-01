import { z } from "zod";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";
import { RestaurantTransactionsRepository as R } from "./transaction-repository";
import { RestaurantCashRepository as Cash } from "./cash-repository";
import { RestaurantReceiptRepository as Receipts } from "./receipt-repository";
import { RestaurantTransactionsService as S } from "./transaction-service";
import { restaurantBatchRead } from "./restaurant-batch-read";
import { TransactionScope } from "./transaction-model";
const meta = K.restaurantTransactionMetaSK;
const fail = (): never => {
  throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
};

/** Read-only commercial context. No operational-read authorization is broadened. */
export class RestaurantPaymentReads {
  static async history(
    scope: TransactionScope,
    facts: z.infer<typeof c.RestaurantCashPaymentFactSchema>[],
  ) {
    const ids = [
      ...new Set(
        facts.flatMap((f) => (f.guestSessionId ? [f.guestSessionId] : [])),
      ),
    ];
    const sessions = await R.batch(
      scope,
      ids.map((id) => ({
        PK: K.restaurantSessionPK(scope.orgId, scope.outletId, id),
        SK: meta(),
      })),
      "SESSION",
    );
    const visits = new Map(
      sessions.flatMap((r, index) => {
        if (!r) return [];
        if (
          r.entityType !== "RESTAURANT_GUEST_SESSION" ||
          r.data.guestSessionId !== ids[index]
        )
          return fail();
        return [[ids[index], r.data] as const];
      }),
    );
    const finals = [...visits.values()].filter(
      (s) => s.status === "CLOSED" && s.finalBillId,
    );
    const keys = finals.map((s) => ({
      PK: K.restaurantBillPK(scope.orgId, scope.outletId, s.finalBillId!),
      SK: K.restaurantBillResultSK(),
    }));
    const results = await restaurantBatchRead(keys);
    const receipts = new Map<string, string>();
    results.forEach((raw, index) => {
      if (!raw) return;
      const visit = finals[index];
      const result = Receipts.decode(
        scope,
        visit.finalBillId!,
        K.restaurantBillResultSK(),
        "RESULT",
        unmarshall(raw),
      );
      if (result.guestSessionId !== visit.guestSessionId) return fail();
      receipts.set(visit.guestSessionId, result.receiptId);
    });
    return facts.map(({ orgId, outletId, kind, ...fact }) => ({
      ...fact,
      status: "CAPTURED" as const,
      ...(fact.guestSessionId && visits.has(fact.guestSessionId)
        ? { billSessionId: fact.guestSessionId }
        : {}),
      ...(fact.guestSessionId && receipts.has(fact.guestSessionId)
        ? { receiptId: receipts.get(fact.guestSessionId) }
        : {}),
    }));
  }

  static async bill(
    scope: TransactionScope,
    cash: c.RestaurantCashSession,
    request: z.infer<typeof c.RestaurantCashPaymentReadRequestSchema>,
  ) {
    if (!request.paymentId || !request.capturedAt)
      throw new AppError(400, "ERROR_INVALID_INPUT");
    const fact = await Cash.get(
      scope,
      {
        PK: K.restaurantCashSessionPK(
          scope.orgId,
          scope.outletId,
          cash.cashSessionId,
        ),
        SK: K.restaurantPaymentReferenceSK(
          request.capturedAt,
          request.paymentId,
        ),
      },
      "PAYMENT",
    );
    if (!fact?.data.guestSessionId)
      throw new AppError(404, "RESTAURANTS_NOT_FOUND");
    const visit = (await S.session(scope, fact.data.guestSessionId)).data;
    const links = await R.query(
      scope,
      K.restaurantSessionPK(scope.orgId, scope.outletId, visit.guestSessionId),
      K.restaurantSessionOrderPrefix(),
      "SESSION_ORDER",
      { limit: 100 },
    );
    if (
      links.nextCursor ||
      links.rows.length !== visit.orderCount ||
      links.rows.length > 50
    )
      return fail();
    const ids = links.rows.map((r) => {
      if (
        r.entityType !== "RESTAURANT_SESSION_ORDER" ||
        r.data.guestSessionId !== visit.guestSessionId
      )
        return fail();
      return r.data.targetId;
    });
    const rows = await R.batch(
      scope,
      ids.map((id) => ({
        PK: K.restaurantOrderPK(scope.orgId, scope.outletId, id),
        SK: meta(),
      })),
      "ORDER",
    );
    const orders = rows.map((r, index) => {
      if (
        !r ||
        r.entityType !== "RESTAURANT_ORDER" ||
        r.data.orderId !== ids[index] ||
        r.data.guestSessionId !== visit.guestSessionId ||
        r.data.currency !== visit.currency ||
        r.data.orderType !== "DINE_IN" ||
        r.data.tableId !== visit.tableId
      )
        return fail();
      return {
        orderId: r.data.orderId,
        dueMinor: r.data.dueMinor,
        status: r.data.status,
      };
    });
    const orderId = request.orderId ?? orders[0]?.orderId;
    if (orderId && !ids.includes(orderId))
      throw new AppError(404, "RESTAURANTS_NOT_FOUND");
    const page = orderId
      ? await R.query(
          scope,
          K.restaurantOrderPK(scope.orgId, scope.outletId, orderId),
          K.restaurantOrderItemPrefix(),
          "LINE",
          { limit: request.limit, cursor: request.cursor },
        )
      : undefined;
    const lines =
      page?.rows.flatMap((r) => {
        if (
          r.entityType !== "RESTAURANT_ORDER_ITEM" ||
          r.data.orderId !== orderId
        )
          return fail();
        const item = r.data;
        if (!item.snapshot) return [];
        const { acceptedBy, ...snapshot } = item.snapshot;
        return [
          c.RestaurantReceiptLineSchema.parse({
            orderId,
            itemId: item.itemId,
            snapshot,
            notes: item.notes,
            ...(item.status === "CANCELLED"
              ? {
                  cancelledAt: item.cancelledAt,
                  cancellationReason: item.cancellationReason,
                }
              : {}),
            netAmountMinor:
              item.status === "CANCELLED" ? 0 : snapshot.lineTotalMinor,
          }),
        ];
      }) ?? [];
    return c.RestaurantCashBillResponseSchema.parse({
      session: {
        guestSessionId: visit.guestSessionId,
        tableName: visit.tableName,
        openedAt: visit.openedAt,
        status: visit.status,
        currency: visit.currency,
        dueMinor: visit.dueMinor,
        paidMinor: visit.paidMinor,
        paidByMethodMinor: visit.paidByMethodMinor,
      },
      orders,
      orderId,
      lines,
      nextCursor: page?.nextCursor,
    });
  }
}
