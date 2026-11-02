import { randomUUID } from "crypto";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { RestaurantCreditNoteService as Service } from "@/lambda/domains/restaurants/credit-note-service";
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
function seed(count = 1, cancelled = false, label = "Plat") {
  const lines = Array.from({ length: count }, () => ({
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
      quantity: 2,
      unitPriceMinor: 100,
      grossMinor: 200,
      subtotalMinor: 200,
      discountMinor: 0 as const,
      taxMinor: 0 as const,
      lineTotalMinor: 200,
      currency: "XOF",
      acceptedAt: time,
      submissionId: randomUUID(),
    },
    netAmountMinor: cancelled ? 0 : 200,
    ...(cancelled ? { cancelledAt: time, cancellationReason: "Annulé" } : {}),
  }));
  selected = lines.map((l) => ({
    orderId: l.orderId,
    itemId: l.itemId,
    quantity: 1,
  }));
  const amount = cancelled ? 0 : count * 200;
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
test("partial then exact remaining credit, detail/list and immutable source facts", async () => {
  const before = new Map(db.rows);
  const first = await create();
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
test("durable idempotent retry returns original and changed intent conflicts", async () => {
  const body = input();
  const first = await create(body);
  expect(await create(body)).toEqual(first);
  await expect(create({ ...body, reason: "Autre" })).rejects.toMatchObject({
    messageCode: "RESTAURANTS_CREDIT_IDEMPOTENCY",
  });
  expect(db.db.commandCalls(TransactWriteItemsCommand)).toHaveLength(1);
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
  expect(budget.operations).toBe(40);
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
  const before = new Map(db.rows);
  const result = await Service.create(scope, actor, sessionId, {
    ...input(2),
    reason: "😀".repeat(250),
    lines: input(2).lines.map((line) => ({ ...line, note: "😀".repeat(250) })),
  });
  expect(result.lines).toHaveLength(16);
  const budget = Repo.budget(db.transactions.at(-1)!.TransactItems!);
  expect(budget.operations).toBe(43);
  expect(budget.serializedBytes).toBeLessThan(100_000);
  console.info("CREDIT_NOTE_16_LINE_AUTHORIZED_BUDGET", budget);
  for (const [key, value] of before) expect(db.rows.get(key)).toEqual(value);
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
      ].includes(row.entityType),
    ),
  ).toBe(true);
});
