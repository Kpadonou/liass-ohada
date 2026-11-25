import { randomUUID } from "crypto";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { RestaurantCreditNoteService as Service } from "@/lambda/domains/restaurants/credit-note-service";
import { RestaurantCreditNoteFiscalSource } from "@/lambda/domains/restaurants/credit-note-fiscal-source";
import { RestaurantInvoiceSourceVerifier } from "@/lambda/domains/restaurants/invoice-source-verifier";
import { FiscalAttemptStore } from "@/lambda/domains/fiscal-compliance/persistence/fiscal-attempt-store";
import { reserveFiscalAttempt, transitionFiscalAttempt, type FiscalAttemptState } from "@/lambda/domains/fiscal-compliance/core/fiscal-attempt-state";
import { SyntheticFiscalOrchestrator, type MockFiscalProvider } from "@/lambda/domains/fiscal-compliance/core/synthetic-fiscal-orchestrator";
import { prepareRestaurantBeninCredit } from "@/lambda/domains/restaurants/benin-credit-fiscal-preparation";
import * as originalPreparation from "@/lambda/domains/restaurants/fiscal-preparation";
import * as originalMapper from "@/lambda/domains/restaurants/benin-fiscal-request-mapper";
import { RestaurantCreditNoteRepository as Repo } from "@/lambda/domains/restaurants/credit-note-repository";
import { RestaurantCashService as Cash } from "@/lambda/domains/restaurants/cash-service";
import { RestaurantTransactionsService as Sessions } from "@/lambda/domains/restaurants/transaction-service";
import { RestaurantReceiptRepository as Receipt } from "@/lambda/domains/restaurants/receipt-repository";
import {
  receiptPart,
  receiptSeed,
} from "@/lambda/domains/restaurants/receipt-service";
import { ReceiptManifestSchema } from "@/lambda/domains/restaurants/receipt-model";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { memoryDynamo } from "./memory-dynamo";
import { acceptanceFixture } from "./acceptance-fixture";

const scope: { orgId: string; outletId: string } = {
  orgId: "org-credit",
  outletId: randomUUID(),
};
const sessionId = randomUUID(),
  billId = randomUUID(),
  orderId = randomUUID();
const time = "2026-11-01T10:00:00.000Z";
let db: ReturnType<typeof memoryDynamo>;
let selected: { orderId: string; itemId: string; quantity: number }[];
function seed(count = 1, cancelled = false, label = "Plat", classified = false) {
  const lines = Array.from({ length: count }, (_, index) => ({
    orderId,
    itemId: randomUUID(),
    snapshot: {
      menuItemId: randomUUID(),
      menuId: randomUUID(),
      categoryId: randomUUID(),
      itemVersion: 1,
      categoryVersion: 1,
      menuVersion: 1,
      name: label,
      quantity: classified && index === 1 ? 3 : 2,
      unitPriceMinor: classified && index === 1 ? 118 : 100,
      grossMinor: classified && index === 1 ? 354 : 200,
      subtotalMinor: classified && index === 1 ? 300 : 200,
      discountMinor: 0 as const,
      taxMinor: classified && index === 1 ? 54 : 0,
      lineTotalMinor: classified && index === 1 ? 354 : 200,
      ...(classified ? { fiscalTreatment: { country: "BJ", catalogGroup: index === 1 ? "B" : "A",
        effectiveGroup: index === 1 ? "B" : "A", regime: "ORDINARY_VAT", regimeRevision: billId,
        policyId: "BJ-RESTO-TTC", policyVersion: 1, rateBasisPoints: index === 1 ? 1800 : 0,
        rounding: "HALF_UP_LINE" } as const } : {}),
      currency: "XOF",
      acceptedAt: time,
      submissionId: randomUUID(),
    },
    netAmountMinor: cancelled ? 0 : classified && index === 1 ? 354 : 200,
    ...(cancelled ? { cancelledAt: time, cancellationReason: "Annulé" } : {}),
  }));
  selected = lines.map((l) => ({
    orderId: l.orderId,
    itemId: l.itemId,
    quantity: 1,
  }));
  const amount = cancelled ? 0 : lines.reduce((sum, line) => sum + line.netAmountMinor, 0);
  const context = {
    receiptId: billId,
    guestSessionId: sessionId,
    scopeKind: "GUEST_SESSION" as const,
    documentKind: "OPERATIONAL_RECEIPT" as const,
    schemaVersion: 1 as const,
    outletName: "Outlet",
    restaurantName: "Restaurant",
    tableName: "Table",
    openedAt: time,
    closedAt: time,
    currency: "XOF",
    dueMinor: amount,
    paidMinor: amount,
    paidByMethodMinor: { CASH: amount, CARD: 0, MOBILE_MONEY: 0 },
  };
  const seedDigest = receiptSeed(context, []);
  const part = receiptPart(1, seedDigest, { kind: "COMMERCIAL", lines });
  const result = c.RestaurantReceiptSummarySchema.parse({
    ...context,
    partCount: 1,
    commercialPartCount: 1,
    settlementPartCount: 0,
    lineCount: count,
    paymentCount: 0,
    digest: part.digest,
    issuedAt: time,
  });
  const manifest = ReceiptManifestSchema.parse({
    scopeKind: "GUEST_SESSION",
    ownerId: sessionId,
    receiptId: billId,
    guestSessionId: sessionId,
    state: "FINAL",
    version: 1,
    sourceVersion: 1,
    financialRevision: 0,
    context,
    orders: [],
    orderIndex: 0,
    phase: "VALIDATE",
    retainedCount: count,
    orderAcceptedCount: count,
    orderNet: amount,
    lineCount: count,
    commercialTotal: amount,
    partCount: 1,
    commercialPartCount: 1,
    settlementPartCount: 0,
    paymentCount: 0,
    paidTotal: amount,
    methods: context.paidByMethodMinor,
    allocations: {},
    verifiedCount: 1,
    verifiedDigest: part.digest,
    digest: part.digest,
    result,
  });
  for (const [sk, kind, data] of [
    ["META", "MANIFEST", manifest],
    ["RESULT", "RESULT", result],
    [K.restaurantBillPartSK(1), "PART", part],
  ] as const) {
    const row = Receipt.row(scope, billId, sk, kind, data);
    db.rows.set(JSON.stringify([row.PK, row.SK]), marshall(row));
  }
  const PK = K.restaurantSessionPK(scope.orgId, scope.outletId, sessionId);
  const data = {
    guestSessionId: sessionId,
    status: "CLOSED",
    finalBillId: billId,
    currency: "XOF",
  };
  db.rows.set(JSON.stringify([PK, "META"]), marshall({ PK, SK: "META", data }));
  jest
    .spyOn(Sessions, "session")
    .mockResolvedValue({ PK, SK: "META", data } as Awaited<
      ReturnType<typeof Sessions.session>
    >);
}
const input = (quantity = 1) => ({
  clientRequestId: randomUUID(),
  reason: "Retour client",
  lines: selected.map((l) => ({ ...l, quantity })),
});
const create = (body = input()) =>
  Service.create(scope, "manager", sessionId, body);
beforeEach(() => {
  db = memoryDynamo();
  jest
    .spyOn(Cash, "authorize")
    .mockResolvedValue({ actions: [], role: "MANAGER" });
  seed();
});
afterEach(() => {
  expect(db.db.commandCalls(ScanCommand)).toHaveLength(0);
  db.db.restore();
  jest.restoreAllMocks();
});
test("creditability follows full, partial and exhausted immutable receipt quantities", async () => {
  const read = () => Service.list(scope, "manager", sessionId, { limit: 1 });
  expect((await read()).creditability?.lines[0]).toMatchObject({
    originalQuantity: 2,
    creditedQuantity: 0,
    remainingQuantity: 2,
    remainingAmountMinor: 200,
  });
  await create();
  expect((await read()).creditability).toMatchObject({
    creditedAmountMinor: 100,
    remainingAmountMinor: 100,
    lines: [
      { creditedQuantity: 1, remainingQuantity: 1, remainingAmountMinor: 100 },
    ],
  });
  await create();
  const exhausted = await read();
  expect(exhausted.creditability).toMatchObject({
    remainingAmountMinor: 0,
    lines: [{ remainingQuantity: 0, remainingAmountMinor: 0 }],
  });
  const second = await Service.list(scope, "manager", sessionId, {
    limit: 1,
    cursor: exhausted.nextCursor,
  });
  expect(second.creditability).toEqual(exhausted.creditability);
  expect(JSON.stringify(exhausted.creditability)).not.toMatch(
    /CREDIT_|version|\"PK\"|\"SK\"/,
  );
});
test("cancelled receipt lines never appear as creditable", async () => {
  seed(1, true);
  expect(
    (await Service.list(scope, "manager", sessionId, {})).creditability?.lines,
  ).toEqual([]);
});
test("partial then exact remaining credit, detail/list and immutable source facts", async () => {
  const before = new Map(db.rows);
  const first = await create();
  const projection = [...db.rows.values()]
    .map((r) => unmarshall(r))
    .find((r) => r.entityType === "RESTAURANT_DOCUMENT_CN");
  expect(projection?.data).toMatchObject({
    creditNoteId: first.data.creditNoteId,
    invoiceId: billId,
    businessDayId: null,
    refundedMinor: 0,
    remainingRefundableMinor: 100,
  });
  const canonical = await Service.invoiceDetail(
    scope,
    "manager",
    first.data.creditNoteId,
  );
  expect(canonical.data.invoiceId).toBe(billId);
  expect(canonical.data.sourceInvoiceDigest).toBe(
    first.data.sourceReceiptDigest,
  );
  expect(canonical.data).not.toHaveProperty("finalBillId");
  const second = await create();
  expect(first.data.amountMinor).toBe(100);
  expect(second.data.amountMinor).toBe(100);
  expect(
    await Service.detail(scope, "manager", first.data.creditNoteId),
  ).toEqual(first);
  expect(
    (await Service.list(scope, "manager", sessionId, {})).items,
  ).toHaveLength(2);
  for (const [key, value] of before) expect(db.rows.get(key)).toEqual(value);
  expect(() =>
    Repo.put(
      scope,
      {
        PK: K.restaurantCreditNotePK(
          scope.orgId,
          scope.outletId,
          first.data.creditNoteId,
        ),
        SK: "META",
      },
      "RESTAURANT_CREDIT_NOTE",
      first.data,
      1,
    ),
  ).toThrow();
  await expect(create()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_CREDIT_QUANTITY_EXCEEDED",
  });
});
test("full line amount is server computed and monetary client input rejected", async () => {
  const body = input(2);
  expect((await create(body)).data.amountMinor).toBe(200);
  await expect(
    create({ ...input(), amountMinor: 1 } as ReturnType<typeof input>),
  ).rejects.toThrow();
});
test("scenario 06 commercial A+B credit preserves frozen treatment and credited VAT", async () => {
  seed(2, false, "Article", true);
  const note = await Service.create(scope, "manager", sessionId, {
    clientRequestId: randomUUID(), reason: "Correction facture",
    lines: selected.map((line, index) => ({ ...line, quantity: index === 0 ? 2 : 3 })),
  });
  expect(note.data).toMatchObject({ finalBillId: billId, amountMinor: 554,
    status: "VALIDATED", lineCount: 2 });
  expect(note.lines.map(line => line.taxMinor).sort((a, b) => a - b)).toEqual([0, 54]);
  const available = await Service.creditability(scope, sessionId);
  expect(available.remainingAmountMinor).toBe(0);
  expect(available.lines.every(line => line.remainingQuantity === 0)).toBe(true);
  await expect(Service.create(scope, "manager", sessionId, {
    clientRequestId: randomUUID(), reason: "Double avoir",
    lines: selected.map((line, index) => ({ ...line, quantity: index === 0 ? 2 : 3 })),
  })).rejects.toMatchObject({ messageCode: "RESTAURANTS_CREDIT_QUANTITY_EXCEEDED" });
});
test("scenario 06 fiscal source binds the original confirmed FV code without changing original rows", async () => {
  seed(2, false, "Article", true);
  const note = await Service.create(scope, "manager", sessionId, {
    clientRequestId: randomUUID(), reason: "Correction facture",
    lines: selected.map((line, index) => ({ ...line, quantity: index === 0 ? 2 : 3 })),
  });
  const originalRows = new Map(db.rows);
  const originalLines = note.lines.map(line => ({ coordinate: { orderId: line.orderId, itemId: line.itemId },
    line: { netAmountMinor: line.originalNetAmountMinor, snapshot: {
      quantity: line.originalQuantity, unitPriceMinor: line.unitAmountMinor } } }));
  jest.spyOn(RestaurantInvoiceSourceVerifier, "verify").mockResolvedValue({ verified: true,
    evidence: { invoice: { digest: note.data.sourceReceiptDigest, currency: "XOF", dueMinor: 554 },
      proof: { digest: "a".repeat(64) }, lines: originalLines } } as never);
  const originalState = { identity: { orgId: scope.orgId, sourceDomain: "restaurants", sourceDocumentId: billId, sourceDocumentType: "INVOICE", environment: "TEST" }, status: "CONFIRMED", execution: "REAL_TEST",
    securityEvidenceOrigin: "DGI_TEST", sourceDigest: "a".repeat(64),
    fiscalDocumentType: "FV", obligationId: "b".repeat(64),
    security: { codeMECeFDGI: "A".repeat(24) } };
  jest.spyOn(FiscalAttemptStore.prototype, "read").mockResolvedValue(originalState as never);
  const linked = await RestaurantCreditNoteFiscalSource.verify(scope, "manager", sessionId,
    billId, note.data.creditNoteId);
  expect(linked.originalFiscal.security!.codeMECeFDGI).toBe("A".repeat(24));
  expect(linked.credit.data.creditNoteId).toBe(note.data.creditNoteId);
  expect(linked.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
  for (const [key, value] of originalRows) expect(db.rows.get(key)).toEqual(value);
  jest.mocked(FiscalAttemptStore.prototype.read).mockResolvedValueOnce({
    ...originalState, fiscalDocumentType: "EA" } as never);
  await expect(RestaurantCreditNoteFiscalSource.verify(scope, "manager", sessionId,
    billId, note.data.creditNoteId)).rejects.toMatchObject({ messageCode: "ORIGINAL_FISCAL_CERTIFICATION_REQUIRED" });
});
test("scenario 06 issues FA from the persisted A+B credit through durable CREATE and CONFIRM", async () => {
  seed(2, false, "Article", true);
  const originalDigest = "a".repeat(64), originalCode = "A".repeat(24);
  const originalIdentity = { orgId: scope.orgId, environment: "TEST" as const,
    sourceDomain: "restaurants", sourceDocumentType: "INVOICE", sourceDocumentId: billId,
    jurisdiction: "BJ", obligation: "NORMALIZE" };
  const principal = { orgId: scope.orgId, actorId: "manager" };
  let originalState: FiscalAttemptState | undefined;
  const originalStore = { reserve: async (input: Parameters<typeof reserveFiscalAttempt>[0]) =>
    (originalState = reserveFiscalAttempt(input)), read: async () => originalState,
    transition: async (scopeIdentity: typeof originalIdentity, version: number,
      event: Parameters<typeof transitionFiscalAttempt>[3]) => {
      const result = transitionFiscalAttempt(originalState!, scopeIdentity, version, event);
      originalState = result.state; return result;
    } } as unknown as FiscalAttemptStore;
  const originalProvider: MockFiscalProvider = { kind: "BENIN_EMECEF_TEST",
    createInvoice: async prepared => ({ uid: "original-uid", total: prepared.total, reconciled: true }),
    confirmInvoice: async (_uid, reservation) => {
      originalProvider.diagnostic = { reference: reservation!.diagnostic!.reference, captured: true };
      return { codeMECeFDGI: originalCode, qrCode: "original-qr",
        dateTime: "15/11/2026 09:00:00", counters: "1/1 FV", nim: "NIM" };
    }, getInvoice: async () => undefined };
  Object.assign(process.env, { STAGE: "dev", FISCAL_EXECUTION_MODE: "REAL_TEST", FISCAL_REAL_TEST_ENABLED: "1" });
  const originalFlow = new SyntheticFiscalOrchestrator(originalStore, originalProvider,
    async () => undefined, async () => ({ identity: originalIdentity,
      sourceDigest: originalDigest, requestDigest: "d".repeat(64), total: 554,
      payload: { invoice: { type: "FV" } } }), true);
  expect((await originalFlow.create(principal, originalIdentity, "original-attempt", "original-create")).state.status).toBe("CREATED");
  expect((await originalFlow.confirm(principal, originalIdentity, "original-confirm", { confirm: true })).state.status).toBe("CONFIRMED");
  const note = await Service.create(scope, "manager", sessionId, {
    clientRequestId: randomUUID(), reason: "Correction facture",
    lines: selected.map((line, index) => ({ ...line, quantity: index === 0 ? 2 : 3 })),
  });
  const originalRows = new Map(db.rows);
  jest.spyOn(RestaurantInvoiceSourceVerifier, "verify").mockResolvedValue({ verified: true,
    evidence: { invoice: { digest: note.data.sourceReceiptDigest, currency: "XOF", dueMinor: 554 },
      proof: { digest: originalDigest }, lines: note.lines.map(line => ({
        coordinate: { orderId: line.orderId, itemId: line.itemId },
        line: { netAmountMinor: line.originalNetAmountMinor, snapshot: {
          quantity: line.originalQuantity, unitPriceMinor: line.unitAmountMinor } } })) } } as never);
  jest.spyOn(FiscalAttemptStore.prototype, "read").mockResolvedValue(originalState as never);
  jest.spyOn(originalPreparation, "prepareRestaurantFiscalInvoice").mockResolvedValue({ ready: true,
    preparation: { commercialRootDigest: originalDigest, lines: note.lines.map(line => ({
      commercial: { orderId: line.orderId, itemId: line.itemId,
        snapshot: { fiscalTreatment: { effectiveGroup: line.taxMinor ? "B" : "A",
          rateBasisPoints: line.taxMinor ? 1800 : 0, policyVersion: 1 } } },
    })) } } as never);
  jest.spyOn(originalMapper, "mapRestaurantBeninRequest").mockReturnValue({ sourceDigest: originalDigest,
    payload: { invoice: { ifu: "1234567890123", client: { name: "Client", ifu: "9876543210123" },
      items: note.lines.map(line => ({ name: line.label, price: line.unitAmountMinor,
        quantity: line.originalQuantity, taxGroup: line.taxMinor ? "B" : "A" })) } } } as never);
  const identity = { orgId: scope.orgId, environment: "TEST" as const, sourceDomain: "restaurants",
    sourceDocumentType: "CREDIT_NOTE", sourceDocumentId: note.data.creditNoteId,
    jurisdiction: "BJ", obligation: "NORMALIZE" };
  const mapping = { environment: "TEST", invoiceType: "FA", priceBasis: "TTC",
    pricingEvidence: "frozen-price", commercialMinorUnitsPerFranc: 1,
    taxGroups: ["A", "B"], taxMetadataEvidence: "frozen-tax",
    operator: { actorId: "manager", name: "Manager", evidence: "staff" },
    payments: [{ sourceMethod: "CASH", providerMethod: "ESPECES", evidence: "cash" }] };
  let own: FiscalAttemptState | undefined;
  const ownStore = { reserve: async (input: Parameters<typeof reserveFiscalAttempt>[0]) =>
    (own = reserveFiscalAttempt(input)),
    read: async () => own,
    transition: async (scopeIdentity: typeof identity, version: number,
      event: Parameters<typeof transitionFiscalAttempt>[3]) => {
      const result = transitionFiscalAttempt(own!, scopeIdentity, version, event);
      own = result.state;
      return result;
    } } as unknown as FiscalAttemptStore;
  const posted: unknown[] = [];
  const provider: MockFiscalProvider = { kind: "BENIN_EMECEF_TEST",
    createInvoice: async prepared => { posted.push(prepared.payload); return {
      uid: "credit-uid", total: prepared.total, reconciled: true }; },
    confirmInvoice: async (_uid, reservation) => {
      provider.diagnostic = { reference: reservation!.diagnostic!.reference, captured: true };
      return { codeMECeFDGI: "C".repeat(24), qrCode: "credit-qr",
        dateTime: "15/11/2026 10:00:00", counters: "2/2 FA", nim: "NIM" };
    }, getInvoice: async () => posted[0] };
  try {
    const flow = new SyntheticFiscalOrchestrator(ownStore, provider, async () => undefined,
      (p, i) => prepareRestaurantBeninCredit({ principal: p, identity: i,
        outletId: scope.outletId, sessionId, invoiceId: billId, classifications: [], mapping }), true);
    expect((await flow.create(principal, identity, "credit-attempt", "credit-create")).state.status).toBe("CREATED");
    expect((await flow.confirm(principal, identity, "credit-confirm", { confirm: true })).state.status).toBe("CONFIRMED");
    expect(own).toMatchObject({ fiscalDocumentType: "FA", securityEvidenceOrigin: "DGI_TEST",
      security: { codeMECeFDGI: "C".repeat(24) } });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ invoice: { type: "FA", reference: originalCode,
      client: { ifu: "9876543210123" }, items: expect.arrayContaining([
        expect.objectContaining({ taxGroup: "A", quantity: 2 }),
        expect.objectContaining({ taxGroup: "B", quantity: 3 }),
      ]) }, expected: { total: 554 } });
    for (const [key, value] of originalRows) expect(db.rows.get(key)).toEqual(value);
  } finally {
    delete process.env.STAGE; delete process.env.FISCAL_EXECUTION_MODE; delete process.env.FISCAL_REAL_TEST_ENABLED;
  }
});
test("durable idempotent retry returns original and changed intent conflicts", async () => {
  const body = input();
  const first = await create(body);
  expect(await create(body)).toEqual(first);
  await expect(create({ ...body, reason: "Autre" })).rejects.toMatchObject({
    messageCode: "RESTAURANTS_CREDIT_IDEMPOTENCY",
  });
  expect(db.db.commandCalls(TransactWriteItemsCommand)).toHaveLength(1);
});
test("concurrent same-intent CreditNotes converge to one canonical projection and locator", async () => {
  const intent = input();
  const outcomes = await Promise.allSettled([create(intent), create(intent)]);
  expect(outcomes.some((o) => o.status === "fulfilled")).toBe(true);
  const first = await create(intent);
  const replay = await create(intent);
  expect(replay.data).toEqual(first.data);
  const rows = [...db.rows.values()].map((r) => unmarshall(r));
  for (const entityType of [
    "RESTAURANT_CREDIT_NOTE",
    "RESTAURANT_DOCUMENT_CN",
    "RESTAURANT_DOCUMENT_LOCATOR",
  ])
    expect(rows.filter((r) => r.entityType === entityType)).toHaveLength(1);
});
test("competing transactions cannot over-credit and loser leaves no partial facts", async () => {
  const results = await Promise.allSettled([
    create(input(2)),
    create(input(2)),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    [...db.rows.values()]
      .map((item) => unmarshall(item))
      .filter((r) => r.entityType === "RESTAURANT_CREDIT_NOTE"),
  ).toHaveLength(1);
  expect(
    [...db.rows.values()]
      .map((item) => unmarshall(item))
      .filter((r) => r.entityType === "RESTAURANT_CREDIT_NOTE_LINE"),
  ).toHaveLength(1);
});
test.each(["CASHIER", "WAITER", "KITCHEN"])(
  "rejects create by %s",
  async (role) => {
    jest.mocked(Cash.authorize).mockResolvedValue({ actions: [], role });
    await expect(create()).rejects.toMatchObject({
      messageCode: "RESTAURANTS_CREDIT_ROLE",
    });
    expect(db.transactions).toHaveLength(0);
  },
);
test("rejects missing line, invalid quantity and 17 lines", async () => {
  await expect(
    create({
      ...input(),
      lines: [{ orderId, itemId: randomUUID(), quantity: 1 }],
    }),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_CREDIT_LINE" });
  await expect(create(input(0))).rejects.toMatchObject({
    messageCode: "RESTAURANTS_CREDIT_QUANTITY",
  });
  await expect(
    create({
      ...input(),
      lines: Array.from({ length: 17 }, () => ({
        orderId,
        itemId: randomUUID(),
        quantity: 1,
      })),
    }),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_CREDIT_LIMIT" });
});
test("16 lines fit the measured atomic transaction budget", async () => {
  jest.mocked(Sessions.session).mockRestore();
  seed(16);
  const result = await create(input(2));
  expect(result.lines).toHaveLength(16);
  const budget = Repo.budget(db.transactions.at(-1)!.TransactItems!);
  expect(budget.operations).toBe(43);
  expect(budget.serializedBytes).toBeLessThan(100_000);
  console.info("CREDIT_NOTE_16_LINE_BUDGET", budget);
});
test.each(["NOT_FINAL", "SOURCE", "INELIGIBLE"])(
  "rejects %s receipt",
  async (defect) => {
    if (defect === "INELIGIBLE") {
      jest.mocked(Sessions.session).mockRestore();
      seed(1, true);
    } else {
      const key = JSON.stringify([
        K.restaurantBillPK(scope.orgId, scope.outletId, billId),
        "META",
      ]);
      const row = unmarshall(db.rows.get(key)!);
      if (defect === "NOT_FINAL") row.data.state = "BUILDING";
      else row.data.digest = "f".repeat(64);
      db.rows.set(key, marshall(row));
    }
    await expect(create()).rejects.toMatchObject({
      messageCode: `RESTAURANTS_CREDIT_${defect}`,
    });
  },
);
test("line quantity guard rejects excess before write", async () => {
  await expect(create(input(3))).rejects.toMatchObject({
    messageCode: "RESTAURANTS_CREDIT_QUANTITY_EXCEEDED",
  });
  expect(db.transactions).toHaveLength(0);
});
test("legacy chain verification rejects renamed hashed fields before canonical creation", async () => {
  const address = JSON.stringify([
    K.restaurantBillPK(scope.orgId, scope.outletId, billId),
    K.restaurantBillPartSK(1),
  ]);
  const row = unmarshall(db.rows.get(address)!);
  row.data.content.lines[0].invoiceId = billId;
  db.rows.set(address, marshall(row));
  const before = new Map(db.rows);
  await expect(create()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_CREDIT_SOURCE",
  });
  expect(db.transactions).toHaveLength(0);
  expect(db.rows).toEqual(before);
});

test("normalized line order replays the same intent and duplicate source identities are rejected", async () => {
  jest.mocked(Sessions.session).mockRestore();
  seed(2);
  const body = input();
  const first = await create(body);
  expect(
    await create({
      ...body,
      reason: "  Retour client  ",
      lines: [...body.lines].reverse(),
    }),
  ).toEqual(first);
  await expect(
    create({ ...input(), lines: [selected[0], selected[0]] }),
  ).rejects.toThrow();
  expect(db.transactions).toHaveLength(1);
});

test("different line credits converge after optimistic conflict without losing remaining quantity", async () => {
  jest.mocked(Sessions.session).mockRestore();
  seed(2);
  const first = { ...input(), lines: [selected[0]] };
  const second = { ...input(), lines: [selected[1]] };
  const results = await Promise.allSettled([create(first), create(second)]);
  for (const [index, result] of results.entries())
    if (result.status === "rejected")
      await create(index === 0 ? first : second);
  expect(
    (await Service.list(scope, "manager", sessionId, {})).items,
  ).toHaveLength(2);
});

test("list cursor is bound to principal and service and detail rejects a foreign scope", async () => {
  await create();
  await create();
  const page = await Service.list(scope, "manager", sessionId, { limit: 1 });
  expect(page.nextCursor).toBeDefined();
  await expect(
    Service.list(scope, "other", sessionId, {
      limit: 1,
      cursor: page.nextCursor,
    }),
  ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
  const next = await Service.list(scope, "manager", sessionId, {
    limit: 1,
    cursor: page.nextCursor,
  });
  expect(next.items[0].creditNoteId).not.toBe(page.items[0].creditNoteId);
  await expect(
    Service.detail(
      { ...scope, outletId: randomUUID() },
      "manager",
      page.items[0].creditNoteId,
    ),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_NOT_FOUND" });
});

test.each(["line", "receipt"])(
  "independent %s amount ceiling rejects over-credit",
  async (kind) => {
    await create();
    const sk =
      kind === "line"
        ? K.restaurantCreditLineControlSK(
            selected[0].orderId,
            selected[0].itemId,
          )
        : K.restaurantCreditBalanceSK();
    const key = JSON.stringify([
      K.restaurantBillPK(scope.orgId, scope.outletId, billId),
      sk,
    ]);
    const row = unmarshall(db.rows.get(key)!);
    row.data.creditedMinor = 200;
    db.rows.set(key, marshall(row));
    await expect(create()).rejects.toMatchObject({
      messageCode:
        kind === "line"
          ? "RESTAURANTS_CREDIT_VALUE_EXCEEDED"
          : "RESTAURANTS_CREDIT_CEILING",
    });
    expect(db.transactions).toHaveLength(1);
  },
);

test("creditability rejects a corrupted quantity-times-price control without clamping", async () => {
  await create();
  const key = JSON.stringify([
    K.restaurantBillPK(scope.orgId, scope.outletId, billId),
    K.restaurantCreditLineControlSK(selected[0].orderId, selected[0].itemId),
  ]);
  const row = unmarshall(db.rows.get(key)!);
  row.data.creditedMinor = 101;
  db.rows.set(key, marshall(row));
  await expect(
    Service.list(scope, "manager", sessionId, {}),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_CREDIT_SOURCE" });
  expect(db.transactions).toHaveLength(1);
});
test("source chain tampering and missing parts fail without writes", async () => {
  const key = JSON.stringify([
    K.restaurantBillPK(scope.orgId, scope.outletId, billId),
    K.restaurantBillPartSK(1),
  ]);
  const row = unmarshall(db.rows.get(key)!);
  row.data.content.lines[0].snapshot.name = "Changed";
  db.rows.set(key, marshall(row));
  await expect(create()).rejects.toThrow();
  db.rows.delete(key);
  await expect(create()).rejects.toThrow();
  expect(db.transactions).toHaveLength(0);
});

test("real membership/entitlement/outlet checks fit the 16-line budget and sources stay unchanged", async () => {
  jest.mocked(Cash.authorize).mockRestore();
  scope.orgId = "o".repeat(200);
  const actor = "m".repeat(200);
  const fixture = await acceptanceFixture(scope.orgId);
  scope.outletId = fixture.outlet.id;
  db.seedAccess(scope.orgId, actor, "MANAGER");
  jest.mocked(Sessions.session).mockRestore();
  seed(16, false, "😀".repeat(80));
  await Cash.mutate(scope, actor, "OPEN_DAY", {
    clientRequestId: randomUUID(),
    operationalTimezone: "Africa/Porto-Novo",
  });
  const before = new Map(db.rows);
  const result = await Service.create(scope, actor, sessionId, {
    ...input(2),
    reason: "😀".repeat(250),
    lines: input(2).lines.map((line) => ({ ...line, note: "😀".repeat(250) })),
  });
  expect(result.lines).toHaveLength(16);
  const budget = Repo.budget(db.transactions.at(-1)!.TransactItems!);
  expect(budget.operations).toBe(47);
  expect(budget.serializedBytes).toBeLessThan(100_000);
  console.info("CREDIT_NOTE_16_LINE_AUTHORIZED_BUDGET", budget);
  for (const [key, value] of before) {
    if (unmarshall(value).entityType === "RESTAURANT_CASH_DAY") continue;
    expect(db.rows.get(key)).toEqual(value);
  }
  expect((await Cash.activeDay(scope))!.day.data.creditNoteCount).toBe(1);
  const writes = db.transactions
    .at(-1)!
    .TransactItems!.filter((item) => item.Put)
    .map((item) => unmarshall(item.Put!.Item!));
  expect(
    writes.every((row) =>
      [
        "RESTAURANT_CREDIT_CONTROL",
        "RESTAURANT_CREDIT_NOTE",
        "RESTAURANT_CREDIT_NOTE_LINE",
        "RESTAURANT_CREDIT_NOTE_SUMMARY",
        "RESTAURANT_CREDIT_NOTE_REFERENCE",
        "RESTAURANT_CREDIT_NOTE_COMMAND",
        "RESTAURANT_DOCUMENT_CN",
        "RESTAURANT_DOCUMENT_LOCATOR",
        "RESTAURANT_CASH_DAY",
      ].includes(row.entityType),
    ),
  ).toBe(true);
});

test("concurrent durable CreditNote retry increments active BusinessDay once", async () => {
  jest.mocked(Cash.authorize).mockRestore();
  jest.mocked(Sessions.session).mockRestore();
  const fixture = await acceptanceFixture(scope.orgId);
  scope.outletId = fixture.outlet.id;
  db.seedAccess(scope.orgId, "manager", "MANAGER");
  seed();
  await Cash.mutate(scope, "manager", "OPEN_DAY", {
    clientRequestId: randomUUID(),
    operationalTimezone: "Africa/Porto-Novo",
  });
  const intent = input(1);
  const results = await Promise.all([
    Service.create(scope, "manager", sessionId, intent),
    Service.create(scope, "manager", sessionId, intent),
  ]);
  expect(results[0].data.creditNoteId).toBe(results[1].data.creditNoteId);
  expect((await Cash.activeDay(scope))!.day.data.creditNoteCount).toBe(1);
  await Service.create(scope, "manager", sessionId, intent);
  expect((await Cash.activeDay(scope))!.day.data.creditNoteCount).toBe(1);
});

test("new bound credit atomically retains one TEST preparation authorization without duplicate replay", async () => {
  seed(2, false, "Article", true);
  const provenance = await import("@/lambda/domains/restaurants/issuance-provenance-repository");
  const binding = { environment: "TEST", connectionId: randomUUID(), policyVersion: 1 };
  jest.spyOn(provenance.RestaurantIssuanceProvenanceRepository, "read").mockResolvedValue({ verified: true,
    evidence: { evidenceOrigin: "AUTHENTIC", fiscalBinding: binding } } as never);
  const input = { clientRequestId: randomUUID(), reason: "Fiscal credit", lines: selected.map(line => ({ ...line, quantity: 1 })) };
  const credit = await Service.create(scope, "manager", sessionId, input);
  const key = K.restaurantCreditNotePK(scope.orgId, scope.outletId, credit.data.creditNoteId);
  const intent = [...db.rows.values()].map(row => unmarshall(row)).find(row => row.PK === key && row.SK === K.restaurantFiscalIntentSK());
  expect(intent).toMatchObject({ state: "PENDING", invoiceId: billId, creditNoteId: credit.data.creditNoteId,
    sourceReceiptDigest: credit.data.sourceReceiptDigest, fiscalBinding: binding });
  const count = db.rows.size;
  expect((await Service.create(scope, "manager", sessionId, input)).data.creditNoteId).toBe(credit.data.creditNoteId);
  expect(db.rows.size).toBe(count);
});
