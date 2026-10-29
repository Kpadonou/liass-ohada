import { RestaurantCashService } from "./cash-service";
import { randomUUID } from "crypto";
import { TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";
import { RestaurantServiceAccess } from "./service-access";
import { RestaurantTransactionsService as S } from "./transaction-service";
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
import { RestaurantsRepository } from "./restaurant-repository";
import { restaurantsTableName } from "./restaurant-storage";
const fail = (code = "RESTAURANTS_WRITE_CONFLICT", status = 409): never => {
  throw new AppError(status, code);
};
const safe = (value: bigint): number =>
  value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)
    ? fail("RESTAURANTS_TRANSACTION_MONEY", 400)
    : Number(value);
const totals = (
  before: c.GuestSession | c.RestaurantOrder,
  method: c.RestaurantPayment["method"],
  amount: number,
) => {
  const priorSum = Object.values(before.paidByMethodMinor ?? {}).reduce(
    (sum, amount) => sum + BigInt(amount),
    0n,
  );
  if (priorSum !== BigInt(before.paidMinor))
    return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
  const result = {
    CASH: 0,
    MOBILE_MONEY: 0,
    CARD: 0,
    ...before.paidByMethodMinor,
  };
  result[method] = safe(BigInt(result[method]) + BigInt(amount));
  return result;
};
/** Staff-confirmed settlement only. No provider, reservation or lifecycle commands. */
export class RestaurantPaymentService {
  static async capture(
    scope: TransactionScope,
    actorId: string,
    sessionId: string,
    input: unknown,
  ): Promise<{ data: c.RestaurantPaymentResult }> {
    c.RestaurantIdSchema.parse(sessionId);
    const parsed = c.CaptureRestaurantPaymentRequestSchema.parse(input);
    const request = {
      ...parsed,
      allocations: [...parsed.allocations].sort((a, b) =>
        a.orderId.localeCompare(b.orderId),
      ),
    };
    const authorize = async () => {
      const access = await RestaurantServiceAccess.authorize(
        scope,
        actorId,
        false,
        true,
      );
      if (!["OWNER", "MANAGER", "CASHIER"].includes(access.role ?? ""))
        fail("DOMAIN_PERMISSION_REQUIRED", 403);
      const outlet = await RestaurantsRepository.get(
        scope.orgId,
        "outlet",
        {},
        scope.outletId,
      );
      if (!outlet?.data.isActive) fail("DOMAIN_PERMISSION_REQUIRED", 403);
      return { access, outlet: outlet! };
    };
    const { access, outlet } = await authorize();
    const hash = fingerprint([
      scope.orgId,
      scope.outletId,
      "CAPTURE_PAYMENT",
      sessionId,
      request.clientRequestId,
    ]);
    const intent = fingerprint([actorId, sessionId, request]);
    const commandKey = {
      PK: K.restaurantTransactionCommandPK(
        scope.orgId,
        scope.outletId,
        "CAPTURE_PAYMENT",
        sessionId,
        hash,
      ),
      SK: K.restaurantTransactionCommandSK(sessionId, hash),
    };
    const replay = async () => {
      const row = await R.get(scope, commandKey, "PAYMENT_COMMAND");
      if (!row) return undefined;
      if (
        row.entityType !== "RESTAURANT_PAYMENT_COMMAND" ||
        row.data.ownerId !== sessionId ||
        row.data.lookupHash !== hash ||
        row.data.fingerprint !== intent ||
        row.data.result.fingerprint !== intent ||
        row.data.result.guestSessionId !== sessionId ||
        row.data.result.clientRequestId !== request.clientRequestId ||
        row.data.result.actorId !== actorId
      )
        return fail("RESTAURANTS_IDEMPOTENCY_CONFLICT");
      return row.data.result;
    };
    const prior = await replay();
    if (prior) return { data: prior };
    const session = await S.session(scope, sessionId);
    if (session.data.status !== "OPEN")
      return fail("RESTAURANTS_TRANSACTION_STATE");
    if (session.data.version !== request.expectedVersion) return fail();
    if (session.data.currency !== request.currency)
      return fail("RESTAURANTS_CURRENCY_MISMATCH", 400);
    const amount = safe(
      request.allocations.reduce((sum, a) => sum + BigInt(a.amountMinor), 0n),
    );
    const capacity = (
      owner: c.GuestSession | c.RestaurantOrder,
      applied: number,
    ) => {
      if (
        BigInt(owner.dueMinor) -
          BigInt(owner.paidMinor) -
          BigInt(owner.reservedMinor) <
        BigInt(applied)
      )
        fail("RESTAURANTS_TRANSACTION_MONEY", 409);
    };
    capacity(session.data, amount);
    const orders = await R.batch(
      scope,
      request.allocations.map((a) => ({
        PK: K.restaurantOrderPK(scope.orgId, scope.outletId, a.orderId),
        SK: K.restaurantTransactionMetaSK(),
      })),
      "ORDER",
    );
    const canonicalOrders = request.allocations.map((a, index) => {
      const row = orders[index];
      if (
        !row ||
        row.entityType !== "RESTAURANT_ORDER" ||
        row.data.orderId !== a.orderId ||
        row.data.orderType !== "DINE_IN" ||
        row.data.guestSessionId !== sessionId ||
        row.data.tableId !== session.data.tableId
      )
        return fail("RESTAURANTS_NOT_FOUND", 404);
      if (row.data.currency !== request.currency)
        return fail("RESTAURANTS_CURRENCY_MISMATCH", 400);
      if (row.data.status !== "SUBMITTED")
        return fail("RESTAURANTS_TRANSACTION_STATE");
      if ((row.data.paymentAttemptCount ?? 0) >= 200)
        return fail("RESTAURANTS_TRANSACTION_LIMIT", 400);
      capacity(row.data, a.amountMinor);
      return row;
    });
    const now = new Date().toISOString(),
      paymentId = randomUUID(),
      commandId = randomUUID();
    const pk = K.restaurantPaymentPK(scope.orgId, scope.outletId, paymentId);
    const nextSession = c.GuestSessionSchema.parse({
      ...session.data,
      paidMinor: safe(BigInt(session.data.paidMinor) + BigInt(amount)),
      paidByMethodMinor: totals(session.data, request.method, amount),
      version: safe(BigInt(session.data.version) + 1n),
      financialRevision: safe(BigInt(session.data.financialRevision) + 1n),
    });
    let payment = c.RestaurantPaymentSchema.parse({
      ...scope,
      schemaVersion: 1,
      paymentId,
      guestSessionId: sessionId,
      status: "SUCCEEDED",
      version: 1,
      method: request.method,
      currency: request.currency,
      appliedAmountMinor: amount,
      clientRequestId: request.clientRequestId,
      fingerprint: intent,
      actorId,
      attemptedAt: now,
      committedAt: now,
      externalReference: request.externalReference,
      ...(request.cashTenderedMinor === undefined
        ? {}
        : {
            cashTenderedMinor: request.cashTenderedMinor,
            changeMinor: safe(
              BigInt(request.cashTenderedMinor) - BigInt(amount),
            ),
          }),
    });
    const cash = await RestaurantCashService.paymentActions(
      scope,
      actorId,
      payment,
    );
    payment = c.RestaurantPaymentSchema.parse({
      ...payment,
      ...cash.attribution,
    });
    const result = c.RestaurantPaymentResultSchema.parse({
      ...payment,
      allocations: request.allocations,
      session: {
        guestSessionId: sessionId,
        status: "OPEN",
        currency: nextSession.currency,
        version: nextSession.version,
        financialRevision: nextSession.financialRevision,
        dueMinor: nextSession.dueMinor,
        paidMinor: nextSession.paidMinor,
        reservedMinor: nextSession.reservedMinor,
        pendingPaymentCount: nextSession.pendingPaymentCount,
      },
    });
    const actions: TransactWriteItem[] = [...access.actions];
    actions.push({
      ConditionCheck: {
        TableName: restaurantsTableName(),
        Key: marshall({
          PK: K.orgKey(scope.orgId),
          SK: K.restaurantOutletSK(scope.outletId),
        }),
        ConditionExpression:
          "entityType = :type AND orgId = :org AND #data.#version = :version AND #data.#active = :active",
        ExpressionAttributeNames: {
          "#data": "data",
          "#version": "version",
          "#active": "isActive",
        },
        ExpressionAttributeValues: marshall({
          ":type": "RESTAURANT_OUTLET",
          ":org": scope.orgId,
          ":version": outlet.data.version,
          ":active": true,
        }),
      },
    });
    const guardCount = actions.length;
    actions.push(...cash.actions);
    const put = (
      kind: TransactionKind,
      key: TransactionKey,
      data: Parameters<typeof R.row>[3],
      previous?: TransactionRow,
    ) => {
      const action = R.put(R.row(scope, key, kind, data), previous);
      // Match the exact validated financial snapshot inside the same conditional replacement.
      if (
        previous &&
        (previous.entityType === "RESTAURANT_ORDER" ||
          previous.entityType === "RESTAURANT_GUEST_SESSION")
      ) {
        const target = action.Put!;
        for (const field of [
          "dueMinor",
          "paidMinor",
          "reservedMinor",
          "pendingPaymentCount",
          "financialRevision",
          "status",
        ] as const) {
          target.ConditionExpression += ` AND #data.#${field} = :${field}`;
          target.ExpressionAttributeNames![`#${field}`] = field;
          Object.assign(
            target.ExpressionAttributeValues!,
            marshall({ [`:${field}`]: previous.data[field] }),
          );
        }
      }
      actions.push(action);
    };
    const audit = (
      targetPK: string,
      targetId: string,
      version: number,
      fromState: string | undefined,
      toState: string,
      delta: number,
      before: number,
      after: number,
    ) => {
      const evidence = {
        commandId,
        actorId,
        action: "CAPTURE_PAYMENT",
        targetId,
        committedAt: now,
        version,
        fromState,
        toState,
        payment: {
          paymentId,
          guestSessionId: sessionId,
          method: request.method,
          amountMinor: delta,
          paidBeforeMinor: before,
          paidAfterMinor: after,
        },
      };
      put(
        "AUDIT",
        { PK: targetPK, SK: K.restaurantTransactionAuditSK(now, commandId) },
        evidence,
      );
      return evidence;
    };
    put("PAYMENT", { PK: pk, SK: K.restaurantTransactionMetaSK() }, payment);
    put(
      "PAYMENT_RESULT",
      { PK: pk, SK: K.restaurantPaymentResultSK() },
      result,
    );
    put("SESSION", { PK: session.PK, SK: session.SK }, nextSession, session);
    put(
      "PAYMENT_REFERENCE",
      { PK: session.PK, SK: K.restaurantPaymentReferenceSK(now, paymentId) },
      {
        paymentId,
        guestSessionId: sessionId,
        timestamp: now,
        amountMinor: amount,
      },
    );
    audit(
      session.PK,
      sessionId,
      nextSession.version,
      "OPEN",
      "OPEN",
      amount,
      session.data.paidMinor,
      nextSession.paidMinor,
    );
    for (const [index, row] of canonicalOrders.entries()) {
      const a = request.allocations[index];
      const next = c.RestaurantOrderSchema.parse({
        ...row.data,
        paidMinor: safe(BigInt(row.data.paidMinor) + BigInt(a.amountMinor)),
        paidByMethodMinor: totals(row.data, request.method, a.amountMinor),
        paymentAttemptCount: (row.data.paymentAttemptCount ?? 0) + 1,
        succeededPaymentCount: (row.data.succeededPaymentCount ?? 0) + 1,
        version: safe(BigInt(row.data.version) + 1n),
        financialRevision: safe(BigInt(row.data.financialRevision) + 1n),
      });
      put("ORDER", { PK: row.PK, SK: row.SK }, next, row);
      put(
        "PAYMENT_ALLOCATION",
        { PK: pk, SK: K.restaurantPaymentAllocationSK(a.orderId) },
        {
          ...a,
          paymentId,
          guestSessionId: sessionId,
          currency: request.currency,
        },
      );
      put(
        "PAYMENT_REFERENCE",
        { PK: row.PK, SK: K.restaurantPaymentReferenceSK(now, paymentId) },
        { ...a, paymentId, guestSessionId: sessionId, timestamp: now },
      );
      audit(
        row.PK,
        a.orderId,
        next.version,
        row.data.status,
        next.status,
        a.amountMinor,
        row.data.paidMinor,
        next.paidMinor,
      );
      if (next.dueMinor === next.paidMinor) {
        const key = {
          PK: K.restaurantTransactionActivePK(
            scope.orgId,
            scope.outletId,
            "UNPAID",
          ),
          SK: K.restaurantTransactionLocatorSK(next.createdAt, a.orderId),
        };
        const unpaid = await R.get(scope, key, "UNPAID");
        if (
          !unpaid ||
          unpaid.entityType !== "RESTAURANT_UNPAID_ORDER" ||
          unpaid.data.targetId !== a.orderId
        )
          return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
        actions.push(R.remove(unpaid));
      }
    }
    put(
      "PAYMENT_REFERENCE",
      {
        PK: K.restaurantTransactionHistoryPK(
          scope.orgId,
          scope.outletId,
          "PAY",
          now.slice(0, 10).replace(/-/g, ""),
        ),
        SK: K.restaurantTransactionLocatorSK(now, paymentId),
      },
      {
        paymentId,
        guestSessionId: sessionId,
        timestamp: now,
        amountMinor: amount,
      },
    );
    const evidence = audit(
      pk,
      paymentId,
      1,
      undefined,
      "SUCCEEDED",
      amount,
      0,
      amount,
    );
    put(
      "ACTIVITY",
      {
        PK: K.restaurantTransactionHistoryPK(
          scope.orgId,
          scope.outletId,
          "ACT",
          now.slice(0, 10).replace(/-/g, ""),
        ),
        SK: K.restaurantTransactionLocatorSK(now, commandId),
      },
      evidence,
    );
    put("PAYMENT_COMMAND", commandKey, {
      commandId,
      ownerId: sessionId,
      lookupHash: hash,
      fingerprint: intent,
      result,
    });
    try {
      await R.commit(actions);
    } catch (error) {
      await authorize(); // Never return a durable replay to a now-revoked actor.
      const reasons =
        error &&
        typeof error === "object" &&
        "CancellationReasons" in error &&
        Array.isArray(error.CancellationReasons)
          ? error.CancellationReasons
          : [];
      if (
        reasons
          .slice(0, guardCount)
          .some((r) => r?.Code === "ConditionalCheckFailed")
      )
        return fail("DOMAIN_PERMISSION_REQUIRED", 403);
      const committed = await replay();
      if (committed) return { data: committed };
      if (
        error instanceof Error &&
        [
          "TransactionCanceledException",
          "ConditionalCheckFailedException",
          "TransactionConflictException",
        ].includes(error.name)
      )
        return fail();
      throw error;
    }
    console.info("[RESTAURANTS_PAYMENT]", {
      action: "CAPTURE_PAYMENT",
      outcome: "SUCCEEDED",
      paymentId,
      commandId,
      allocationCount: request.allocations.length,
    });
    return { data: result };
  }
}
