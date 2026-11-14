import { randomBytes, randomUUID } from "crypto";
import { RestaurantDocumentCollections as Documents } from "./document-collections";
import { z } from "zod";
import { marshall } from "@aws-sdk/util-dynamodb";
import { TransactWriteItem } from "@aws-sdk/client-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import * as q from "@liass-ohada/shared/restaurant-quantity";
import { AppError } from "@/lambda/shared/app-error";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { TransactionScope } from "./transaction-model";
import { RestaurantCashService as Cash } from "./cash-service";
import { RestaurantTransactionsService as Sessions } from "./transaction-service";
import { transactionFingerprint as hash } from "./transaction-repository";
import { RestaurantReceiptRepository as Receipts } from "./receipt-repository";
import { receiptSeed } from "./receipt-service";
import { restaurantsTableName } from "./restaurant-storage";
import {
  RestaurantCreditNoteRepository as R,
  CreditControlSchema,
  CreditKey,
} from "./credit-note-repository";

function fail(suffix: string, status = 409): never {
  throw new AppError(status, `RESTAURANTS_CREDIT_${suffix}`);
}
const integer = (value: bigint) =>
  value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)
    ? fail("SOURCE")
    : Number(value);
const commandSchema = z
  .object({
    actorId: z.string(),
    fingerprint: z.string(),
    creditNoteId: z.string().uuid(),
  })
  .strict();
type SourceLine = {
  line: c.RestaurantInvoiceLine;
  part: number;
  position: number;
};
export class RestaurantCreditNoteService {
  /** Canonical read; detail() retains the strict V1 transport representation. */
  static async invoiceDetail(
    scope: TransactionScope,
    actor: string,
    id: string,
  ) {
    const detail = await this.detail(scope, actor, id);
    return { ...detail, data: c.adaptCreditNoteToInvoice(detail.data) };
  }
  private static async sourceRead<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (
        error instanceof z.ZodError ||
        (error instanceof AppError &&
          error.messageCode === "RESTAURANTS_TRANSACTION_INTEGRITY")
      )
        fail("SOURCE");
      throw error;
    }
  }
  static async authorize(
    scope: TransactionScope,
    actor: string,
    create = false,
  ) {
    // Reuses membership/product/outlet checks and the transaction-time authorization evidence.
    const access = await Cash.authorize(scope, actor);
    if (create && !["OWNER", "MANAGER"].includes(access.role ?? ""))
      fail("ROLE", 403);
    return access;
  }
  static async detail(scope: TransactionScope, actor: string, id: string) {
    await this.authorize(scope, actor);
    return this.detailInternal(scope, actor, c.RestaurantIdSchema.parse(id));
  }
  private static async detailInternal(
    scope: TransactionScope,
    actor: string,
    id: string,
  ) {
    const PK = K.restaurantCreditNotePK(scope.orgId, scope.outletId, id);
    const data = await R.get(
      scope,
      { PK, SK: "META" },
      "RESTAURANT_CREDIT_NOTE",
      c.RestaurantCreditNoteSchema,
    );
    if (!data || data.creditNoteId !== id)
      throw new AppError(404, "RESTAURANTS_NOT_FOUND");
    const page = await R.page(
      scope,
      actor,
      PK,
      "LINE#",
      "RESTAURANT_CREDIT_NOTE_LINE",
      c.RestaurantCreditNoteLineSchema,
      { limit: 17 },
    );
    if (
      page.nextCursor ||
      page.items.length !== data.lineCount ||
      page.items.some((l) => l.creditNoteId !== id) ||
      integer(
        page.items.reduce((n, l) => n + BigInt(l.creditedAmountMinor), 0n),
      ) !== data.amountMinor
    )
      fail("SOURCE");
    return c.RestaurantCreditNoteDetailResponseSchema.parse({
      data,
      lines: page.items.sort((a, b) =>
        `${a.orderId}#${a.itemId}`.localeCompare(`${b.orderId}#${b.itemId}`),
      ),
    });
  }
  static async list(
    scope: TransactionScope,
    actor: string,
    sessionId: string,
    input: unknown,
  ) {
    await this.authorize(scope, actor);
    await Sessions.session(scope, c.RestaurantIdSchema.parse(sessionId));
    const page = await R.page(
      scope,
      actor,
      K.restaurantSessionPK(scope.orgId, scope.outletId, sessionId),
      K.restaurantCreditNotePrefix(),
      "RESTAURANT_CREDIT_NOTE_SUMMARY",
      c.RestaurantCreditNoteSchema,
      c.RestaurantCreditNoteListRequestSchema.parse(input),
    );
    return c.RestaurantCreditNoteListResponseSchema.parse({
      ...page,
      creditability: await this.creditability(scope, sessionId),
    });
  }
  static async creditability(scope: TransactionScope, sessionId: string) {
    const { billId, result, source } = await this.finalSource(scope, sessionId);
    const PK = K.restaurantBillPK(scope.orgId, scope.outletId, billId);
    const read = (SK: string) =>
      R.get(
        scope,
        { PK, SK },
        "RESTAURANT_CREDIT_CONTROL",
        CreditControlSchema,
      );
    const global = await read(K.restaurantCreditBalanceSK());
    const lines = [];
    for (const { line } of source.values()) {
      if (line.cancelledAt || line.netAmountMinor <= 0) continue;
      const control = await read(
        K.restaurantCreditLineControlSK(line.orderId, line.itemId),
      );
      if (
        control &&
        (control.finalBillId !== billId ||
          control.currency !== result.currency ||
          control.sourceReceiptDigest !== result.digest ||
          control.originalQuantity !== line.snapshot.quantity ||
          control.originalAmountMinor !== line.netAmountMinor ||
          control.creditedQuantity === undefined)
      )
        fail("SOURCE");
      lines.push(
        c.RestaurantCreditabilityLineSchema.parse({
          orderId: line.orderId,
          itemId: line.itemId,
          sourceLineIdentity: `${line.orderId}#${line.itemId}`,
          menuItemId: line.snapshot.menuItemId,
          label: line.snapshot.name,
          originalQuantity: line.snapshot.quantity,
          creditedQuantity: control?.creditedQuantity ?? 0,
          remainingQuantity: q.restaurantQuantityFromMilli(
            BigInt(q.restaurantQuantityToMilli(line.snapshot.quantity)) -
              BigInt(
                q.restaurantQuantityToMilli(control?.creditedQuantity ?? 0),
              ),
          ),
          unitAmountMinor: line.snapshot.unitPriceMinor,
          originalNetAmountMinor: line.netAmountMinor,
          creditedAmountMinor: control?.creditedMinor ?? 0,
          remainingAmountMinor: integer(
            BigInt(line.netAmountMinor) - BigInt(control?.creditedMinor ?? 0),
          ),
          currency: result.currency,
        }),
      );
    }
    const after = await read(K.restaurantCreditBalanceSK());
    if (hash(global ?? null) !== hash(after ?? null)) fail("CONFLICT");
    const credited = integer(
      lines.reduce((n, l) => n + BigInt(l.creditedAmountMinor), 0n),
    );
    if (
      (global?.creditedMinor ?? 0) !== credited ||
      (global &&
        (global.finalBillId !== billId ||
          global.currency !== result.currency ||
          global.sourceReceiptDigest !== result.digest ||
          global.originalAmountMinor !== result.dueMinor))
    )
      fail("SOURCE");
    return c.RestaurantCreditabilitySchema.parse({
      finalBillId: billId,
      currency: result.currency,
      originalAmountMinor: result.dueMinor,
      creditedAmountMinor: credited,
      remainingAmountMinor: integer(BigInt(result.dueMinor) - BigInt(credited)),
      lines,
    });
  }
  private static async finalSource(scope: TransactionScope, sessionId: string) {
    const session = await Sessions.session(scope, sessionId);
    if (session.data.status !== "CLOSED" || !session.data.finalBillId)
      fail("NOT_FINAL");
    const invoiceId = c.invoiceIdFromLegacyAliases(session.data);
    // Legacy publication/persistence boundary: verify original bytes before adaptation.
    const manifest = await this.sourceRead(() =>
      Receipts.get(scope, invoiceId, "META", "MANIFEST"),
    );
    const result = await this.sourceRead(() =>
      Receipts.get(scope, invoiceId, "RESULT", "RESULT"),
    );
    if (!manifest || manifest.state !== "FINAL" || !result) fail("NOT_FINAL");
    if (
      manifest.guestSessionId !== sessionId ||
      result.guestSessionId !== sessionId ||
      hash(manifest.result) !== hash(result) ||
      manifest.digest !== result.digest ||
      manifest.partCount !== result.partCount
    )
      fail("SOURCE");
    if (
      session.data.currency !== result.currency ||
      manifest.context.currency !== result.currency
    )
      fail("CURRENCY");
    // Explicit bounded source verification: up to 256 immutable parts (16 MiB maximum).
    // Reject larger sources rather than silently accepting a partial chain.
    if (result.partCount > 256) fail("SOURCE_LIMIT", 400);
    const source = new Map<string, SourceLine>();
    let cursor: string | undefined,
      digest = receiptSeed(manifest.context, manifest.orders),
      total = 0n,
      lineCount = 0,
      parts = 0;
    do {
      const page = await this.sourceRead(() =>
        Receipts.parts(scope, invoiceId, result.digest, result.partCount, {
          limit: 8,
          cursor,
        }),
      );
      for (const part of page.parts) {
        if (part.previousDigest !== digest || part.number !== ++parts)
          fail("SOURCE");
        digest = part.digest;
        if (part.content.kind !== "COMMERCIAL") continue;
        for (const [position, line] of part.content.lines.entries()) {
          const identity = `${line.orderId}#${line.itemId}`;
          if (source.has(identity)) fail("SOURCE");
          if (line.snapshot.currency !== result.currency) fail("CURRENCY");
          const snapshot = line.snapshot;
          if (
            snapshot.taxMinor !== 0 ||
            snapshot.discountMinor !== 0 ||
            q.restaurantQuantityAmountMinor(
              snapshot.unitPriceMinor,
              snapshot.quantity,
            ) !== snapshot.lineTotalMinor ||
            line.netAmountMinor !==
              (line.cancelledAt ? 0 : snapshot.lineTotalMinor)
          )
            fail("SOURCE");
          source.set(identity, { line, part: part.number, position });
          total += BigInt(line.netAmountMinor);
          lineCount++;
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
    if (
      parts !== result.partCount ||
      digest !== result.digest ||
      total !== BigInt(result.dueMinor) ||
      lineCount !== result.lineCount
    )
      fail("SOURCE");
    return {
      session,
      billId: invoiceId,
      manifest,
      result: c.adaptReceiptSummaryToInvoice(result),
      source,
    };
  }
  private static commandKey(
    scope: TransactionScope,
    session: string,
    request: string,
  ) {
    const digest = hash([scope, "CREATE_CREDIT_NOTE", session, request]);
    return {
      PK: K.restaurantTransactionCommandPK(
        scope.orgId,
        scope.outletId,
        "CREATE_CREDIT_NOTE",
        session,
        digest,
      ),
      SK: K.restaurantTransactionCommandSK(session, digest),
    };
  }
  static async create(
    scope: TransactionScope,
    actor: string,
    sessionId: string,
    input: unknown,
  ) {
    const access = await this.authorize(scope, actor, true);
    c.RestaurantIdSchema.parse(sessionId);
    const raw = input as { lines?: unknown[] };
    if (Array.isArray(raw?.lines) && raw.lines.length > 16) fail("LIMIT", 400);
    if (
      Array.isArray(raw?.lines) &&
      raw.lines.some(
        (l) =>
          typeof l === "object" &&
          l !== null &&
          "quantity" in l &&
          !q.RestaurantQuantitySchema.safeParse(l.quantity).success,
      )
    )
      fail("QUANTITY", 400);
    const request = c.CreateRestaurantCreditNoteRequestSchema.parse(input);
    request.lines.sort((a, b) =>
      `${a.orderId}#${a.itemId}`.localeCompare(`${b.orderId}#${b.itemId}`),
    );
    const fingerprint = hash([
      scope,
      sessionId,
      actor,
      request.reason,
      request.lines,
    ]);
    const commandKey = this.commandKey(
      scope,
      sessionId,
      request.clientRequestId,
    );
    const replay = async () => {
      const existing = await R.get(
        scope,
        commandKey,
        "RESTAURANT_CREDIT_NOTE_COMMAND",
        commandSchema,
      );
      if (!existing) return undefined;
      if (existing.actorId !== actor || existing.fingerprint !== fingerprint)
        fail("IDEMPOTENCY");
      return this.detailInternal(scope, actor, existing.creditNoteId);
    };
    const previous = await replay();
    if (previous) return previous;
    const { session, billId, manifest, result, source } =
      await this.finalSource(scope, sessionId);
    const now = new Date().toISOString(),
      creditNoteId = randomUUID();
    // Legacy proof has been fully verified above; business values use Invoice semantics.
    const invoice = result;
    const reference = `AV-${now.slice(0, 10).replace(/-/g, "")}-${randomBytes(4).toString("hex").toUpperCase()}`;
    const lines = request.lines.map((selected) => {
      const entry = source.get(`${selected.orderId}#${selected.itemId}`);
      if (!entry) return fail("LINE", 400);
      const { line, part, position } = entry;
      if (line.cancelledAt || line.netAmountMinor <= 0)
        return fail("INELIGIBLE", 400);
      return c.RestaurantCreditNoteLineSchema.parse({
        creditNoteId,
        creditNoteLineId: randomUUID(),
        orderId: line.orderId,
        itemId: line.itemId,
        sourcePartNumber: part,
        sourcePosition: position,
        menuItemId: line.snapshot.menuItemId,
        label: line.snapshot.name,
        originalQuantity: line.snapshot.quantity,
        creditedQuantity: selected.quantity,
        unitAmountMinor: line.snapshot.unitPriceMinor,
        originalNetAmountMinor: line.netAmountMinor,
        creditedAmountMinor: q.restaurantQuantityAmountMinor(
          line.snapshot.unitPriceMinor,
          selected.quantity,
        ),
        currency: invoice.currency,
        taxMinor: line.snapshot.taxMinor,
        discountMinor: line.snapshot.discountMinor,
        note: selected.note,
        schemaVersion: 1,
        entityType: "RESTAURANT_CREDIT_NOTE_LINE",
      });
    });
    const canonicalCreditNote = c.RestaurantInvoiceCreditNoteSchema.parse({
      creditNoteId,
      creditNoteReference: reference,
      ...scope,
      guestSessionId: sessionId,
      invoiceId: invoice.invoiceId,
      sourceInvoiceDigest: invoice.digest,
      currency: invoice.currency,
      amountMinor: integer(
        lines.reduce((n, l) => n + BigInt(l.creditedAmountMinor), 0n),
      ),
      reason: request.reason,
      status: "VALIDATED",
      validatedAt: now,
      validatedByUserId: actor,
      schemaVersion: 1,
      clientRequestId: request.clientRequestId,
      intentFingerprint: fingerprint,
      entityType: "RESTAURANT_CREDIT_NOTE",
      lineCount: lines.length,
    });
    const data = c.creditNoteToLegacyWire(canonicalCreditNote);
    const billPK = K.restaurantBillPK(
      scope.orgId,
      scope.outletId,
      invoice.invoiceId,
    );
    const control = async (
      key: CreditKey,
      original: number,
      amount: number,
      quantity?: { original: number; requested: number },
    ) => {
      const old = await R.get(
        scope,
        key,
        "RESTAURANT_CREDIT_CONTROL",
        CreditControlSchema,
      );
      if (
        old &&
        (old.finalBillId !== invoice.invoiceId ||
          old.sourceReceiptDigest !== invoice.digest ||
          old.originalAmountMinor !== original ||
          old.currency !== invoice.currency ||
          old.originalQuantity !== quantity?.original)
      )
        fail("SOURCE");
      const credited = BigInt(old?.creditedMinor ?? 0) + BigInt(amount);
      const creditedQuantityMilli =
        BigInt(q.restaurantQuantityToMilli(old?.creditedQuantity ?? 0)) +
        BigInt(q.restaurantQuantityToMilli(quantity?.requested ?? 0));
      if (
        quantity &&
        creditedQuantityMilli >
          BigInt(q.restaurantQuantityToMilli(quantity.original))
      )
        fail("QUANTITY_EXCEEDED");
      if (credited > BigInt(original))
        fail(quantity ? "VALUE_EXCEEDED" : "CEILING");
      return R.put(
        scope,
        key,
        "RESTAURANT_CREDIT_CONTROL",
        CreditControlSchema.parse({
          finalBillId: invoice.invoiceId,
          sourceReceiptDigest: invoice.digest,
          currency: invoice.currency,
          originalAmountMinor: original,
          creditedMinor: integer(credited),
          version: (old?.version ?? 0) + 1,
          ...(quantity
            ? {
                originalQuantity: quantity.original,
                creditedQuantity: q.restaurantQuantityFromMilli(
                  creditedQuantityMilli,
                ),
              }
            : {}),
        }),
        old?.version,
      );
    };
    const actions: TransactWriteItem[] = [...access.actions];
    const condition = (
      key: CreditKey,
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
    actions.push(
      condition(
        { PK: session.PK, SK: "META" },
        "#d.#s = :closed AND #d.#b = :bill",
        { "#d": "data", "#s": "status", "#b": "finalBillId" },
        { ":closed": "CLOSED", ":bill": invoice.invoiceId },
      ),
    );
    actions.push(
      condition(
        { PK: billPK, SK: "META" },
        "#d.#s = :final AND #d.#h = :digest AND #d.#v = :version",
        { "#d": "data", "#s": "state", "#h": "digest", "#v": "version" },
        {
          ":final": "FINAL",
          ":digest": invoice.digest,
          ":version": manifest.version,
        },
      ),
    );
    actions.push(
      condition(
        { PK: billPK, SK: "RESULT" },
        "#d.#h = :digest AND #d.#a = :amount",
        { "#d": "data", "#h": "digest", "#a": "dueMinor" },
        { ":digest": invoice.digest, ":amount": invoice.dueMinor },
      ),
    );
    const PK = K.restaurantCreditNotePK(
      scope.orgId,
      scope.outletId,
      creditNoteId,
    );
    for (const line of lines) {
      actions.push(
        await control(
          {
            PK: billPK,
            SK: K.restaurantCreditLineControlSK(line.orderId, line.itemId),
          },
          line.originalNetAmountMinor,
          line.creditedAmountMinor,
          { original: line.originalQuantity, requested: line.creditedQuantity },
        ),
      );
      actions.push(
        R.put(
          scope,
          { PK, SK: K.restaurantCreditNoteLineSK(line.orderId, line.itemId) },
          line.entityType,
          line,
        ),
      );
    }
    actions.push(
      await control(
        { PK: billPK, SK: K.restaurantCreditBalanceSK() },
        invoice.dueMinor,
        data.amountMinor,
      ),
    );
    actions.push(R.put(scope, { PK, SK: "META" }, data.entityType, data));
    const documentContext = await Documents.context(scope, "CN");
    actions.push(
      ...documentContext.actions,
      Documents.locator(scope, creditNoteId, now),
      Documents.put(scope, "CN", now, creditNoteId, {
        ...scope,
        creditNoteId,
        creditNoteReference: reference,
        invoiceId: invoice.invoiceId,
        guestSessionId: sessionId,
        validatedAt: now,
        businessDayId: documentContext.businessDayId,
        tableDisplayName: invoice.tableName,
        reason: data.reason,
        amountMinor: data.amountMinor,
        currency: data.currency,
        refundedMinor: 0,
        remainingRefundableMinor: data.amountMinor,
        status: "VALIDATED",
      }),
    );
    actions.push(
      R.put(
        scope,
        { PK: session.PK, SK: K.restaurantCreditNoteSK(now, creditNoteId) },
        "RESTAURANT_CREDIT_NOTE_SUMMARY",
        data,
      ),
    );
    actions.push(
      R.put(
        scope,
        K.restaurantCreditNoteReferenceClaimKey(
          scope.orgId,
          scope.outletId,
          reference,
        ),
        "RESTAURANT_CREDIT_NOTE_REFERENCE",
        { creditNoteId, creditNoteReference: reference },
      ),
    );
    actions.push(
      R.put(scope, commandKey, "RESTAURANT_CREDIT_NOTE_COMMAND", {
        actorId: actor,
        fingerprint,
        creditNoteId,
      }),
    );
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
    return c.RestaurantCreditNoteDetailResponseSchema.parse({ data, lines });
  }
}
