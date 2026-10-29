import { randomUUID } from "crypto";
import {
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { RestaurantCashService as Cash } from "@/lambda/domains/restaurants/cash-service";
import { RestaurantCashRepository as CR } from "@/lambda/domains/restaurants/cash-repository";
import { RestaurantTransactionsRepository as R } from "@/lambda/domains/restaurants/transaction-repository";
import { RestaurantTransactionsService as S } from "@/lambda/domains/restaurants/transaction-service";
import { RestaurantPaymentService as Pay } from "@/lambda/domains/restaurants/payment-service";
import { RestaurantStaffService as Staff } from "@/lambda/domains/restaurants/staff-service";
import { handler } from "@/lambda/domains/restaurants/get-outlet";
import { RESTAURANT_CASH_ROUTES } from "@/lambda/domains/restaurants/cash-routes";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { acceptanceFixture } from "./acceptance-fixture";
import { memoryDynamo } from "./memory-dynamo";
let m: ReturnType<typeof memoryDynamo>,
  f: Awaited<ReturnType<typeof acceptanceFixture>>;
const orgId = "org-resto",
  req = () => randomUUID();
const scope = () => ({ orgId, outletId: f.outlet.id });
const openDay = async () =>
  c.RestaurantBusinessDaySchema.parse(
    (
      await Cash.mutate(scope(), "owner", "OPEN_DAY", {
        clientRequestId: req(),
        operationalTimezone: "Africa/Porto-Novo",
      })
    ).data,
  );
const open = async (actorId = "cashier", amount = 1000) =>
  c.RestaurantCashSessionSchema.parse(
    (
      await Cash.mutate(scope(), actorId, "OPEN_CASH", {
        clientRequestId: req(),
        openingCashAmountMinor: amount,
      })
    ).data,
  );
const close = async (id: string, counted = 1000, actorId = "cashier") => {
  const session = await Cash.session(scope(), id);
  return Cash.mutate(
    scope(),
    actorId,
    "CLOSE_CASH",
    {
      clientRequestId: req(),
      expectedVersion: session.data.version,
      countedCashAmountMinor: counted,
    },
    id,
  );
};
const movement = async (
  id: string,
  type: "CASH_IN" | "CASH_OUT",
  amount = 100,
) =>
  Cash.mutate(
    scope(),
    "owner",
    "MOVEMENT",
    {
      clientRequestId: req(),
      expectedVersion: (await Cash.session(scope(), id)).data.version,
      type,
      amountMinor: amount,
      reason: "Drawer adjustment",
    },
    id,
  );
async function order() {
  const session = c.GuestSessionSchema.parse(
    (
      await S.mutate({ ...scope(), actorId: "owner" }, "OPEN_SESSION", {
        clientRequestId: req(),
        tableId: f.tables[0].id,
        areaId: f.tables[0].serviceAreaId,
      })
    ).data,
  );
  const o = c.RestaurantOrderSchema.parse(
    (
      await S.mutate({ ...scope(), actorId: "owner" }, "CREATE_ORDER", {
        clientRequestId: req(),
        orderType: "DINE_IN",
        guestSessionId: session.guestSessionId,
      })
    ).data,
  );
  const line = c.RestaurantOrderItemSchema.parse(
    (
      await S.mutate(
        { ...scope(), actorId: "owner" },
        "ADD_ITEM",
        {
          clientRequestId: req(),
          expectedVersion: o.version,
          menuItemId: f.items[4].id,
          categoryId: f.items[4].categoryId,
          expectedMenuItemVersion: f.items[4].version,
          quantity: 2,
        },
        { orderId: o.orderId },
      )
    ).data,
  );
  const current = await S.order(scope(), o.orderId);
  await S.mutate(
    { ...scope(), actorId: "owner" },
    "SUBMIT_ORDER",
    {
      clientRequestId: req(),
      expectedVersion: current.data.version,
      items: [{ itemId: line.itemId, expectedVersion: line.version }],
    },
    { orderId: o.orderId },
  );
  return { sessionId: session.guestSessionId, orderId: o.orderId };
}
async function payment(
  o: Awaited<ReturnType<typeof order>>,
  actorId = "cashier",
  method: "CASH" | "MOBILE_MONEY" | "CARD" = "CASH",
  amount = 500,
) {
  return Pay.capture(scope(), actorId, o.sessionId, {
    clientRequestId: req(),
    expectedVersion: (await S.session(scope(), o.sessionId)).data.version,
    method,
    currency: "XOF",
    allocations: [{ orderId: o.orderId, amountMinor: amount }],
  });
}
beforeEach(async () => {
  m = memoryDynamo();
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  f = await acceptanceFixture();
  m.seedAccess(orgId, "owner", "OWNER");
  m.seedAccess(orgId, "manager", "MANAGER");
  for (const user of ["cashier", "cashier2", "waiter", "kitchen"]) {
    m.seedAccess(
      orgId,
      user,
      user.startsWith("cashier") ? "CASHIER" : user.toUpperCase(),
    );
    await Staff.mutate(orgId, "owner", user, "BIND", {
      clientRequestId: req(),
      memberUserId: user,
      operationalLabel: `${user} staff`,
    });
    await Staff.mutate(
      orgId,
      "owner",
      user,
      "ASSIGN",
      { clientRequestId: req() },
      f.outlet.id,
    );
  }
});
afterEach(() => {
  expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
  m.db.restore();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test("explicit day required; one durable active day and one cashier session per Outlet", async () => {
  await expect(open()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_BUSINESS_DAY_REQUIRED",
  });
  const day = await openDay();
  expect(day).toMatchObject({
    status: "OPEN",
    operationalTimezone: "Africa/Porto-Novo",
    sessionCount: 0,
  });
  await expect(openDay()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_CASH_CONFLICT",
  });
  const a = await open();
  await expect(open()).rejects.toMatchObject({ statusCode: 409 });
  const b = await open("cashier2");
  expect(a.cashSessionId).not.toBe(b.cashSessionId);
  expect(
    (await Cash.activeSession(scope(), "cashier"))?.session.data.cashSessionId,
  ).toBe(a.cashSessionId);
  await expect(
    Cash.session({ ...scope(), outletId: req() }, a.cashSessionId),
  ).rejects.toMatchObject({ statusCode: 404 });
  expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
});

test("after midnight captures retain the explicit day and its opening timezone", async () => {
  jest.useFakeTimers({ now: new Date("2026-10-29T05:00:00.000Z") });
  const day = await openDay();
  const a = await open();
  const o = await order();
  jest.setSystemTime(new Date("2026-10-30T01:30:00.000Z"));
  const p = await payment(o);
  expect(day.businessDate).toBe("2026-10-29");
  expect(p.data).toMatchObject({
    businessDayId: day.businessDayId,
    cashSessionId: a.cashSessionId,
    capturedByUserId: "cashier",
    committedAt: "2026-10-30T01:30:00.000Z",
  });
  await expect(openDay()).rejects.toMatchObject({ statusCode: 409 });
});

test.each(["owner", "manager", "cashier"])(
  "%s cannot capture any method without own OPEN cash session",
  async (actor) => {
    await openDay();
    const o = await order();
    for (const method of ["CASH", "CARD", "MOBILE_MONEY"] as const)
      await expect(payment(o, actor, method)).rejects.toMatchObject({
        messageCode: "RESTAURANTS_CASH_SESSION_REQUIRED",
      });
  },
);

test("split payments attribute independently; day summary is bounded without N+1 cashier reads", async () => {
  const day = await openDay();
  const a = await open();
  const b = await open("cashier2", 200);
  const o = await order();
  await payment(o, "cashier", "CASH", 700);
  await payment(o, "cashier", "MOBILE_MONEY", 300);
  await payment(o, "cashier2", "CASH", 400);
  await payment(o, "cashier2", "CARD", 200);
  await movement(a.cashSessionId, "CASH_IN", 100);
  await movement(a.cashSessionId, "CASH_OUT", 50);
  expect(
    Cash.summary((await Cash.session(scope(), a.cashSessionId)).data),
  ).toMatchObject({
    totalPaymentsMinor: 1000,
    physicalCashPaymentsMinor: 700,
    nonCashPaymentsMinor: 300,
    session: {
      openingCashAmountMinor: 1000,
      expectedCashAmountMinor: 1750,
      cashInMinor: 100,
      cashOutMinor: 50,
      paymentCount: 2,
    },
  });
  expect(
    (await Cash.session(scope(), b.cashSessionId)).data.expectedCashAmountMinor,
  ).toBe(600);
  m.db.resetHistory();
  const summary = c.RestaurantBusinessDaySummaryResponseSchema.parse(
    await Cash.query(scope(), "owner", "SUMMARY_DAY", {}, day.businessDayId),
  );
  expect(summary.data).toMatchObject({
    paymentCount: 4,
    totalPaymentsMinor: 1600,
    paidByMethodMinor: { CASH: 1100, MOBILE_MONEY: 300, CARD: 200 },
    sessionCount: 2,
    openSessionCount: 2,
    attributionCoverage: "ATTRIBUTED_ONLY",
  });
  expect(summary.data.sessions).toHaveLength(2);
  expect(m.db.commandCalls(QueryCommand)).toHaveLength(1);
  expect(
    m.db
      .commandCalls(GetItemCommand)
      .some((call) => call.args[0].input.Key?.PK?.S?.includes("#CS#")),
  ).toBe(false);
  const facts = await CR.page(
    scope(),
    K.restaurantCashSessionPK(orgId, f.outlet.id, a.cashSessionId),
    K.restaurantPaymentReferencePrefix(),
    "PAYMENT",
    { limit: 100 },
    "INTERNAL",
  );
  expect(
    facts.rows.map((row) => row.data.amountMinor).sort((x, y) => x - y),
  ).toEqual([300, 700]);
});

test.each([900, 1000, 1200])(
  "closing counted %s freezes canonical signed variance and enables day close",
  async (counted) => {
    const day = await openDay();
    const a = await open();
    await expect(
      Cash.mutate(
        scope(),
        "owner",
        "CLOSE_DAY",
        { clientRequestId: req(), expectedVersion: day.version },
        day.businessDayId,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    const result = c.RestaurantCashSessionResponseSchema.parse(
      await close(a.cashSessionId, counted),
    );
    expect(result.data).toMatchObject({
      countedCashAmountMinor: counted,
      expectedCashAmountMinor: 1000,
      varianceAmountMinor: counted - 1000,
      status: "CLOSED",
    });
    await expect(movement(a.cashSessionId, "CASH_IN")).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(close(a.cashSessionId)).rejects.toMatchObject({
      statusCode: 409,
    });
    const d = await Cash.day(scope(), day.businessDayId);
    const command = { clientRequestId: req(), expectedVersion: d.data.version };
    const closed = await Cash.mutate(
      scope(),
      "owner",
      "CLOSE_DAY",
      command,
      day.businessDayId,
    );
    expect(
      await Cash.mutate(
        scope(),
        "owner",
        "CLOSE_DAY",
        command,
        day.businessDayId,
      ),
    ).toEqual(closed);
    expect(await Cash.activeDay(scope())).toBeUndefined();
    expect(() =>
      CR.put(
        CR.row(scope(), "DAY", d.data),
        CR.row(
          scope(),
          "DAY",
          c.RestaurantBusinessDaySchema.parse(closed.data),
        ),
      ),
    ).toThrow();
    expect((await openDay()).businessDayId).not.toBe(day.businessDayId);
  },
);

test.each([
  "OPEN_DAY",
  "OPEN_CASH",
  "MOVEMENT",
  "CLOSE_CASH",
  "CLOSE_DAY",
] as const)(
  "%s durable receipt converges after commit then lost response; changed intent conflicts",
  async (command) => {
    let target: string | undefined;
    let body: object;
    if (command === "OPEN_DAY")
      body = {
        clientRequestId: req(),
        operationalTimezone: "Africa/Porto-Novo",
      };
    else {
      const day = await openDay();
      if (command === "OPEN_CASH")
        body = { clientRequestId: req(), openingCashAmountMinor: 100 };
      else {
        const a = await open("owner");
        target = a.cashSessionId;
        if (command === "MOVEMENT")
          body = {
            clientRequestId: req(),
            expectedVersion: a.version,
            type: "CASH_IN",
            amountMinor: 10,
            reason: "Float",
          };
        else if (command === "CLOSE_CASH")
          body = {
            clientRequestId: req(),
            expectedVersion: a.version,
            countedCashAmountMinor: 1000,
          };
        else {
          await close(a.cashSessionId, 1000, "owner");
          target = day.businessDayId;
          body = {
            clientRequestId: req(),
            expectedVersion: (await Cash.day(scope(), target)).data.version,
          };
        }
      }
    }
    const original = R.commit.bind(R);
    jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
      await original(actions);
      throw new Error("Response lost after commit");
    });
    const first = await Cash.mutate(scope(), "owner", command, body, target);
    const before = new Map(m.rows);
    expect(await Cash.mutate(scope(), "owner", command, body, target)).toEqual(
      first,
    );
    expect(m.rows).toEqual(before);
    const changed = {
      ...body,
      ...(command === "OPEN_DAY"
        ? { operationalTimezone: "UTC" }
        : command === "OPEN_CASH"
          ? { openingCashAmountMinor: 999 }
          : command === "MOVEMENT"
            ? { reason: "Other intent" }
            : { expectedVersion: 999 }),
    };
    await expect(
      Cash.mutate(scope(), "owner", command, changed, target),
    ).rejects.toMatchObject({
      messageCode: "RESTAURANTS_IDEMPOTENCY_CONFLICT",
    });
  },
);

test("capture wins against close: stale close fails and the accepted payment remains in reconciliation", async () => {
  await openDay();
  const a = await open();
  const o = await order();
  const original = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    await payment(o);
    await original(actions);
  });
  await expect(close(a.cashSessionId)).rejects.toMatchObject({
    statusCode: 409,
  });
  const closed = c.RestaurantCashSessionResponseSchema.parse(
    await close(a.cashSessionId, 1500),
  );
  expect(closed.data).toMatchObject({
    paymentCount: 1,
    expectedCashAmountMinor: 1500,
    varianceAmountMinor: 0,
  });
});

test("close wins against capture: entire commercial payment fails without attribution loss", async () => {
  await openDay();
  const a = await open();
  const o = await order();
  const original = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    await close(a.cashSessionId);
    await original(actions);
  });
  await expect(payment(o)).rejects.toMatchObject({ statusCode: 409 });
  expect((await S.session(scope(), o.sessionId)).data.paidMinor).toBe(0);
  expect((await Cash.session(scope(), a.cashSessionId)).data.paymentCount).toBe(
    0,
  );
  expect(
    [...m.rows.values()]
      .map((row) => unmarshall(row))
      .filter((row) => row.entityType === "RESTAURANT_PAYMENT"),
  ).toHaveLength(0);
});

test.each([true, false])(
  "movement vs close race, movement first=%s",
  async (movementFirst) => {
    await openDay();
    const a = await open();
    const original = R.commit.bind(R);
    jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
      if (movementFirst) await movement(a.cashSessionId, "CASH_IN");
      else await close(a.cashSessionId);
      await original(actions);
    });
    await expect(
      movementFirst
        ? close(a.cashSessionId)
        : movement(a.cashSessionId, "CASH_IN"),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (await Cash.session(scope(), a.cashSessionId)).data
        .expectedCashAmountMinor,
    ).toBe(movementFirst ? 1100 : 1000);
  },
);

test("two closers cannot overwrite; day close vs session open shares conditional day authority", async () => {
  const day = await openDay();
  const a = await open();
  const original = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    await close(a.cashSessionId, 900, "owner");
    await original(actions);
  });
  await expect(close(a.cashSessionId, 1200)).rejects.toMatchObject({
    statusCode: 409,
  });
  expect(
    (await Cash.session(scope(), a.cashSessionId)).data.countedCashAmountMinor,
  ).toBe(900);
  const d = await Cash.day(scope(), day.businessDayId);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    await open("cashier2");
    await original(actions);
  });
  await expect(
    Cash.mutate(
      scope(),
      "owner",
      "CLOSE_DAY",
      { clientRequestId: req(), expectedVersion: d.data.version },
      day.businessDayId,
    ),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(
    (await Cash.day(scope(), day.businessDayId)).data.openSessionCount,
  ).toBe(1);
});

test("day close winning prevents concurrent session opening", async () => {
  const day = await openDay();
  const original = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    await Cash.mutate(
      scope(),
      "owner",
      "CLOSE_DAY",
      { clientRequestId: req(), expectedVersion: day.version },
      day.businessDayId,
    );
    await original(actions);
  });
  await expect(open()).rejects.toMatchObject({ statusCode: 409 });
  expect(await Cash.activeSession(scope(), "cashier")).toBeUndefined();
});

test("legacy payments decode without fabricated attribution and never enter current totals", async () => {
  const day = await openDay();
  await open();
  const o = await order();
  const p = (await payment(o)).data;
  const {
    capturedByUserId: _by,
    cashSessionId: _cs,
    businessDayId: _bd,
    allocations: _alloc,
    session: _session,
    ...legacy
  } = p;
  expect(c.RestaurantPaymentSchema.parse(legacy)).not.toHaveProperty(
    "businessDayId",
  );
  const key = {
    PK: K.restaurantPaymentPK(orgId, f.outlet.id, p.paymentId),
    SK: K.restaurantTransactionMetaSK(),
  };
  const row = R.row(scope(), key, "PAYMENT", legacy);
  expect(
    R.decode(
      scope(),
      key,
      "PAYMENT",
      marshall(row, { removeUndefinedValues: true }),
    ),
  ).toMatchObject({
    data: JSON.parse(JSON.stringify(legacy)),
  });
  const oldId = req();
  const oldKey = {
    PK: K.restaurantPaymentPK(orgId, f.outlet.id, oldId),
    SK: K.restaurantTransactionMetaSK(),
  };
  m.rows.set(
    JSON.stringify([oldKey.PK, oldKey.SK]),
    marshall(
      R.row(scope(), oldKey, "PAYMENT", { ...legacy, paymentId: oldId }),
      { removeUndefinedValues: true },
    ),
  );
  const current = c.RestaurantBusinessDaySummaryResponseSchema.parse(
    await Cash.query(scope(), "owner", "SUMMARY_DAY", {}, day.businessDayId),
  );
  expect(current.data).toMatchObject({
    paymentCount: 1,
    totalPaymentsMinor: 500,
    attributionCoverage: "ATTRIBUTED_ONLY",
  });
  for (const invalid of [
    { ...legacy, businessDayId: day.businessDayId },
    { ...p, capturedByUserId: "somebody" },
    { ...p, PK: "bad" },
  ])
    expect(c.RestaurantPaymentSchema.safeParse(invalid).success).toBe(false);
});

test("pagination is scoped by actor/outlet/parent; signed cash expectation and amounts remain exact", async () => {
  const day = await openDay();
  const a = await open();
  await movement(a.cashSessionId, "CASH_IN", 1);
  await movement(a.cashSessionId, "CASH_OUT", 1500);
  const page = c.RestaurantCashMovementListResponseSchema.parse(
    await Cash.query(
      scope(),
      "owner",
      "MOVEMENTS",
      { limit: 1 },
      a.cashSessionId,
    ),
  );
  expect(page.nextCursor).toBeDefined();
  const second = c.RestaurantCashMovementListResponseSchema.parse(
    await Cash.query(
      scope(),
      "owner",
      "MOVEMENTS",
      { limit: 1, cursor: page.nextCursor },
      a.cashSessionId,
    ),
  );
  expect(second.items[0].movementId).not.toBe(page.items[0].movementId);
  await expect(
    Cash.query(
      scope(),
      "manager",
      "MOVEMENTS",
      { limit: 1, cursor: page.nextCursor },
      a.cashSessionId,
    ),
  ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
  expect(
    (await Cash.session(scope(), a.cashSessionId)).data.expectedCashAmountMinor,
  ).toBe(-499);
  for (const amountMinor of [0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1])
    await expect(
      movement(a.cashSessionId, "CASH_IN", amountMinor),
    ).rejects.toThrow();
  expect(
    c.RestaurantBusinessDayListResponseSchema.parse(
      await Cash.query(scope(), "owner", "DAYS", { limit: 1 }),
    ).items[0].businessDayId,
  ).toBe(day.businessDayId);
});

test.each(["waiter", "kitchen"])(
  "%s has no cash actions or reads",
  async (actor) => {
    const day = await openDay();
    const a = await open();
    await expect(open(actor)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      Cash.query(scope(), actor, "CASH", {}, a.cashSessionId),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      Cash.query(scope(), actor, "SUMMARY_DAY", {}, day.businessDayId),
    ).rejects.toMatchObject({ statusCode: 403 });
  },
);

test("cashier isolation and movement policy enforced in service; managers can close another cashier", async () => {
  const day = await openDay();
  const a = await open();
  await expect(
    Cash.query(scope(), "cashier2", "CASH", {}, a.cashSessionId),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(close(a.cashSessionId, 1000, "cashier2")).rejects.toMatchObject({
    statusCode: 403,
  });
  await expect(
    Cash.query(scope(), "cashier", "SUMMARY_DAY", {}, day.businessDayId),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    Cash.mutate(
      scope(),
      "cashier",
      "MOVEMENT",
      {
        clientRequestId: req(),
        expectedVersion: a.version,
        type: "CASH_IN",
        amountMinor: 1,
        reason: "Float",
      },
      a.cashSessionId,
    ),
  ).rejects.toMatchObject({ statusCode: 403 });
  await close(a.cashSessionId, 1000, "manager");
});

test("revoked membership at commit prevents entire cash command and receipt", async () => {
  await openDay();
  const original = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    m.seedAccess(orgId, "cashier", "WAITER");
    await original(actions);
  });
  await expect(open()).rejects.toMatchObject({ statusCode: 403 });
  expect(
    [...m.rows.values()]
      .map((row) => unmarshall(row))
      .filter((row) => row.entityType === "RESTAURANT_CASH_SESSION"),
  ).toHaveLength(0);
});

test("exact routes dispatch through existing management Lambda; path/body collision rejected", async () => {
  const route = RESTAURANT_CASH_ROUTES.find(
    (r) => "command" in r && r.command === "OPEN_DAY",
  )!;
  const event = {
    routeKey: `${route.method} ${route.path}`,
    headers: { "x-org-id": orgId, "accept-language": "en" },
    pathParameters: { outletId: f.outlet.id },
    requestContext: { authorizer: { jwt: { claims: { sub: "owner" } } } },
    body: JSON.stringify({
      clientRequestId: req(),
      operationalTimezone: "Africa/Porto-Novo",
    }),
  };
  const result = await handler(event);
  expect(result.statusCode).toBe(200);
  expect(
    c.RestaurantBusinessDayResponseSchema.safeParse(JSON.parse(result.body))
      .success,
  ).toBe(true);
  const bad = await handler({
    ...event,
    body: JSON.stringify({
      clientRequestId: req(),
      operationalTimezone: "UTC",
      outletId: f.outlet.id,
    }),
  });
  expect(bad.statusCode).toBe(400);
  const denied = await handler({
    ...event,
    requestContext: { authorizer: { jwt: { claims: { sub: "cashier" } } } },
  });
  expect(denied.statusCode).toBe(403);
  expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
  for (const call of m.db.commandCalls(TransactWriteItemsCommand))
    expect(call.args[0].input.TransactItems!.length).toBeLessThan(15);
});

test.each(["DAY", "CASH"] as const)(
  "simultaneous %s openings preserve uniqueness atomically",
  async (kind) => {
    if (kind === "CASH") await openDay();
    const original = R.commit.bind(R);
    jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
      if (kind === "DAY") await openDay();
      else await open();
      await original(actions);
    });
    await expect(kind === "DAY" ? openDay() : open()).rejects.toMatchObject({
      statusCode: 409,
    });
    const rows = [...m.rows.values()].map((row) => unmarshall(row));
    expect(
      rows.filter(
        (row) =>
          row.entityType ===
          (kind === "DAY" ? "RESTAURANT_CASH_DAY" : "RESTAURANT_CASH_SESSION"),
      ),
    ).toHaveLength(1);
  },
);

test("stale close version fails; immutable movements and forged physical identities are rejected", async () => {
  await openDay();
  const a = await open();
  const first = c.RestaurantCashMovementSchema.parse(
    (await movement(a.cashSessionId, "CASH_IN")).data,
  );
  await expect(
    Cash.mutate(
      scope(),
      "cashier",
      "CLOSE_CASH",
      {
        clientRequestId: req(),
        expectedVersion: a.version,
        countedCashAmountMinor: 1100,
      },
      a.cashSessionId,
    ),
  ).rejects.toMatchObject({ statusCode: 409 });
  const row = CR.row(scope(), "MOVEMENT", first);
  expect(() => CR.put(row, row)).toThrow();
  expect(() =>
    CR.decode(scope(), { PK: row.PK, SK: row.SK }, "MOVEMENT", {
      ...row,
      data: { ...first, cashSessionId: req() },
    }),
  ).toThrow();
  expect(() =>
    CR.row(scope(), "MOVEMENT", { ...first, orgId: "another" }),
  ).toThrow();
});

test("late payment retry returns original attribution after session closure; new payment rejected", async () => {
  await openDay();
  const a = await open();
  const o = await order();
  const body = {
    clientRequestId: req(),
    expectedVersion: (await S.session(scope(), o.sessionId)).data.version,
    method: "CASH",
    currency: "XOF",
    allocations: [{ orderId: o.orderId, amountMinor: 100 }],
  };
  const paid = await Pay.capture(scope(), "cashier", o.sessionId, body);
  await close(a.cashSessionId, 1100);
  expect(await Pay.capture(scope(), "cashier", o.sessionId, body)).toEqual(
    paid,
  );
  await expect(payment(o)).rejects.toMatchObject({
    messageCode: "RESTAURANTS_CASH_SESSION_REQUIRED",
  });
});

test("stale pointer fails closed and is never stolen; session cardinality guard is explicit", async () => {
  const d = await openDay();
  const a = await open();
  const key = K.restaurantActiveCashierKey(orgId, f.outlet.id, "cashier");
  const pointer = CR.row(scope(), "ACTIVE_CASHIER", {
    cashSessionId: req(),
    cashierUserId: "cashier",
  });
  m.rows.set(JSON.stringify([key.PK, key.SK]), marshall(pointer));
  await expect(Cash.activeSession(scope(), "cashier")).rejects.toMatchObject({
    statusCode: 404,
  });
  await expect(open()).rejects.toMatchObject({ statusCode: 409 });
  expect((await Cash.session(scope(), a.cashSessionId)).data.status).toBe(
    "OPEN",
  );
  const day = await Cash.day(scope(), d.businessDayId);
  m.rows.set(
    JSON.stringify([day.PK, day.SK]),
    marshall({ ...day, data: { ...day.data, sessionCount: 100 } }),
  );
  await expect(open("cashier2")).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_LIMIT",
  });
});

test("cash movement currency and day are server-owned; methods classify physical cash only", async () => {
  await openDay();
  const a = await open();
  expect(
    ["CASH", "CARD", "MOBILE_MONEY"].map((m) =>
      c.restaurantPaymentSemantic(c.RestaurantPaymentMethodSchema.parse(m)),
    ),
  ).toEqual(["PHYSICAL_CASH", "NON_CASH", "NON_CASH"]);
  const base = {
    clientRequestId: req(),
    expectedVersion: a.version,
    type: "CASH_IN",
    amountMinor: 1,
    reason: "Float",
  };
  for (const injected of [
    { currency: "EUR" },
    { businessDayId: req() },
    { expectedCashAmountMinor: 999 },
    { actorId: "owner" },
  ])
    await expect(
      Cash.mutate(
        scope(),
        "owner",
        "MOVEMENT",
        { ...base, ...injected },
        a.cashSessionId,
      ),
    ).rejects.toThrow();
});
