import { randomUUID } from "crypto";
import { z } from "zod";
import { TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { RestaurantServiceAccess } from "./service-access";
import { RestaurantsRepository } from "./restaurant-repository";
import { restaurantsTableName } from "./restaurant-storage";
import {
  RestaurantTransactionsRepository as Transactions,
  transactionFingerprint as fingerprint,
} from "./transaction-repository";
import { TransactionScope as Scope } from "./transaction-model";
import {
  RestaurantCashRepository as R,
  CashRow,
  cashError as fail,
} from "./cash-repository";
export const cashCommands = {
  OPEN_DAY: c.OpenRestaurantBusinessDayRequestSchema,
  CLOSE_DAY: c.CloseRestaurantBusinessDayRequestSchema,
  OPEN_CASH: c.OpenRestaurantCashSessionRequestSchema,
  CLOSE_CASH: c.CloseRestaurantCashSessionRequestSchema,
  MOVEMENT: c.AddRestaurantCashMovementRequestSchema,
};
export type CashCommand = keyof typeof cashCommands;
export const cashInteger = (value: bigint, signed = false): number => {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(signed ? Number.MIN_SAFE_INTEGER : 0)
  )
    return fail("RESTAURANTS_TRANSACTION_MONEY", 400);
  return Number(value);
};
const manager = (role?: string) => ["OWNER", "MANAGER"].includes(role ?? "");
export class RestaurantCashService {
  static async authorize(scope: Scope, actorId: string) {
    const access = await RestaurantServiceAccess.authorize(
      scope,
      actorId,
      false,
      true,
    );
    if (!manager(access.role) && access.role !== "CASHIER")
      return fail("DOMAIN_PERMISSION_REQUIRED", 403);
    const outlet = await RestaurantsRepository.get(
      scope.orgId,
      "outlet",
      {},
      scope.outletId,
    );
    if (!outlet?.data.isActive) return fail("DOMAIN_PERMISSION_REQUIRED", 403);
    access.actions.push({
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
    return access;
  }
  static async day(scope: Scope, id: string) {
    c.RestaurantIdSchema.parse(id);
    return (
      (await R.get(
        scope,
        {
          PK: K.restaurantBusinessDayPK(scope.orgId, scope.outletId, id),
          SK: K.restaurantTransactionMetaSK(),
        },
        "DAY",
      )) ?? fail("RESTAURANTS_NOT_FOUND", 404)
    );
  }
  static async session(scope: Scope, id: string) {
    c.RestaurantIdSchema.parse(id);
    return (
      (await R.get(
        scope,
        {
          PK: K.restaurantCashSessionPK(scope.orgId, scope.outletId, id),
          SK: K.restaurantTransactionMetaSK(),
        },
        "SESSION",
      )) ?? fail("RESTAURANTS_NOT_FOUND", 404)
    );
  }
  static async activeDay(scope: Scope) {
    const pointer = await R.get(
      scope,
      {
        PK: K.restaurantBusinessDaysPK(scope.orgId, scope.outletId),
        SK: K.restaurantOccupancySK(),
      },
      "ACTIVE_DAY",
    );
    if (!pointer) return undefined;
    const day = await this.day(scope, pointer.data.businessDayId);
    if (day.data.status !== "OPEN")
      return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
    return { pointer, day };
  }
  static async activeSession(scope: Scope, actorId: string) {
    const pointer = await R.get(
      scope,
      K.restaurantActiveCashierKey(scope.orgId, scope.outletId, actorId),
      "ACTIVE_CASHIER",
    );
    if (!pointer) return undefined;
    if (pointer.data.cashierUserId !== actorId)
      return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
    const session = await this.session(scope, pointer.data.cashSessionId);
    const active = await this.activeDay(scope);
    if (
      session.data.status !== "OPEN" ||
      session.data.cashierUserId !== actorId ||
      session.data.businessDayId !== active?.day.data.businessDayId
    )
      return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
    return { pointer, session };
  }
  static sessionWrites(
    scope: Scope,
    next: c.RestaurantCashSession,
    previous?: CashRow<"SESSION">,
  ): TransactWriteItem[] {
    return [
      R.put(R.row(scope, "SESSION", next), previous),
      R.put(
        R.row(scope, "DAY_SESSION", next),
        previous ? R.row(scope, "DAY_SESSION", previous.data) : undefined,
      ),
    ];
  }
  /** Called by the existing capture engine; all actions commit in its commercial transaction. */
  static async paymentActions(
    scope: Scope,
    actorId: string,
    payment: c.RestaurantPayment,
  ) {
    const current = await this.activeSession(scope, actorId);
    if (!current) return fail("RESTAURANTS_CASH_SESSION_REQUIRED");
    const before = current.session.data;
    if (before.currency !== payment.currency)
      return fail("RESTAURANTS_CURRENCY_MISMATCH", 400);
    const paidByMethodMinor = {
      ...before.paidByMethodMinor,
      [payment.method]: cashInteger(
        BigInt(before.paidByMethodMinor[payment.method]) +
          BigInt(payment.appliedAmountMinor),
      ),
    };
    const next = c.RestaurantCashSessionSchema.parse({
      ...before,
      paidByMethodMinor,
      paymentCount: cashInteger(BigInt(before.paymentCount) + 1n),
      version: cashInteger(BigInt(before.version) + 1n),
      expectedCashAmountMinor: cashInteger(
        BigInt(before.openingCashAmountMinor) +
          BigInt(paidByMethodMinor.CASH) +
          BigInt(before.cashInMinor) -
          BigInt(before.cashOutMinor),
        true,
      ),
    });
    const attribution = {
      capturedByUserId: actorId,
      businessDayId: before.businessDayId,
      cashSessionId: before.cashSessionId,
    };
    return {
      attribution,
      actions: [
        ...this.sessionWrites(scope, next, current.session),
        R.put(
          R.row(scope, "PAYMENT", {
            ...scope,
            ...attribution,
            paymentId: payment.paymentId,
            kind: "CAPTURE",
            method: payment.method,
            amountMinor: payment.appliedAmountMinor,
            currency: payment.currency,
            capturedAt: payment.committedAt,
          }),
        ),
      ],
    };
  }
  static summary(
    session: c.RestaurantCashSession,
  ): c.RestaurantCashSessionSummary {
    return c.RestaurantCashSessionSummarySchema.parse({
      session,
      totalPaymentsMinor: cashInteger(
        Object.values(session.paidByMethodMinor).reduce(
          (a, n) => a + BigInt(n),
          0n,
        ),
      ),
      physicalCashPaymentsMinor: session.paidByMethodMinor.CASH,
      nonCashPaymentsMinor: cashInteger(
        BigInt(session.paidByMethodMinor.CARD) +
          BigInt(session.paidByMethodMinor.MOBILE_MONEY),
      ),
    });
  }
  static async daySessions(scope: Scope, businessDayId: string) {
    const sessions: c.RestaurantCashSession[] = [];
    let cursor: string | undefined;
    do {
      const page = await R.page(
        scope,
        K.restaurantBusinessDayPK(scope.orgId, scope.outletId, businessDayId),
        K.restaurantCashSessionPrefix(),
        "DAY_SESSION",
        { limit: 100, cursor },
        "INTERNAL",
      );
      sessions.push(...page.rows.map((row) => row.data));
      if (sessions.length > 100)
        return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
      cursor = page.nextCursor;
    } while (cursor);
    return sessions;
  }
  static async mutate(
    scope: Scope,
    actorId: string,
    command: CashCommand,
    input: unknown,
    targetId?: string,
  ) {
    const request = cashCommands[command].parse(input);
    if (targetId !== undefined) c.RestaurantIdSchema.parse(targetId);
    const access = await this.authorize(scope, actorId);
    if (
      ["OPEN_DAY", "CLOSE_DAY", "MOVEMENT"].includes(command) &&
      !manager(access.role)
    )
      return fail("DOMAIN_PERMISSION_REQUIRED", 403);
    if (["CLOSE_DAY", "CLOSE_CASH", "MOVEMENT"].includes(command) && !targetId)
      return fail("RESTAURANTS_NOT_FOUND", 404);
    // Self-opening only; management may close another cashier's session, never capture as that cashier.
    const ownerId = targetId ?? "NEW";
    const hash = fingerprint([
      scope,
      command,
      ownerId,
      request.clientRequestId,
    ]);
    const intent = fingerprint([scope, actorId, command, ownerId, request]);
    const key = {
      PK: K.restaurantTransactionCommandPK(
        scope.orgId,
        scope.outletId,
        `CASH_${command}`,
        ownerId,
        hash,
      ),
      SK: K.restaurantTransactionCommandSK(ownerId, hash),
    };
    const replay = async () => {
      const row = await R.get(scope, key, "COMMAND");
      if (!row) return undefined;
      if (
        row.data.fingerprint !== intent ||
        row.data.actorId !== actorId ||
        row.data.lookupHash !== hash
      )
        return fail("RESTAURANTS_IDEMPOTENCY_CONFLICT");
      return { data: row.data.result };
    };
    const prior = await replay();
    if (prior) return prior;
    const now = new Date().toISOString();
    const actions = [...access.actions];
    let result:
      | c.RestaurantBusinessDay
      | c.RestaurantCashSession
      | c.RestaurantCashMovement;
    if (command === "OPEN_DAY") {
      const body = c.OpenRestaurantBusinessDayRequestSchema.parse(request);
      const menu = await RestaurantsRepository.get(scope.orgId, "menu", {
        outletId: scope.outletId,
      });
      if (!menu?.data.isActive) return fail("RESTAURANTS_TRANSACTION_STATE");
      const dateParts = new Intl.DateTimeFormat("en", {
        timeZone: body.operationalTimezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date(now));
      const part = (key: string) =>
        dateParts.find((p) => p.type === key)!.value;
      result = c.RestaurantBusinessDaySchema.parse({
        ...scope,
        businessDayId: randomUUID(),
        businessDate: `${part("year")}-${part("month")}-${part("day")}`,
        operationalTimezone: body.operationalTimezone,
        currency: menu.data.currency,
        status: "OPEN",
        openedAt: now,
        openedBy: actorId,
        version: 1,
        sessionCount: 0,
        openSessionCount: 0,
      });
      actions.push(
        R.put(R.row(scope, "DAY", result)),
        R.put(
          R.row(scope, "ACTIVE_DAY", { businessDayId: result.businessDayId }),
        ),
        R.put(
          R.row(scope, "HISTORY", {
            businessDayId: result.businessDayId,
            openedAt: now,
          }),
        ),
        {
          ConditionCheck: {
            TableName: restaurantsTableName(),
            Key: marshall({
              PK: K.orgKey(scope.orgId),
              SK: K.restaurantMenuSK(scope.outletId),
            }),
            ConditionExpression:
              "entityType = :type AND #data.#version = :version AND #data.#active = :active",
            ExpressionAttributeNames: {
              "#data": "data",
              "#version": "version",
              "#active": "isActive",
            },
            ExpressionAttributeValues: marshall({
              ":type": "RESTAURANT_MENU",
              ":version": menu.data.version,
              ":active": true,
            }),
          },
        },
      );
    } else if (command === "OPEN_CASH") {
      const body = c.OpenRestaurantCashSessionRequestSchema.parse(request);
      const active = await this.activeDay(scope);
      if (!active) return fail("RESTAURANTS_BUSINESS_DAY_REQUIRED");
      const day = active.day;
      if (day.data.sessionCount >= 100)
        return fail("RESTAURANTS_TRANSACTION_LIMIT", 400);
      result = c.RestaurantCashSessionSchema.parse({
        ...scope,
        cashSessionId: randomUUID(),
        businessDayId: day.data.businessDayId,
        cashierUserId: actorId,
        cashierDisplayName: access.displayName ?? null,
        openedAt: now,
        openedBy: actorId,
        openingCashAmountMinor: body.openingCashAmountMinor,
        currency: day.data.currency,
        status: "OPEN",
        version: 1,
        paymentCount: 0,
        paidByMethodMinor: { CASH: 0, CARD: 0, MOBILE_MONEY: 0 },
        cashInMinor: 0,
        cashOutMinor: 0,
        expectedCashAmountMinor: body.openingCashAmountMinor,
      });
      actions.push(
        ...this.sessionWrites(scope, result),
        R.put(
          R.row(scope, "ACTIVE_CASHIER", {
            cashSessionId: result.cashSessionId,
            cashierUserId: actorId,
          }),
        ),
        R.put(
          R.row(scope, "DAY", {
            ...day.data,
            version: cashInteger(BigInt(day.data.version) + 1n),
            sessionCount: day.data.sessionCount + 1,
            openSessionCount: day.data.openSessionCount + 1,
          }),
          day,
        ),
      );
    } else if (command === "CLOSE_DAY") {
      const body = c.CloseRestaurantBusinessDayRequestSchema.parse(request);
      const day = await this.day(scope, targetId!);
      if (
        day.data.status !== "OPEN" ||
        day.data.version !== body.expectedVersion ||
        day.data.openSessionCount !== 0
      )
        return fail();
      const active = await this.activeDay(scope);
      if (active?.day.data.businessDayId !== targetId)
        return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
      const sessions = await this.daySessions(scope, targetId!);
      if (
        sessions.length !== day.data.sessionCount ||
        sessions.some((s) => s.status !== "CLOSED")
      )
        return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
      result = c.RestaurantBusinessDaySchema.parse({
        ...day.data,
        status: "CLOSED",
        closedAt: now,
        closedBy: actorId,
        version: cashInteger(BigInt(day.data.version) + 1n),
      });
      actions.push(
        R.put(R.row(scope, "DAY", result), day),
        R.remove(active!.pointer),
      );
    } else {
      const before = await this.session(scope, targetId!);
      if (!manager(access.role) && before.data.cashierUserId !== actorId)
        return fail("DOMAIN_PERMISSION_REQUIRED", 403);
      if (
        before.data.status !== "OPEN" ||
        !("expectedVersion" in request) ||
        before.data.version !== request.expectedVersion
      )
        return fail();
      const active = await this.activeDay(scope);
      if (active?.day.data.businessDayId !== before.data.businessDayId)
        return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
      if (command === "CLOSE_CASH") {
        const body = c.CloseRestaurantCashSessionRequestSchema.parse(request);
        result = c.RestaurantCashSessionSchema.parse({
          ...before.data,
          status: "CLOSED",
          closedAt: now,
          closedBy: actorId,
          countedCashAmountMinor: body.countedCashAmountMinor,
          varianceAmountMinor: cashInteger(
            BigInt(body.countedCashAmountMinor) -
              BigInt(before.data.expectedCashAmountMinor),
            true,
          ),
          version: cashInteger(BigInt(before.data.version) + 1n),
        });
        const pointer = await R.get(
          scope,
          K.restaurantActiveCashierKey(
            scope.orgId,
            scope.outletId,
            before.data.cashierUserId,
          ),
          "ACTIVE_CASHIER",
        );
        if (
          !pointer ||
          pointer.data.cashSessionId !== targetId ||
          active!.day.data.openSessionCount < 1
        )
          return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
        actions.push(
          ...this.sessionWrites(scope, result, before),
          R.remove(pointer),
          R.put(
            R.row(scope, "DAY", {
              ...active!.day.data,
              version: cashInteger(BigInt(active!.day.data.version) + 1n),
              openSessionCount: active!.day.data.openSessionCount - 1,
            }),
            active!.day,
          ),
        );
      } else {
        const body = c.AddRestaurantCashMovementRequestSchema.parse(request);
        result = c.RestaurantCashMovementSchema.parse({
          ...scope,
          movementId: randomUUID(),
          businessDayId: before.data.businessDayId,
          cashSessionId: before.data.cashSessionId,
          type: body.type,
          amountMinor: body.amountMinor,
          reason: body.reason,
          currency: before.data.currency,
          actorId,
          occurredAt: now,
          createdAt: now,
          clientRequestId: body.clientRequestId,
        });
        const field = body.type === "CASH_IN" ? "cashInMinor" : "cashOutMinor";
        const next = c.RestaurantCashSessionSchema.parse({
          ...before.data,
          [field]: cashInteger(
            BigInt(before.data[field]) + BigInt(body.amountMinor),
          ),
          expectedCashAmountMinor: cashInteger(
            BigInt(before.data.expectedCashAmountMinor) +
              (body.type === "CASH_IN" ? 1n : -1n) * BigInt(body.amountMinor),
            true,
          ),
          version: cashInteger(BigInt(before.data.version) + 1n),
        });
        actions.push(
          ...this.sessionWrites(scope, next, before),
          R.put(R.row(scope, "MOVEMENT", result)),
        );
      }
    }
    actions.push(
      R.put(
        R.row(scope, "COMMAND", {
          command: `CASH_${command}`,
          ownerId,
          lookupHash: hash,
          fingerprint: intent,
          actorId,
          committedAt: now,
          result,
        }),
      ),
    );
    try {
      await Transactions.commit(actions);
    } catch (error) {
      const renewed = await this.authorize(scope, actorId);
      if (
        ["OPEN_DAY", "CLOSE_DAY", "MOVEMENT"].includes(command) &&
        !manager(renewed.role)
      )
        return fail("DOMAIN_PERMISSION_REQUIRED", 403);
      if (command === "CLOSE_CASH" && !manager(renewed.role)) {
        const current = await this.session(scope, targetId!);
        if (current.data.cashierUserId !== actorId)
          return fail("DOMAIN_PERMISSION_REQUIRED", 403);
      }
      const committed = await replay();
      if (committed) return committed;
      if (
        error instanceof Error &&
        [
          "TransactionCanceledException",
          "TransactionConflictException",
          "ConditionalCheckFailedException",
        ].includes(error.name)
      )
        return fail();
      throw error;
    }
    console.info("[RESTAURANTS_CASH]", {
      command,
      outcome: "COMMITTED",
      outletId: scope.outletId,
    });
    return { data: result };
  }
  static async query(
    scope: Scope,
    actorId: string,
    query: string,
    input: unknown,
    targetId?: string,
  ) {
    const list = ["DAYS", "SESSIONS", "MOVEMENTS"].includes(query);
    const request = list
      ? c.RestaurantCashListRequestSchema.parse(input)
      : z.object({}).strict().parse(input);
    if (targetId !== undefined) c.RestaurantIdSchema.parse(targetId);
    const access = await this.authorize(scope, actorId);
    if (
      ["SUMMARY_DAY", "SESSIONS", "DAYS"].includes(query) &&
      !manager(access.role)
    )
      return fail("DOMAIN_PERMISSION_REQUIRED", 403);
    if (query === "CURRENT_DAY")
      return { data: (await this.activeDay(scope))?.day.data ?? null };
    if (query === "CURRENT_CASH")
      return {
        data: (await this.activeSession(scope, actorId))?.session.data ?? null,
      };
    if (query === "DAYS") {
      const page = await R.page(
        scope,
        K.restaurantBusinessDaysPK(scope.orgId, scope.outletId),
        K.restaurantBusinessDayHistoryPrefix(),
        "HISTORY",
        c.RestaurantCashListRequestSchema.parse(request),
        actorId,
        true,
      );
      // Bounded recent history; no per-cashier summary requests. Day metadata is small.
      const rows = await Promise.all(
        page.rows.map((row) => this.day(scope, row.data.businessDayId)),
      );
      return {
        items: rows.map((row) => row.data),
        nextCursor: page.nextCursor,
      };
    }
    if (["DAY", "SUMMARY_DAY", "SESSIONS"].includes(query)) {
      const day = await this.day(scope, targetId!);
      if (query === "DAY") return { data: day.data };
      if (query === "SESSIONS") {
        const page = await R.page(
          scope,
          day.PK,
          K.restaurantCashSessionPrefix(),
          "DAY_SESSION",
          c.RestaurantCashListRequestSchema.parse(request),
          actorId,
        );
        return {
          items: page.rows.map((row) => row.data),
          nextCursor: page.nextCursor,
        };
      }
      const sessions = (await this.daySessions(scope, targetId!)).map((s) =>
        this.summary(s),
      );
      const sum = (
        f: (s: c.RestaurantCashSessionSummary) => number,
        signed = false,
      ) =>
        cashInteger(
          sessions.reduce((n, s) => n + BigInt(f(s)), 0n),
          signed,
        );
      const paidByMethodMinor = {
        CASH: sum((s) => s.session.paidByMethodMinor.CASH),
        MOBILE_MONEY: sum((s) => s.session.paidByMethodMinor.MOBILE_MONEY),
        CARD: sum((s) => s.session.paidByMethodMinor.CARD),
      };
      return c.RestaurantBusinessDaySummaryResponseSchema.parse({
        data: {
          businessDay: day.data,
          observedAt: new Date().toISOString(),
          attributionCoverage: "ATTRIBUTED_ONLY",
          sessions,
          paymentCount: sum((s) => s.session.paymentCount),
          totalPaymentsMinor: sum((s) => s.totalPaymentsMinor),
          paidByMethodMinor,
          physicalCashPaymentsMinor: paidByMethodMinor.CASH,
          nonCashPaymentsMinor: sum((s) => s.nonCashPaymentsMinor),
          cashInMinor: sum((s) => s.session.cashInMinor),
          cashOutMinor: sum((s) => s.session.cashOutMinor),
          sessionCount: sessions.length,
          openSessionCount: sessions.filter((s) => s.session.status === "OPEN")
            .length,
          closedSessionCount: sessions.filter(
            (s) => s.session.status === "CLOSED",
          ).length,
          closedVarianceMinor: sum(
            (s) => s.session.varianceAmountMinor ?? 0,
            true,
          ),
        },
      });
    }
    const session = await this.session(scope, targetId!);
    if (!manager(access.role) && session.data.cashierUserId !== actorId)
      return fail("DOMAIN_PERMISSION_REQUIRED", 403);
    if (query === "CASH") return { data: session.data };
    if (query === "SUMMARY_CASH") return { data: this.summary(session.data) };
    if (query === "MOVEMENTS") {
      const page = await R.page(
        scope,
        session.PK,
        K.restaurantCashMovementPrefix(),
        "MOVEMENT",
        c.RestaurantCashListRequestSchema.parse(request),
        actorId,
        true,
      );
      return {
        items: page.rows.map((row) => row.data),
        nextCursor: page.nextCursor,
      };
    }
    return fail("RESTAURANTS_NOT_FOUND", 404);
  }
}
