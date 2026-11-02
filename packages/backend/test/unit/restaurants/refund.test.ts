import { randomUUID } from "crypto";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { RestaurantRefundService as Refund } from "@/lambda/domains/restaurants/refund-service";
import {
  RestaurantRefundRepository as RefundItems,
  RestaurantRefundBalanceSchema,
} from "@/lambda/domains/restaurants/refund-repository";
import { RestaurantCreditNoteRepository as Items } from "@/lambda/domains/restaurants/credit-note-repository";
import { RestaurantCashRepository as CashItems } from "@/lambda/domains/restaurants/cash-repository";
import { RestaurantCashService as Cash } from "@/lambda/domains/restaurants/cash-service";
import { RestaurantPaymentService as Pay } from "@/lambda/domains/restaurants/payment-service";
import { RestaurantTransactionsService as Sessions } from "@/lambda/domains/restaurants/transaction-service";
import { RESTAURANT_REFUND_ROUTES } from "@/lambda/domains/restaurants/refund-routes";
import { handler } from "@/lambda/domains/restaurants/get-outlet";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { memoryDynamo } from "./memory-dynamo";
import { acceptanceFixture } from "./acceptance-fixture";

let db: ReturnType<typeof memoryDynamo>,
  fixture: Awaited<ReturnType<typeof acceptanceFixture>>;
let scope: { orgId: string; outletId: string }, credit: c.RestaurantCreditNote;
const request = (
  amountMinor = 400,
  method: "CASH" | "CARD" | "MOBILE_MONEY" = "CASH",
) => ({ clientRequestId: randomUUID(), amountMinor, method });
const create = (body: unknown = request(), actor = "owner") =>
  Refund.create(scope, actor, credit.creditNoteId, body);
const keyOf = (pk: string, sk = "META") => JSON.stringify([pk, sk]);
const cnPK = () =>
  K.restaurantCreditNotePK(scope.orgId, scope.outletId, credit.creditNoteId);
const active = async (actor = "owner") =>
  (await Cash.activeSession(scope, actor))!;
const open = async (actor = "owner") =>
  Cash.mutate(scope, actor, "OPEN_CASH", {
    clientRequestId: randomUUID(),
    openingCashAmountMinor: 1000,
  });
async function movement(
  type: "CASH_IN" | "CASH_OUT" = "CASH_IN",
  amountMinor = 50,
) {
  const { session } = await active();
  return Cash.mutate(
    scope,
    "owner",
    "MOVEMENT",
    {
      clientRequestId: randomUUID(),
      expectedVersion: session.data.version,
      type,
      amountMinor,
      reason: "Test caisse",
    },
    session.data.cashSessionId,
  );
}
function seedCredit() {
  const at = "2026-11-01T10:00:00.000Z";
  credit = c.RestaurantCreditNoteSchema.parse({
    creditNoteId: randomUUID(),
    creditNoteReference: "AV-20261101-1234ABCD",
    ...scope,
    guestSessionId: randomUUID(),
    finalBillId: randomUUID(),
    sourceReceiptDigest: "a".repeat(64),
    currency: "XOF",
    amountMinor: 900,
    reason: "Retour client",
    status: "VALIDATED",
    validatedAt: at,
    validatedByUserId: "owner",
    schemaVersion: 1,
    clientRequestId: randomUUID(),
    intentFingerprint: "b".repeat(64),
    entityType: "RESTAURANT_CREDIT_NOTE",
    lineCount: 1,
  });
  const line = c.RestaurantCreditNoteLineSchema.parse({
    creditNoteId: credit.creditNoteId,
    creditNoteLineId: randomUUID(),
    orderId: randomUUID(),
    itemId: randomUUID(),
    sourcePartNumber: 1,
    sourcePosition: 0,
    menuItemId: fixture.items[4].id,
    label: "Dessert",
    originalQuantity: 2,
    creditedQuantity: 2,
    unitAmountMinor: 450,
    originalNetAmountMinor: 900,
    creditedAmountMinor: 900,
    currency: "XOF",
    taxMinor: 0,
    discountMinor: 0,
    schemaVersion: 1,
    entityType: "RESTAURANT_CREDIT_NOTE_LINE",
  });
  for (const [sk, type, data] of [
    ["META", "RESTAURANT_CREDIT_NOTE", credit],
    [
      K.restaurantCreditNoteLineSK(line.orderId, line.itemId),
      "RESTAURANT_CREDIT_NOTE_LINE",
      line,
    ],
  ] as const) {
    const row = Items.row(scope, { PK: cnPK(), SK: sk }, type, data);
    db.rows.set(keyOf(row.PK, row.SK), marshall(row));
  }
}
beforeEach(async () => {
  db = memoryDynamo();
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  fixture = await acceptanceFixture();
  scope = { orgId: "org-resto", outletId: fixture.outlet.id };
  db.seedAccess(scope.orgId, "owner", "OWNER");
  db.seedAccess(scope.orgId, "manager", "MANAGER");
  await Cash.mutate(scope, "owner", "OPEN_DAY", {
    clientRequestId: randomUUID(),
    operationalTimezone: "Africa/Porto-Novo",
  });
  await open();
  seedCredit();
});
afterEach(() => {
  expect(db.db.commandCalls(ScanCommand)).toHaveLength(0);
  db.db.restore();
  jest.restoreAllMocks();
});
async function balance() {
  return RefundItems.get(
    scope,
    { PK: cnPK(), SK: K.restaurantRefundBalanceSK() },
    "RESTAURANT_REFUND_BALANCE",
    RestaurantRefundBalanceSchema,
  );
}
test("partial, exact remaining, canonical/detail/list/activity, no generic movement, immutable commercial and historical facts", async () => {
  const original = new Map(db.rows);
  const before = await active();
  const first = await create();
  const canonical = await Refund.invoiceDetail(
    scope,
    "owner",
    first.data.refundId,
  );
  expect(canonical.data.invoiceId).toBe(credit.finalBillId);
  expect(canonical.data.creditNoteId).toBe(credit.creditNoteId);
  expect(canonical.data).not.toHaveProperty("paymentId");
  const second = await create(request(500));
  expect(first.data).toMatchObject({
    status: "CONFIRMED",
    amountMinor: 400,
    cashSessionId: before.session.data.cashSessionId,
    businessDayId: before.session.data.businessDayId,
    guestSessionId: credit.guestSessionId,
    finalBillId: credit.finalBillId,
    currency: "XOF",
  });
  expect(first.data.refundReference).toMatch(/^REF-\d{8}-[A-F0-9]{8}$/);
  expect(await Refund.detail(scope, "owner", first.data.refundId)).toEqual(
    first,
  );
  const list = await Refund.list(scope, "owner", credit.creditNoteId, {
    limit: 1,
  });
  expect(list.items).toHaveLength(1);
  expect(list.nextCursor).toBeTruthy();
  const next = await Refund.list(scope, "owner", credit.creditNoteId, {
    limit: 1,
    cursor: list.nextCursor,
  });
  expect(
    new Set([...list.items, ...next.items].map((x) => x.refundId)).size,
  ).toBe(2);
  expect(
    (
      await Refund.cashActivity(
        scope,
        "owner",
        before.session.data.cashSessionId,
        {},
      )
    ).items,
  ).toHaveLength(2);
  expect(await balance()).toMatchObject({
    refundedMinor: 900,
    refundCount: 2,
    version: 2,
    creditNoteAmountMinor: 900,
  });
  expect((await active()).session.data).toMatchObject({
    expectedCashAmountMinor: 100,
    refundCount: 2,
    refundedByMethodMinor: { CASH: 900, CARD: 0, MOBILE_MONEY: 0 },
  });
  const mutable = new Set([
    keyOf(before.session.PK),
    keyOf(
      K.restaurantBusinessDayPK(
        scope.orgId,
        scope.outletId,
        before.session.data.businessDayId,
      ),
      K.restaurantCashSessionSK(
        before.session.data.openedAt,
        before.session.data.cashSessionId,
      ),
    ),
  ]);
  for (const [key, value] of original)
    if (!mutable.has(key)) expect(db.rows.get(key)).toEqual(value);
  expect(
    [...db.rows.values()]
      .map((v) => unmarshall(v))
      .filter((x) => x.entityType === "RESTAURANT_CASH_MOVEMENT"),
  ).toHaveLength(0);
  await expect(create(request(1))).rejects.toMatchObject({
    messageCode: "RESTAURANTS_REFUND_EXCEEDED",
  });
  expect(second.data.refundId).not.toBe(first.data.refundId);
});
test.each(["CASH", "CARD", "MOBILE_MONEY"] as const)(
  "full %s refund updates method aggregate and only CASH reduces drawer",
  async (method) => {
    await create(request(900, method));
    expect((await active()).session.data).toMatchObject({
      refundCount: 1,
      expectedCashAmountMinor: method === "CASH" ? 100 : 1000,
      refundedByMethodMinor: { [method]: 900 },
    });
  },
);
test("same normalized intent replays after session closure without extra consumption; changed intent conflicts", async () => {
  const body = { ...request(), externalReference: " provider-123 " };
  const first = await create(body);
  const state = await active();
  await Cash.mutate(
    scope,
    "owner",
    "CLOSE_CASH",
    {
      clientRequestId: randomUUID(),
      expectedVersion: state.session.data.version,
      countedCashAmountMinor: 600,
    },
    state.session.data.cashSessionId,
  );
  const before = new Map(db.rows);
  expect(await create({ ...body, externalReference: "provider-123" })).toEqual(
    first,
  );
  expect(db.rows).toEqual(before);
  await expect(create({ ...body, amountMinor: 401 })).rejects.toMatchObject({
    messageCode: "RESTAURANTS_REFUND_IDEMPOTENCY",
  });
  expect(await balance()).toMatchObject({ refundedMinor: 400, version: 1 });
});
test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  "invalid amount %s rejected atomically",
  async (amount) => {
    const before = new Map(db.rows);
    await expect(create(request(amount))).rejects.toMatchObject({
      messageCode: "RESTAURANTS_REFUND_AMOUNT",
    });
    expect(db.rows).toEqual(before);
  },
);
test.each(["CHEQUE", null])(
  "unsupported method %s rejected",
  async (method) => {
    await expect(create({ ...request(), method })).rejects.toMatchObject({
      messageCode: "RESTAURANTS_REFUND_METHOD",
    });
  },
);
test.each(["x".repeat(201), "bad\nref", ""])(
  "invalid external reference rejected",
  async (externalReference) => {
    await expect(
      create({ ...request(), externalReference }),
    ).rejects.toMatchObject({
      messageCode: "RESTAURANTS_REFUND_EXTERNAL_REFERENCE",
    });
  },
);
test("client cannot provide derived context/currency", async () => {
  await expect(
    create({ ...request(), currency: "USD", cashSessionId: randomUUID() }),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_REFUND_REQUEST" });
});
test("missing/nonvalidated/inconsistent CreditNote are rejected", async () => {
  const key = keyOf(cnPK()),
    original = db.rows.get(key)!;
  db.rows.delete(key);
  await expect(create()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_REFUND_CREDIT_NOT_FOUND",
  });
  const row = unmarshall(original);
  row.data.status = "DRAFT";
  db.rows.set(key, marshall(row));
  await expect(create()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_REFUND_CREDIT_NOT_VALIDATED",
  });
  row.data.status = "VALIDATED";
  row.data.amountMinor = 899;
  db.rows.set(key, marshall(row));
  await expect(create()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_REFUND_SOURCE",
  });
});
test("missing active day or own session rejected", async () => {
  const ptr = keyOf(
    K.restaurantBusinessDaysPK(scope.orgId, scope.outletId),
    K.restaurantOccupancySK(),
  );
  const raw = db.rows.get(ptr)!;
  db.rows.delete(ptr);
  await expect(create()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_REFUND_DAY_REQUIRED",
  });
  db.rows.set(ptr, raw);
  await expect(create(request(), "manager")).rejects.toMatchObject({
    messageCode: "RESTAURANTS_REFUND_SESSION_REQUIRED",
  });
});
test("MANAGER succeeds only with own open context; current day differs from historical commercial context", async () => {
  await open("manager");
  const result = await create(request(), "manager");
  expect(result.data.refundedByUserId).toBe("manager");
  expect(result.data.cashSessionId).toBe(
    (await active("manager")).session.data.cashSessionId,
  );
});
test("refund belongs to newly opened execution day and leaves the closed historical day/session unchanged", async () => {
  const prior = await active();
  await Cash.mutate(
    scope,
    "owner",
    "CLOSE_CASH",
    {
      clientRequestId: randomUUID(),
      expectedVersion: prior.session.data.version,
      countedCashAmountMinor: 1000,
    },
    prior.session.data.cashSessionId,
  );
  const oldDay = (await Cash.activeDay(scope))!.day;
  await Cash.mutate(
    scope,
    "owner",
    "CLOSE_DAY",
    { clientRequestId: randomUUID(), expectedVersion: oldDay.data.version },
    oldDay.data.businessDayId,
  );
  const historical = new Map(
    [...db.rows].filter(([, value]) => {
      const row = unmarshall(value);
      return row.PK === prior.session.PK || row.PK === oldDay.PK;
    }),
  );
  await Cash.mutate(scope, "owner", "OPEN_DAY", {
    clientRequestId: randomUUID(),
    operationalTimezone: "Africa/Porto-Novo",
  });
  await open();
  const result = await create();
  expect(result.data.cashSessionId).not.toBe(prior.session.data.cashSessionId);
  expect(result.data.businessDayId).not.toBe(oldDay.data.businessDayId);
  for (const [key, value] of historical)
    expect(db.rows.get(key)).toEqual(value);
});
test.each(["CASHIER", "WAITER", "KITCHEN"])(
  "%s cannot execute even with a valid spoofed context",
  async (role) => {
    jest.spyOn(Cash, "authorize").mockResolvedValue({ role, actions: [] });
    const before = new Map(db.rows);
    await expect(create()).rejects.toMatchObject({
      messageCode: "RESTAURANTS_REFUND_ROLE",
    });
    expect(db.rows).toEqual(before);
  },
);
test("currency mismatch rejected", async () => {
  const state = await active();
  const raw = unmarshall(db.rows.get(keyOf(state.session.PK))!);
  raw.data.currency = "USD";
  db.rows.set(keyOf(state.session.PK), marshall(raw));
  await expect(create()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_REFUND_CURRENCY",
  });
});
test("concurrent competing refunds cannot overconsume and loser leaves no facts, projections or proof", async () => {
  const before = new Map(db.rows);
  const outcomes = await Promise.allSettled([
    create(request(600)),
    create(request(600)),
  ]);
  expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(await balance()).toMatchObject({
    refundedMinor: 600,
    refundCount: 1,
    version: 1,
  });
  const additions = [...db.rows]
    .filter(([key]) => !before.has(key))
    .map(([, v]) => unmarshall(v));
  for (const type of [
    "RESTAURANT_REFUND",
    "RESTAURANT_REFUND_CREDIT_PROJECTION",
    "RESTAURANT_REFUND_CASH_PROJECTION",
    "RESTAURANT_REFUND_COMMAND",
    "RESTAURANT_REFUND_REFERENCE",
  ])
    expect(additions.filter((x) => x.entityType === type)).toHaveLength(1);
  expect((await active()).session.data.expectedCashAmountMinor).toBe(400);
});
test("post-commit timeout recovers durable proof", async () => {
  const original = RefundItems.commit.bind(RefundItems);
  jest.spyOn(RefundItems, "commit").mockImplementationOnce(async (actions) => {
    await original(actions);
    throw new Error("network timeout");
  });
  const body = request();
  const first = await create(body);
  expect(await create(body)).toEqual(first);
  expect(await balance()).toMatchObject({ refundedMinor: 400, refundCount: 1 });
});
test("transaction race closing current day leaves no partial refund", async () => {
  const original = RefundItems.commit.bind(RefundItems);
  jest.spyOn(RefundItems, "commit").mockImplementationOnce(async (actions) => {
    const day = (await Cash.activeDay(scope))!.day;
    const raw = unmarshall(db.rows.get(keyOf(day.PK))!);
    raw.data.version++;
    db.rows.set(keyOf(day.PK), marshall(raw));
    await original(actions);
  });
  const state = await active();
  await expect(create()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_REFUND_CONFLICT",
  });
  expect(await balance()).toBeUndefined();
  expect(
    (await Cash.session(scope, state.session.data.cashSessionId)).data,
  ).toEqual(state.session.data);
  expect(
    [...db.rows.values()]
      .map((v) => unmarshall(v))
      .filter((x) => x.entityType === "RESTAURANT_REFUND"),
  ).toHaveLength(0);
});
async function payment() {
  const session = c.GuestSessionSchema.parse(
    (
      await Sessions.mutate({ ...scope, actorId: "owner" }, "OPEN_SESSION", {
        clientRequestId: randomUUID(),
        tableId: fixture.tables[0].id,
        areaId: fixture.tables[0].serviceAreaId,
      })
    ).data,
  );
  const order = c.RestaurantOrderSchema.parse(
    (
      await Sessions.mutate({ ...scope, actorId: "owner" }, "CREATE_ORDER", {
        clientRequestId: randomUUID(),
        orderType: "DINE_IN",
        guestSessionId: session.guestSessionId,
      })
    ).data,
  );
  const item = c.RestaurantOrderItemSchema.parse(
    (
      await Sessions.mutate(
        { ...scope, actorId: "owner" },
        "ADD_ITEM",
        {
          clientRequestId: randomUUID(),
          expectedVersion: order.version,
          menuItemId: fixture.items[4].id,
          categoryId: fixture.items[4].categoryId,
          expectedMenuItemVersion: fixture.items[4].version,
          quantity: 2,
        },
        { orderId: order.orderId },
      )
    ).data,
  );
  await Sessions.mutate(
    { ...scope, actorId: "owner" },
    "SUBMIT_ORDER",
    {
      clientRequestId: randomUUID(),
      expectedVersion: (await Sessions.order(scope, order.orderId)).data
        .version,
      items: [{ itemId: item.itemId, expectedVersion: item.version }],
    },
    { orderId: order.orderId },
  );
  return {
    sessionId: session.guestSessionId,
    orderId: order.orderId,
  };
}
async function capture(
  target: Awaited<ReturnType<typeof payment>>,
  amount = 500,
  method: "CASH" | "CARD" | "MOBILE_MONEY" = "CASH",
) {
  return Pay.capture(scope, "owner", target.sessionId, {
    clientRequestId: randomUUID(),
    expectedVersion: (await Sessions.session(scope, target.sessionId)).data
      .version,
    method,
    currency: "XOF",
    allocations: [{ orderId: target.orderId, amountMinor: amount }],
  });
}
test.each(["A", "B"])(
  "sequence %s preserves refund effect after real payment and movement writes, then close/variance/day close",
  async (sequence) => {
    const target = await payment();
    await capture(target);
    if (sequence === "B") await movement();
    await create();
    await capture(target);
    if (sequence === "A") await movement();
    const { session } = await active();
    expect(session.data).toMatchObject({
      expectedCashAmountMinor: 1650,
      refundCount: 1,
      refundedByMethodMinor: { CASH: 400, CARD: 0, MOBILE_MONEY: 0 },
      paymentCount: 2,
      cashInMinor: 50,
    });
    const projection = await CashItems.get(
      scope,
      CashItems.key(scope, "DAY_SESSION", session.data),
      "DAY_SESSION",
    );
    expect(projection?.data).toEqual(session.data);
    await Cash.mutate(
      scope,
      "owner",
      "CLOSE_CASH",
      {
        clientRequestId: randomUUID(),
        expectedVersion: session.data.version,
        countedCashAmountMinor: 1600,
      },
      session.data.cashSessionId,
    );
    expect(
      (await Cash.session(scope, session.data.cashSessionId)).data,
    ).toMatchObject({
      status: "CLOSED",
      expectedCashAmountMinor: 1650,
      varianceAmountMinor: -50,
      refundCount: 1,
    });
    const day = (await Cash.activeDay(scope))!.day;
    await Cash.mutate(
      scope,
      "owner",
      "CLOSE_DAY",
      { clientRequestId: randomUUID(), expectedVersion: day.data.version },
      day.data.businessDayId,
    );
  },
);
test("sequence C: CASH refund then CARD/MOBILE refunds and payment/movement retains physical cash exactly once", async () => {
  await create(request(400));
  await create(request(200, "CARD"));
  await create(request(100, "MOBILE_MONEY"));
  const target = await payment();
  await capture(target, 500, "CARD");
  await movement("CASH_OUT", 50);
  expect((await active()).session.data).toMatchObject({
    expectedCashAmountMinor: 550,
    refundCount: 3,
    refundedByMethodMinor: { CASH: 400, CARD: 200, MOBILE_MONEY: 100 },
    paidByMethodMinor: { CASH: 0, CARD: 500, MOBILE_MONEY: 0 },
  });
});
test("historical sessions without refund fields support payment, movement and close without backfill", async () => {
  const { session } = await active();
  for (const key of [
    keyOf(session.PK),
    keyOf(
      K.restaurantBusinessDayPK(
        scope.orgId,
        scope.outletId,
        session.data.businessDayId,
      ),
      K.restaurantCashSessionSK(
        session.data.openedAt,
        session.data.cashSessionId,
      ),
    ),
  ]) {
    const raw = unmarshall(db.rows.get(key)!);
    delete raw.data.refundCount;
    delete raw.data.refundedByMethodMinor;
    db.rows.set(key, marshall(raw));
  }
  const before = new Map(db.rows);
  expect((await active()).session.data.refundCount).toBe(0);
  expect(db.rows).toEqual(before);
  const target = await payment();
  await capture(target);
  await movement();
  const current = (await active()).session.data;
  expect(current.expectedCashAmountMinor).toBe(1550);
  expect(current.refundedByMethodMinor.CASH).toBe(0);
  await Cash.mutate(
    scope,
    "owner",
    "CLOSE_CASH",
    {
      clientRequestId: randomUUID(),
      expectedVersion: current.version,
      countedCashAmountMinor: 1550,
    },
    current.cashSessionId,
  );
  expect(
    (await Cash.session(scope, current.cashSessionId)).data.varianceAmountMinor,
  ).toBe(0);
});
test("three explicit refund routes and measured bounded transaction payload with maximum scoped fields", async () => {
  expect(RESTAURANT_REFUND_ROUTES).toHaveLength(3);
  expect(
    RESTAURANT_REFUND_ROUTES.some((x) => x.path.includes("payments")),
  ).toBe(false);
  const orgId = "o".repeat(200),
    actor = "u".repeat(200);
  fixture = await acceptanceFixture(orgId);
  scope = { orgId, outletId: fixture.outlet.id };
  db.seedAccess(orgId, actor, "OWNER");
  await Cash.mutate(scope, actor, "OPEN_DAY", {
    clientRequestId: randomUUID(),
    operationalTimezone: "Africa/Porto-Novo",
  });
  await open(actor);
  seedCredit();
  const { session } = await active(actor);
  const max = Number.MAX_SAFE_INTEGER;
  const creditRow = unmarshall(db.rows.get(keyOf(cnPK()))!);
  creditRow.data.amountMinor = max;
  db.rows.set(keyOf(cnPK()), marshall(creditRow));
  for (const [key, value] of db.rows) {
    const row = unmarshall(value);
    if (row.PK === cnPK() && row.SK.startsWith("LINE#")) {
      Object.assign(row.data, {
        originalQuantity: 1,
        creditedQuantity: 1,
        unitAmountMinor: max,
        originalNetAmountMinor: max,
        creditedAmountMinor: max,
      });
      db.rows.set(key, marshall(row));
    }
  }
  const sessionData = c.RestaurantCashSessionSchema.parse({
    ...session.data,
    cashierDisplayName: "😀".repeat(80),
    paymentCount: max,
    refundCount: max - 1,
    refundedByMethodMinor: { CASH: 0, CARD: max, MOBILE_MONEY: 0 },
    cashMovementCount: max,
    openingCashAmountMinor: max,
    cashInMinor: max,
    cashOutMinor: max,
    version: max - 1,
    expectedCashAmountMinor: max,
  });
  for (const kind of ["SESSION", "DAY_SESSION"] as const) {
    const row = CashItems.row(scope, kind, sessionData);
    db.rows.set(keyOf(row.PK, row.SK), marshall(row));
  }
  const oldBalance = {
    creditNoteId: credit.creditNoteId,
    creditNoteAmountMinor: max,
    currency: "XOF",
    refundedMinor: 1,
    refundCount: 1,
    version: max - 1,
    entityType: "RESTAURANT_REFUND_BALANCE",
    schemaVersion: 1,
  };
  const balanceRow = RefundItems.row(
    scope,
    { PK: cnPK(), SK: K.restaurantRefundBalanceSK() },
    "RESTAURANT_REFUND_BALANCE",
    oldBalance,
  );
  db.rows.set(keyOf(balanceRow.PK, balanceRow.SK), marshall(balanceRow));
  await create(
    { ...request(max - 1), externalReference: "😀".repeat(100) },
    actor,
  );
  const transaction = db.transactions.at(-1)!;
  const result = RefundItems.budget(transaction.TransactItems!);
  expect(result.operations).toBe(15);
  expect(result.serializedBytes).toBeLessThan(3 * 1024 * 1024);
  console.log("REFUND_TRANSACTION_BUDGET", JSON.stringify(result));
});
test("existing handler dispatches all three refund routes and rejects unauthorized execution", async () => {
  const base = {
    headers: { "x-org-id": scope.orgId, "accept-language": "en" },
    requestContext: { authorizer: { jwt: { claims: { sub: "owner" } } } },
  };
  const route = RESTAURANT_REFUND_ROUTES[0];
  const posted = await handler({
    ...base,
    routeKey: `${route.method} ${route.path}`,
    pathParameters: {
      outletId: scope.outletId,
      creditNoteId: credit.creditNoteId,
    },
    body: JSON.stringify(request()),
  });
  expect(posted.statusCode).toBe(200);
  const refund = c.RestaurantRefundResponseSchema.parse(
    JSON.parse(posted.body),
  ).data;
  for (const r of RESTAURANT_REFUND_ROUTES.slice(1)) {
    const response = await handler({
      ...base,
      routeKey: `${r.method} ${r.path}`,
      pathParameters:
        r.operation === "LIST"
          ? { outletId: scope.outletId, creditNoteId: credit.creditNoteId }
          : { outletId: scope.outletId, refundId: refund.refundId },
    });
    expect(response.statusCode).toBe(200);
  }
  for (const role of ["CASHIER", "WAITER", "KITCHEN"]) {
    db.seedAccess(scope.orgId, role.toLowerCase(), role);
    const response = await handler({
      ...base,
      requestContext: {
        authorizer: { jwt: { claims: { sub: role.toLowerCase() } } },
      },
      routeKey: `${route.method} ${route.path}`,
      pathParameters: {
        outletId: scope.outletId,
        creditNoteId: credit.creditNoteId,
      },
      body: JSON.stringify(request(1)),
    });
    expect(response.statusCode).toBe(403);
  }
});
