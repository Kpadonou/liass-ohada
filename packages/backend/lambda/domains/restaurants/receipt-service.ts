import { randomUUID } from "crypto";
import { z } from "zod";
import { marshall } from "@aws-sdk/util-dynamodb";
import { TransactWriteItem } from "@aws-sdk/client-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";
import { RestaurantServiceAccess } from "./service-access";
import { RestaurantTransactionsService as S } from "./transaction-service";
import {
  RestaurantTransactionsRepository as R,
  transactionFingerprint as hash,
} from "./transaction-repository";
import { RestaurantReceiptRepository as B } from "./receipt-repository";
import { ReceiptManifest, ReceiptManifestSchema } from "./receipt-model";
import { TransactionScope } from "./transaction-model";
import { RestaurantsRepository } from "./restaurant-repository";
import { restaurantsTableName } from "./restaurant-storage";
function fail(code = "RESTAURANTS_TRANSACTION_INTEGRITY", status = 409): never {
  throw new AppError(status, code);
}
const safe = (n: bigint) =>
  n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER) ? fail() : Number(n);
const add = (a: number, b: number) => safe(BigInt(a) + BigInt(b));
const meta = () => K.restaurantTransactionMetaSK();
/** Canonical serialization is the existing recursively sorted transaction fingerprint. */
export function receiptPart(
  number: number,
  previousDigest: string,
  content: c.RestaurantReceiptPart["content"],
): c.RestaurantReceiptPart {
  const part = c.RestaurantReceiptPartSchema.parse({
    number,
    previousDigest,
    content,
    digest: hash([previousDigest, number, content]),
  });
  if (Buffer.byteLength(JSON.stringify(part), "utf8") > 64 * 1024)
    fail("RESTAURANTS_TRANSACTION_LIMIT", 400);
  return part;
}
export function receiptSeed(
  context: ReceiptManifest["context"],
  orders: ReceiptManifest["orders"],
) {
  return hash(["RESTAURANT_RECEIPT_V1", context, orders]);
}
export class RestaurantReceiptService {
  static async authorize(scope: TransactionScope, actorId: string) {
    const access = await RestaurantServiceAccess.authorize(
      scope,
      actorId,
      false,
      true,
    );
    if (!["OWNER", "MANAGER", "CASHIER"].includes(access.role ?? ""))
      fail("DOMAIN_PERMISSION_REQUIRED", 403);
    if (access.role === "CASHIER") {
      const outlet = await RestaurantsRepository.get(
        scope.orgId,
        "outlet",
        {},
        scope.outletId,
      );
      if (!outlet?.data.isActive) fail("DOMAIN_PERMISSION_REQUIRED", 403);
      access.actions.push({
        ConditionCheck: {
          TableName: restaurantsTableName(),
          Key: marshall({
            PK: K.orgKey(scope.orgId),
            SK: K.restaurantOutletSK(scope.outletId),
          }),
          ConditionExpression:
            "entityType = :type AND orgId = :org AND #d.#v = :version AND #d.#active = :active",
          ExpressionAttributeNames: {
            "#d": "data",
            "#v": "version",
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
    }
    return access;
  }
  static eligible(s: c.GuestSession) {
    if (
      s.status !== "CLOSED" ||
      !s.closedAt ||
      s.openOrderCount ||
      s.dueMinor !== s.paidMinor ||
      s.reservedMinor ||
      s.pendingPaymentCount
    )
      fail("RESTAURANTS_TRANSACTION_STATE");
    if (
      Object.values(s.paidByMethodMinor ?? {}).reduce(
        (n, v) => n + BigInt(v),
        0n,
      ) !== BigInt(s.paidMinor)
    )
      fail();
  }
  static async orders(scope: TransactionScope, session: c.GuestSession) {
    const links = await R.query(
      scope,
      K.restaurantSessionPK(
        scope.orgId,
        scope.outletId,
        session.guestSessionId,
      ),
      K.restaurantSessionOrderPrefix(),
      "SESSION_ORDER",
      { limit: 100 },
    );
    if (
      links.nextCursor ||
      links.rows.length !== session.orderCount ||
      links.rows.length > 50
    )
      fail();
    const ids = links.rows.map((r) => {
      if (
        r.entityType !== "RESTAURANT_SESSION_ORDER" ||
        r.data.guestSessionId !== session.guestSessionId
      )
        return fail();
      return r.data.targetId;
    });
    if (new Set(ids).size !== ids.length) fail();
    const rows = await R.batch(
      scope,
      ids.map((id) => ({
        PK: K.restaurantOrderPK(scope.orgId, scope.outletId, id),
        SK: meta(),
      })),
      "ORDER",
    );
    const orders = rows.map((r, i) => {
      if (
        !r ||
        r.entityType !== "RESTAURANT_ORDER" ||
        r.data.orderId !== ids[i] ||
        r.data.guestSessionId !== session.guestSessionId ||
        r.data.orderType !== "DINE_IN" ||
        r.data.tableId !== session.tableId ||
        r.data.currency !== session.currency ||
        !["CLOSED", "CANCELLED"].includes(r.data.status) ||
        r.data.draftLineCount ||
        r.data.outstandingWorkCount ||
        r.data.reservedMinor ||
        r.data.pendingPaymentCount ||
        r.data.dueMinor !== r.data.paidMinor
      )
        return fail();
      return r.data;
    });
    if (
      orders.reduce((n, o) => n + BigInt(o.dueMinor), 0n) !==
        BigInt(session.dueMinor) ||
      orders.reduce((n, o) => n + BigInt(o.paidMinor), 0n) !==
        BigInt(session.paidMinor)
    )
      fail();
    return orders;
  }
  static sourceGuard(
    scope: TransactionScope,
    session: Awaited<ReturnType<typeof S.session>>,
  ): TransactWriteItem {
    const condition = R.conditions(session);
    return {
      ConditionCheck: {
        TableName: restaurantsTableName(),
        Key: marshall({ PK: session.PK, SK: session.SK }),
        ...condition,
      },
    };
  }
  static async publish(
    scope: TransactionScope,
    actorId: string,
    sessionId: string,
    input: unknown,
  ) {
    c.RestaurantIdSchema.parse(sessionId);
    const request = c.PublishRestaurantReceiptRequestSchema.parse(input);
    await this.authorize(scope, actorId);
    const intent = hash([scope, actorId, sessionId, request]);
    let command = await B.command(scope, sessionId, request.clientRequestId);
    if (
      command &&
      (command.actorId !== actorId || command.fingerprint !== intent)
    )
      fail("RESTAURANTS_IDEMPOTENCY_CONFLICT");
    let session = await S.session(scope, sessionId);
    this.eligible(session.data);
    let manifest: ReceiptManifest | undefined;
    if (!session.data.finalBillId) {
      const orders = await this.orders(scope, session.data);
      const [outlet, restaurant] = await Promise.all([
        RestaurantsRepository.get(scope.orgId, "outlet", {}, scope.outletId),
        RestaurantsRepository.get(scope.orgId, "restaurant", {}),
      ]);
      if (!outlet || !restaurant) fail("RESTAURANTS_NOT_FOUND", 404);
      const receiptId = randomUUID();
      const context = {
        receiptId,
        guestSessionId: sessionId,
        scopeKind: "GUEST_SESSION" as const,
        documentKind: "OPERATIONAL_RECEIPT" as const,
        schemaVersion: 1 as const,
        outletName: outlet.data.name,
        restaurantName: restaurant.data.name,
        tableName: session.data.tableName,
        openedAt: session.data.openedAt,
        closedAt: session.data.closedAt!,
        currency: session.data.currency,
        dueMinor: session.data.dueMinor,
        paidMinor: session.data.paidMinor,
        paidByMethodMinor: session.data.paidByMethodMinor ?? {
          CASH: 0,
          MOBILE_MONEY: 0,
          CARD: 0,
        },
      };
      manifest = ReceiptManifestSchema.parse({
        scopeKind: "GUEST_SESSION",
        ownerId: sessionId,
        receiptId,
        guestSessionId: sessionId,
        state: "BUILDING",
        version: 1,
        sourceVersion: session.data.version + 1,
        financialRevision: session.data.financialRevision,
        context,
        orders,
        orderIndex: 0,
        phase: "LINES",
        retainedCount: 0,
        orderAcceptedCount: 0,
        orderNet: 0,
        lineCount: 0,
        commercialTotal: 0,
        partCount: 0,
        commercialPartCount: 0,
        settlementPartCount: 0,
        paymentCount: 0,
        paidTotal: 0,
        methods: { CASH: 0, MOBILE_MONEY: 0, CARD: 0 },
        allocations: {},
        verifiedCount: 0,
        verifiedDigest: receiptSeed(context, orders),
        digest: receiptSeed(context, orders),
      });
      const access = await this.authorize(scope, actorId);
      try {
        await R.commit([
          ...access.actions,
          R.put(
            R.row(scope, { PK: session.PK, SK: session.SK }, "SESSION", {
              ...c.GuestSessionSchema.parse(session.data),
              finalBillId: receiptId,
              version: session.data.version + 1,
            }),
            session,
          ),
          B.put(scope, receiptId, meta(), "MANIFEST", manifest),
          B.commandPut(scope, sessionId, request.clientRequestId, {
            actorId,
            fingerprint: intent,
            receiptId,
          }),
        ]);
      } catch (error) {
        if (!this.concurrent(error)) throw error;
        manifest = undefined;
      }
      session = await S.session(scope, sessionId);
      this.eligible(session.data);
    }
    const receiptId = session.data.finalBillId;
    if (!receiptId) fail("RESTAURANTS_WRITE_CONFLICT");
    if (command && command.receiptId !== receiptId) fail();
    if (!manifest) manifest = await B.get(scope, receiptId, meta(), "MANIFEST");
    if (
      !manifest ||
      manifest.receiptId !== receiptId ||
      manifest.guestSessionId !== sessionId
    )
      fail();
    if (!command) {
      command = await B.command(scope, sessionId, request.clientRequestId);
      if (!command) {
        const access = await this.authorize(scope, actorId);
        try {
          await R.commit([
            ...access.actions,
            B.commandPut(scope, sessionId, request.clientRequestId, {
              actorId,
              fingerprint: intent,
              receiptId,
            }),
          ]);
        } catch (error) {
          if (!this.concurrent(error)) throw error;
        }
        command = await B.command(scope, sessionId, request.clientRequestId);
      }
      if (
        !command ||
        command.fingerprint !== intent ||
        command.actorId !== actorId ||
        command.receiptId !== receiptId
      )
        fail("RESTAURANTS_IDEMPOTENCY_CONFLICT");
    }
    if (!manifest) fail();
    let current: ReceiptManifest = manifest;
    // At most eight progress writes per invocation; retries continue the same canonical build.
    const deadline = Date.now() + 12000;
    for (let budget = 0; budget < 8 && Date.now() < deadline; budget++) {
      if (current.state === "FINAL") return this.finalResult(scope, current);
      session = await S.session(scope, sessionId);
      this.eligible(session.data);
      if (
        session.data.version !== current.sourceVersion ||
        session.data.financialRevision !== current.financialRevision ||
        session.data.finalBillId !== receiptId
      )
        fail();
      const next: ReceiptManifest = structuredClone(current);
      next.version++;
      const actions: TransactWriteItem[] = [];
      if (next.phase === "LINES") await this.lines(scope, next, actions);
      else if (next.phase === "PAYMENTS")
        await this.payments(scope, next, actions);
      else if (next.phase === "VERIFY") await this.verify(scope, next);
      else await this.finalize(scope, actorId, session, next, actions);
      const access = await this.authorize(scope, actorId);
      try {
        await R.commit([
          ...access.actions,
          this.sourceGuard(scope, session),
          B.put(scope, receiptId, meta(), "MANIFEST", next, current.version),
          ...actions,
        ]);
        current = next;
      } catch (error) {
        if (!this.concurrent(error)) throw error;
        await this.authorize(scope, actorId);
        const latest = await B.get(scope, receiptId, meta(), "MANIFEST");
        if (!latest || latest.version <= current.version)
          fail("RESTAURANTS_WRITE_CONFLICT");
        current = latest;
      }
    }
    return current.state === "FINAL"
      ? this.finalResult(scope, current)
      : {
          data: {
            state: "BUILDING" as const,
            receiptId,
            version: current.version,
            partCount: current.partCount,
          },
        };
  }
  static concurrent(error: unknown) {
    return (
      error instanceof Error &&
      [
        "TransactionCanceledException",
        "ConditionalCheckFailedException",
      ].includes(error.name)
    );
  }
  static async finalResult(scope: TransactionScope, m: ReceiptManifest) {
    const result = await B.get(
      scope,
      m.receiptId,
      K.restaurantBillResultSK(),
      "RESULT",
    );
    if (!result || hash(result) !== hash(m.result)) fail();
    return { data: { state: "FINAL" as const, receipt: result } };
  }
  static append(
    scope: TransactionScope,
    m: ReceiptManifest,
    content: c.RestaurantReceiptPart["content"],
    actions: TransactWriteItem[],
  ) {
    const part = receiptPart(m.partCount + 1, m.digest, content);
    actions.push(
      B.put(
        scope,
        m.receiptId,
        K.restaurantBillPartSK(part.number),
        "PART",
        part,
      ),
    );
    m.partCount++;
    m.digest = part.digest;
    if (content.kind === "COMMERCIAL") m.commercialPartCount++;
    else m.settlementPartCount++;
  }
  static async lines(
    scope: TransactionScope,
    m: ReceiptManifest,
    actions: TransactWriteItem[],
  ) {
    const order = m.orders[m.orderIndex];
    if (!order) {
      m.phase = "PAYMENTS";
      delete m.sourceCursor;
      return;
    }
    const page = await R.query(
      scope,
      K.restaurantOrderPK(scope.orgId, scope.outletId, order.orderId),
      K.restaurantOrderItemPrefix(),
      "LINE",
      { limit: 16, cursor: m.sourceCursor },
    );
    const lines: c.RestaurantReceiptPart["content"] & { kind: "COMMERCIAL" } = {
      kind: "COMMERCIAL",
      lines: [],
    };
    for (const row of page.rows) {
      if (
        row.entityType !== "RESTAURANT_ORDER_ITEM" ||
        row.data.orderId !== order.orderId
      )
        fail();
      const item = row.data;
      m.retainedCount++;
      if (item.status === "DRAFT") fail();
      if (!item.snapshot) {
        if (item.status !== "CANCELLED") fail();
        continue;
      }
      if (item.snapshot.currency !== m.context.currency) fail();
      const cancelled = item.status === "CANCELLED";
      if (cancelled && (!item.cancelledAt || !item.cancellationReason)) fail();
      const line = c.RestaurantReceiptLineSchema.parse({
        orderId: order.orderId,
        itemId: item.itemId,
        snapshot: c.AcceptedSaleSnapshotSchema.omit({ acceptedBy: true }).parse(
          (({ acceptedBy, ...snapshot }) => snapshot)(item.snapshot),
        ),
        notes: item.notes,
        ...(cancelled
          ? {
              cancelledAt: item.cancelledAt,
              cancellationReason: item.cancellationReason,
            }
          : {}),
        netAmountMinor: cancelled ? 0 : item.snapshot.lineTotalMinor,
      });
      // Each canonical source page is <=16 entries. Byte-driven splits remain deterministic.
      const candidate = {
        kind: "COMMERCIAL" as const,
        lines: [...lines.lines, line],
      };
      if (
        lines.lines.length &&
        Buffer.byteLength(
          JSON.stringify(
            B.row(
              scope,
              m.receiptId,
              K.restaurantBillPartSK(m.partCount + 1),
              "PART",
              {
                number: m.partCount + 1,
                previousDigest: m.digest,
                digest: "0".repeat(64),
                content: candidate,
              },
            ),
          ),
        ) >
          64 * 1024
      ) {
        this.append(
          scope,
          m,
          { kind: "COMMERCIAL", lines: [...lines.lines] },
          actions,
        );
        lines.lines = [];
      }
      receiptPart(m.partCount + 1, m.digest, {
        kind: "COMMERCIAL",
        lines: [line],
      });
      lines.lines.push(line);
      m.orderAcceptedCount++;
      m.lineCount++;
      m.orderNet = add(m.orderNet, line.netAmountMinor);
      m.commercialTotal = add(m.commercialTotal, line.netAmountMinor);
    }
    if (lines.lines.length) this.append(scope, m, lines, actions);
    m.sourceCursor = page.nextCursor;
    if (!page.nextCursor) {
      if (
        m.retainedCount !== order.lineCount ||
        m.orderAcceptedCount !== order.acceptedLineCount ||
        m.orderNet !== order.dueMinor
      )
        fail();
      m.orderIndex++;
      m.retainedCount = 0;
      m.orderAcceptedCount = 0;
      m.orderNet = 0;
    }
  }
  static async payments(
    scope: TransactionScope,
    m: ReceiptManifest,
    actions: TransactWriteItem[],
  ) {
    const page = await R.query(
      scope,
      K.restaurantSessionPK(scope.orgId, scope.outletId, m.guestSessionId),
      K.restaurantPaymentReferencePrefix(),
      "PAYMENT_REFERENCE",
      { limit: 16, cursor: m.sourceCursor },
    );
    const refs = page.rows.map((row) => {
      if (
        row.entityType !== "RESTAURANT_PAYMENT_REFERENCE" ||
        row.data.guestSessionId !== m.guestSessionId ||
        row.data.orderId
      )
        return fail();
      return row.data;
    });
    const results = await R.batch(
      scope,
      refs.map((r) => ({
        PK: K.restaurantPaymentPK(scope.orgId, scope.outletId, r.paymentId),
        SK: K.restaurantPaymentResultSK(),
      })),
      "PAYMENT_RESULT",
    );
    const payments: z.infer<typeof c.RestaurantReceiptSettlementSchema>[] = [];
    for (const [i, row] of results.entries()) {
      if (!row || row.entityType !== "RESTAURANT_PAYMENT_RESULT") fail();
      const p = row.data;
      if (
        p.paymentId !== refs[i].paymentId ||
        p.guestSessionId !== m.guestSessionId ||
        p.currency !== m.context.currency ||
        p.appliedAmountMinor !== refs[i].amountMinor ||
        p.committedAt !== refs[i].timestamp
      )
        fail();
      for (const a of p.allocations) {
        if (!m.orders.some((o) => o.orderId === a.orderId)) fail();
        const prev = m.allocations[a.orderId] ?? { amount: 0, count: 0 };
        m.allocations[a.orderId] = {
          amount: add(prev.amount, a.amountMinor),
          count: prev.count + 1,
        };
      }
      payments.push(
        c.RestaurantReceiptSettlementSchema.parse({
          paymentId: p.paymentId,
          method: p.method,
          appliedAmountMinor: p.appliedAmountMinor,
          committedAt: p.committedAt,
          allocations: p.allocations,
          externalReference: p.externalReference,
          cashTenderedMinor: p.cashTenderedMinor,
          changeMinor: p.changeMinor,
        }),
      );
      m.paymentCount++;
      if (m.paymentCount > 10000) fail();
      m.paidTotal = add(m.paidTotal, p.appliedAmountMinor);
      m.methods[p.method] = add(m.methods[p.method], p.appliedAmountMinor);
    }
    if (payments.length)
      this.append(scope, m, { kind: "SETTLEMENT", payments }, actions);
    m.sourceCursor = page.nextCursor;
    if (!page.nextCursor) {
      m.phase = "VERIFY";
      delete m.sourceCursor;
    }
  }
  static async verify(scope: TransactionScope, m: ReceiptManifest) {
    const page = await B.parts(scope, m.receiptId, m.digest, m.partCount, {
      limit: 4,
      cursor: m.sourceCursor,
    });
    for (const part of page.parts) {
      if (
        part.number !== m.verifiedCount + 1 ||
        part.previousDigest !== m.verifiedDigest ||
        hash(receiptPart(part.number, part.previousDigest, part.content)) !==
          hash(part)
      )
        fail();
      m.verifiedCount++;
      m.verifiedDigest = part.digest;
    }
    m.sourceCursor = page.nextCursor;
    if (!page.nextCursor) {
      if (m.verifiedCount !== m.partCount || m.verifiedDigest !== m.digest)
        fail();
      m.phase = "VALIDATE";
      delete m.sourceCursor;
    }
  }
  static async finalize(
    scope: TransactionScope,
    actorId: string,
    session: Awaited<ReturnType<typeof S.session>>,
    m: ReceiptManifest,
    actions: TransactWriteItem[],
  ) {
    if (
      hash(await this.orders(scope, session.data)) !== hash(m.orders) ||
      m.commercialTotal !== m.context.dueMinor ||
      m.paidTotal !== m.context.paidMinor ||
      hash(m.methods) !== hash(m.context.paidByMethodMinor)
    )
      fail();
    for (const o of m.orders) {
      const a = m.allocations[o.orderId] ?? { amount: 0, count: 0 };
      if (
        a.amount !== o.paidMinor ||
        a.count !== (o.succeededPaymentCount ?? 0)
      )
        fail();
    }
    if (m.verifiedCount !== m.partCount || m.verifiedDigest !== m.digest)
      fail();
    const now = new Date().toISOString();
    const result = c.RestaurantReceiptSummarySchema.parse({
      ...m.context,
      partCount: m.partCount,
      commercialPartCount: m.commercialPartCount,
      settlementPartCount: m.settlementPartCount,
      lineCount: m.lineCount,
      paymentCount: m.paymentCount,
      digest: m.digest,
      issuedAt: now,
    });
    m.state = "FINAL";
    m.result = result;
    actions.push(
      B.put(scope, m.receiptId, K.restaurantBillResultSK(), "RESULT", result),
    );
    const commandId = randomUUID();
    const evidence = {
      commandId,
      actorId,
      action: "PUBLISH_RECEIPT",
      targetId: m.receiptId,
      committedAt: now,
      version: m.version,
      fromState: "BUILDING",
      toState: "FINAL",
      receipt: { receiptId: m.receiptId, guestSessionId: m.guestSessionId },
    };
    actions.push(
      R.put(
        R.row(
          scope,
          {
            PK: K.restaurantBillPK(scope.orgId, scope.outletId, m.receiptId),
            SK: K.restaurantTransactionAuditSK(now, commandId),
          },
          "AUDIT",
          evidence,
        ),
      ),
      R.put(
        R.row(
          scope,
          {
            PK: K.restaurantTransactionHistoryPK(
              scope.orgId,
              scope.outletId,
              "ACT",
              now.slice(0, 10).replace(/-/g, ""),
            ),
            SK: K.restaurantTransactionLocatorSK(now, commandId),
          },
          "ACTIVITY",
          evidence,
        ),
      ),
    );
  }
  static async read(
    scope: TransactionScope,
    actorId: string,
    sessionId: string,
    input: unknown,
  ) {
    c.RestaurantIdSchema.parse(sessionId);
    const request = c.RestaurantReceiptReadRequestSchema.parse(input);
    await this.authorize(scope, actorId);
    const session = await S.session(scope, sessionId);
    this.eligible(session.data);
    const id = session.data.finalBillId;
    if (!id) fail("RESTAURANTS_NOT_FOUND", 404);
    const m = await B.get(scope, id, meta(), "MANIFEST");
    if (!m || m.guestSessionId !== sessionId || m.state !== "FINAL")
      fail("RESTAURANTS_NOT_FOUND", 404);
    const result = await this.finalResult(scope, m);
    return c.RestaurantReceiptResponseSchema.parse({
      data: result.data.receipt,
      ...(await B.parts(scope, id, m.digest, m.partCount, request)),
    });
  }
}
