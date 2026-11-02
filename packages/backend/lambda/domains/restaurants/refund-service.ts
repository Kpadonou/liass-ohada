import { randomBytes, randomUUID } from "crypto";
import { RestaurantDocumentCollections as Documents } from "./document-collections";
import { z } from "zod";
import { marshall } from "@aws-sdk/util-dynamodb";
import { TransactWriteItem } from "@aws-sdk/client-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { AppError } from "@/lambda/shared/app-error";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import {
  TransactionScope as Scope,
  TransactionKey as Key,
} from "./transaction-model";
import { RestaurantCashService as Cash, cashInteger } from "./cash-service";
import { RestaurantCashRepository as CashItems } from "./cash-repository";
import { RestaurantCreditNoteService as CreditNotes } from "./credit-note-service";
import { transactionFingerprint as hash } from "./transaction-repository";
import { restaurantsTableName } from "./restaurant-storage";
import {
  RestaurantRefundRepository as R,
  RestaurantRefundBalanceSchema,
  RefundCommandSchema,
} from "./refund-repository";

function fail(code: string, status = 409): never {
  throw new AppError(status, `RESTAURANTS_REFUND_${code}`);
}
const canonicalKey = (scope: Scope, id: string) => ({
  PK: K.restaurantRefundPK(scope.orgId, scope.outletId, id),
  SK: K.restaurantTransactionMetaSK(),
});
export class RestaurantRefundService {
  /** Canonical read; detail() remains the V1 transport adapter. */
  static async invoiceDetail(scope: Scope, actor: string, id: string) {
    const detail = await this.detail(scope, actor, id);
    const credit = await this.creditNote(
      scope,
      actor,
      detail.data.creditNoteId,
    );
    return { data: c.adaptRefundToInvoice(detail.data, credit.invoiceId) };
  }
  static async authorize(scope: Scope, actor: string, create = false) {
    const access = await Cash.authorize(scope, actor);
    if (create && !["OWNER", "MANAGER"].includes(access.role ?? ""))
      fail("ROLE", 403);
    return access;
  }
  private static async read(scope: Scope, id: string) {
    const data = await R.get(
      scope,
      canonicalKey(scope, id),
      "RESTAURANT_REFUND",
      c.RestaurantRefundSchema,
    );
    if (!data) fail("NOT_FOUND", 404);
    if (
      data.refundId !== id ||
      data.orgId !== scope.orgId ||
      data.outletId !== scope.outletId
    )
      fail("SOURCE");
    return c.RestaurantRefundResponseSchema.parse({ data });
  }
  static async detail(scope: Scope, actor: string, id: string) {
    await this.authorize(scope, actor);
    return this.read(scope, c.RestaurantIdSchema.parse(id));
  }
  static async list(
    scope: Scope,
    actor: string,
    creditNoteId: string,
    input: unknown,
  ) {
    await this.authorize(scope, actor);
    c.RestaurantIdSchema.parse(creditNoteId);
    await this.creditNote(scope, actor, creditNoteId);
    const result = await R.page(
      scope,
      actor,
      K.restaurantCreditNotePK(scope.orgId, scope.outletId, creditNoteId),
      K.restaurantRefundPrefix(),
      "RESTAURANT_REFUND_CREDIT_PROJECTION",
      c.RestaurantRefundSchema,
      c.RestaurantRefundListRequestSchema.parse(input),
    );
    if (
      result.items.some(
        (v) =>
          v.creditNoteId !== creditNoteId ||
          v.orgId !== scope.orgId ||
          v.outletId !== scope.outletId,
      )
    )
      fail("SOURCE");
    return c.RestaurantRefundListResponseSchema.parse(result);
  }
  static async cashActivity(
    scope: Scope,
    actor: string,
    cashSessionId: string,
    input: unknown,
  ) {
    await this.authorize(scope, actor);
    const session = await Cash.session(
      scope,
      c.RestaurantIdSchema.parse(cashSessionId),
    );
    const result = await R.page(
      scope,
      actor,
      session.PK,
      K.restaurantRefundPrefix(),
      "RESTAURANT_REFUND_CASH_PROJECTION",
      c.RestaurantRefundSchema,
      c.RestaurantRefundListRequestSchema.parse(input),
    );
    if (
      result.items.some(
        (v) =>
          v.cashSessionId !== cashSessionId ||
          v.orgId !== scope.orgId ||
          v.outletId !== scope.outletId,
      )
    )
      fail("SOURCE");
    return c.RestaurantRefundListResponseSchema.parse(result);
  }
  private static async creditNote(scope: Scope, actor: string, id: string) {
    // Bounded immutable detail (at most 16 lines) verifies the commercial amount and ownership.
    const key = {
      PK: K.restaurantCreditNotePK(scope.orgId, scope.outletId, id),
      SK: "META",
    };
    const raw = await R.get(
      scope,
      key,
      "RESTAURANT_CREDIT_NOTE",
      z.object({ status: z.string() }).passthrough(),
    );
    if (!raw) fail("CREDIT_NOT_FOUND", 404);
    if (raw.status !== "VALIDATED") fail("CREDIT_NOT_VALIDATED");
    try {
      return (await CreditNotes.invoiceDetail(scope, actor, id)).data;
    } catch (error) {
      if (
        error instanceof z.ZodError ||
        (error instanceof AppError &&
          [
            "RESTAURANTS_CREDIT_SOURCE",
            "RESTAURANTS_TRANSACTION_INTEGRITY",
          ].includes(error.messageCode))
      )
        fail("SOURCE");
      throw error;
    }
  }
  static async create(
    scope: Scope,
    actor: string,
    creditNoteId: string,
    input: unknown,
  ) {
    const access = await this.authorize(scope, actor, true);
    c.RestaurantIdSchema.parse(creditNoteId);
    const parsed = c.CreateRestaurantRefundRequestSchema.safeParse(input);
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path[0];
      fail(
        path === "amountMinor"
          ? "AMOUNT"
          : path === "method"
            ? "METHOD"
            : path === "externalReference"
              ? "EXTERNAL_REFERENCE"
              : "REQUEST",
        400,
      );
    }
    const request = parsed.data;
    const fingerprint = hash([
      scope,
      creditNoteId,
      actor,
      request.amountMinor,
      request.method,
      request.externalReference ?? null,
    ]);
    const lookup = hash([
      scope,
      "CREATE_REFUND",
      creditNoteId,
      request.clientRequestId,
    ]);
    const commandKey = {
      PK: K.restaurantTransactionCommandPK(
        scope.orgId,
        scope.outletId,
        "CREATE_REFUND",
        creditNoteId,
        lookup,
      ),
      SK: K.restaurantTransactionCommandSK(creditNoteId, lookup),
    };
    const replay = async () => {
      const proof = await R.get(
        scope,
        commandKey,
        "RESTAURANT_REFUND_COMMAND",
        RefundCommandSchema,
      );
      if (!proof) return undefined;
      if (proof.actorId !== actor || proof.fingerprint !== fingerprint)
        fail("IDEMPOTENCY");
      const result = await this.read(scope, proof.refundId);
      if (
        result.data.creditNoteId !== creditNoteId ||
        result.data.refundedByUserId !== actor ||
        result.data.intentFingerprint !== fingerprint
      )
        fail("SOURCE");
      return result;
    };
    const previous = await replay();
    if (previous) return previous;
    const credit = await this.creditNote(scope, actor, creditNoteId);
    const day = await Cash.activeDay(scope);
    if (!day) fail("DAY_REQUIRED");
    const current = await Cash.activeSession(scope, actor);
    if (!current) fail("SESSION_REQUIRED");
    const before = current.session.data;
    if (
      before.cashierUserId !== actor ||
      before.status !== "OPEN" ||
      day.day.data.status !== "OPEN" ||
      before.businessDayId !== day.day.data.businessDayId
    )
      fail("CONTEXT");
    if (
      before.currency !== credit.currency ||
      day.day.data.currency !== credit.currency
    )
      fail("CURRENCY", 400);
    const creditKey = {
      PK: K.restaurantCreditNotePK(scope.orgId, scope.outletId, creditNoteId),
      SK: "META",
    };
    const balanceKey = { ...creditKey, SK: K.restaurantRefundBalanceSK() };
    let balance: z.infer<typeof RestaurantRefundBalanceSchema> | undefined;
    try {
      balance = await R.get(
        scope,
        balanceKey,
        "RESTAURANT_REFUND_BALANCE",
        RestaurantRefundBalanceSchema,
      );
    } catch (error) {
      if (error instanceof z.ZodError) fail("SOURCE");
      throw error;
    }
    if (
      balance &&
      (balance.creditNoteId !== creditNoteId ||
        balance.currency !== credit.currency ||
        balance.creditNoteAmountMinor !== credit.amountMinor)
    )
      fail("SOURCE");
    const cumulative =
      BigInt(balance?.refundedMinor ?? 0) + BigInt(request.amountMinor);
    if (cumulative > BigInt(credit.amountMinor)) fail("EXCEEDED");
    const refundedMinor = cashInteger(cumulative);
    const refundedAt = new Date().toISOString(),
      refundId = randomUUID();
    const refundReference = `REF-${refundedAt.slice(0, 10).replace(/-/g, "")}-${randomBytes(4).toString("hex").toUpperCase()}`;
    const data = c.RestaurantRefundSchema.parse({
      ...scope,
      ...request,
      refundId,
      refundReference,
      creditNoteId,
      guestSessionId: credit.guestSessionId,
      finalBillId: credit.invoiceId,
      currency: credit.currency,
      status: "CONFIRMED",
      refundedAt,
      refundedByUserId: actor,
      businessDayId: before.businessDayId,
      cashSessionId: before.cashSessionId,
      intentFingerprint: fingerprint,
      schemaVersion: 1,
      entityType: "RESTAURANT_REFUND",
    });
    const refundedByMethodMinor = {
      ...before.refundedByMethodMinor,
      [request.method]: cashInteger(
        BigInt(before.refundedByMethodMinor[request.method]) +
          BigInt(request.amountMinor),
      ),
    };
    const next = c.RestaurantCashSessionSchema.parse({
      ...before,
      refundedByMethodMinor,
      refundCount: cashInteger(BigInt(before.refundCount) + 1n),
      version: cashInteger(BigInt(before.version) + 1n),
      expectedCashAmountMinor: cashInteger(
        c.restaurantExpectedCash({ ...before, refundedByMethodMinor }),
        true,
      ),
    });
    const condition = (
      key: Key,
      expression: string,
      names: Record<string, string>,
      values: Record<string, unknown>,
    ): TransactWriteItem => ({
      ConditionCheck: {
        TableName: restaurantsTableName(),
        Key: marshall(key),
        ConditionExpression: expression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: marshall(values),
      },
    });
    const guard = (
      row: Parameters<typeof CashItems.conditions>[0],
    ): TransactWriteItem => ({
      ConditionCheck: {
        TableName: restaurantsTableName(),
        Key: marshall({ PK: row.PK, SK: row.SK }),
        ...CashItems.conditions(row),
      },
    });
    const activityKey = K.restaurantRefundSK(refundedAt, refundId);
    const actions: TransactWriteItem[] = [
      ...access.actions,
      condition(
        creditKey,
        "entityType = :type AND orgId = :org AND outletId = :out AND #d.#s = :valid AND #d.#a = :amount AND #d.#c = :currency AND #d.#h = :digest",
        {
          "#d": "data",
          "#s": "status",
          "#a": "amountMinor",
          "#c": "currency",
          "#h": "sourceReceiptDigest",
        },
        {
          ":type": "RESTAURANT_CREDIT_NOTE",
          ":org": scope.orgId,
          ":out": scope.outletId,
          ":valid": "VALIDATED",
          ":amount": credit.amountMinor,
          ":currency": credit.currency,
          ":digest": credit.sourceInvoiceDigest,
        },
      ),
      R.balanceWrite(
        scope,
        balanceKey,
        {
          creditNoteId,
          creditNoteAmountMinor: credit.amountMinor,
          currency: credit.currency,
          refundedMinor,
          refundCount: cashInteger(BigInt(balance?.refundCount ?? 0) + 1n),
          version: cashInteger(BigInt(balance?.version ?? 0) + 1n),
          entityType: "RESTAURANT_REFUND_BALANCE",
          schemaVersion: 1,
        },
        balance,
      ),
      R.put(scope, canonicalKey(scope, refundId), "RESTAURANT_REFUND", data),
      R.put(
        scope,
        { PK: creditKey.PK, SK: activityKey },
        "RESTAURANT_REFUND_CREDIT_PROJECTION",
        data,
      ),
      R.put(
        scope,
        { PK: current.session.PK, SK: activityKey },
        "RESTAURANT_REFUND_CASH_PROJECTION",
        data,
      ),
      ...Cash.sessionWrites(scope, next, current.session),
      guard(day.day),
      guard(day.pointer),
      guard(current.pointer),
      R.put(
        scope,
        K.restaurantRefundReferenceClaimKey(
          scope.orgId,
          scope.outletId,
          refundReference,
        ),
        "RESTAURANT_REFUND_REFERENCE",
        { refundId, refundReference },
      ),
      R.put(scope, commandKey, "RESTAURANT_REFUND_COMMAND", {
        actorId: actor,
        fingerprint,
        refundId,
      }),
    ];
    actions.push(
      ...(await Documents.refundWrite(
        scope,
        creditNoteId,
        balance?.refundedMinor ?? 0,
        refundedMinor,
        credit.amountMinor,
      )),
    );
    R.budget(actions);
    try {
      await R.commit(actions);
    } catch (error) {
      const recovered = await replay();
      if (recovered) return recovered;
      if (
        error instanceof Error &&
        error.name === "TransactionCanceledException"
      )
        fail("CONFLICT");
      throw error;
    }
    return c.RestaurantRefundResponseSchema.parse({ data });
  }
}
