import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { handler } from "@/lambda/domains/restaurants/capture-payment";
import { RestaurantPaymentService as Pay } from "@/lambda/domains/restaurants/payment-service";
import { RestaurantTransactionsService as S } from "@/lambda/domains/restaurants/transaction-service";
import { RestaurantTransactionsRepository as R } from "@/lambda/domains/restaurants/transaction-repository";
import { RestaurantStaffService as Staff } from "@/lambda/domains/restaurants/staff-service";
import { RestaurantStaffRepository as SR } from "@/lambda/domains/restaurants/staff-repository";
import { DomainAuthorizationService as Auth } from "@/lambda/shared/services/domain-authorization-service";
import { acceptanceFixture } from "./acceptance-fixture";
import { memoryDynamo, fixtureId as id } from "./memory-dynamo";
let m: ReturnType<typeof memoryDynamo>,
  f: Awaited<ReturnType<typeof acceptanceFixture>>,
  session: c.GuestSession,
  order: c.RestaurantOrder,
  line: c.RestaurantOrderItem,
  seq: number;
const org = "org-resto",
  req = () => id(++seq);
const scope = () => ({ orgId: org, outletId: f.outlet.id });
const ctx = () => ({ ...scope(), actorId: "owner" });
const patch = (
  key: { PK: string; SK: string },
  edit: (raw: Record<string, unknown>) => void,
) => {
  const k = JSON.stringify([key.PK, key.SK]);
  const raw = unmarshall(m.rows.get(k)!);
  edit(raw);
  m.rows.set(k, marshall(raw, { removeUndefinedValues: true }));
};
const patchData = (key: { PK: string; SK: string }, update: object) =>
  patch(key, (raw) => Object.assign(raw.data as object, update));
const sessionKey = () => ({
  PK: K.restaurantSessionPK(org, f.outlet.id, session.guestSessionId),
  SK: K.restaurantTransactionMetaSK(),
});
const orderKey = (o = order) => ({
  PK: K.restaurantOrderPK(org, f.outlet.id, o.orderId),
  SK: K.restaurantTransactionMetaSK(),
});
async function person(actor: string, role: string, assigned = true) {
  m.seedAccess(org, actor, role);
  await Staff.mutate(org, "owner", actor, "BIND", {
    clientRequestId: req(),
    memberUserId: actor,
    operationalLabel: `${actor} staff`,
  });
  if (assigned)
    await Staff.mutate(
      org,
      "owner",
      actor,
      "ASSIGN",
      { clientRequestId: req() },
      f.outlet.id,
    );
}
async function add(o = order, quantity = 2) {
  const current = await S.order(scope(), o.orderId);
  return c.RestaurantOrderItemSchema.parse(
    (
      await S.mutate(
        ctx(),
        "ADD_ITEM",
        {
          clientRequestId: req(),
          expectedVersion: current.data.version,
          menuItemId: f.items[0].id,
          categoryId: f.items[0].categoryId,
          expectedMenuItemVersion: f.items[0].version,
          quantity,
        },
        { orderId: o.orderId },
      )
    ).data,
  );
}
async function submit(l: c.RestaurantOrderItem) {
  const current = await S.order(scope(), l.orderId);
  return c.RestaurantOrderSchema.parse(
    (
      await S.mutate(
        ctx(),
        "SUBMIT_ORDER",
        {
          clientRequestId: req(),
          expectedVersion: current.data.version,
          items: [{ itemId: l.itemId, expectedVersion: l.version }],
        },
        { orderId: l.orderId },
      )
    ).data,
  );
}
async function newOrder(accepted = true) {
  const o = c.RestaurantOrderSchema.parse(
    (
      await S.mutate(ctx(), "CREATE_ORDER", {
        clientRequestId: req(),
        orderType: "DINE_IN",
        guestSessionId: session.guestSessionId,
      })
    ).data,
  );
  if (!accepted) return o;
  return submit(await add(o));
}
async function input(
  amount = 10000,
  method: "CASH" | "MOBILE_MONEY" | "CARD" = "CASH",
  allocations = [{ orderId: order.orderId, amountMinor: amount }],
) {
  const current = await S.session(scope(), session.guestSessionId);
  return {
    clientRequestId: req(),
    expectedVersion: current.data.version,
    method,
    currency: "XOF",
    allocations,
    ...(method === "CASH" ? { cashTenderedMinor: amount } : {}),
  };
}
const call = (
  body: unknown,
  actor = "cashier",
  outletId = f.outlet.id,
  sessionId = session.guestSessionId,
  tenant = org,
) =>
  handler({
    headers: { "x-org-id": tenant, "accept-language": "en" },
    pathParameters: { outletId, sessionId },
    body: JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { sub: actor } } } },
  });
const capture = (body: unknown, actor = "cashier") =>
  Pay.capture(scope(), actor, session.guestSessionId, body);
beforeEach(async () => {
  m = memoryDynamo();
  seq = 96000;
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  f = await acceptanceFixture();
  m.seedAccess(org, "owner", "OWNER");
  m.seedAccess(org, "manager", "MANAGER");
  await person("cashier", "CASHIER");
  await person("cashier2", "CASHIER");
  session = c.GuestSessionSchema.parse(
    (
      await S.mutate(ctx(), "OPEN_SESSION", {
        clientRequestId: req(),
        tableId: f.tables[0].id,
        areaId: f.tables[0].serviceAreaId,
      })
    ).data,
  );
  order = await newOrder(false);
  line = await add();
  order = await submit(line);
});
afterEach(() => {
  m.db.restore();
  jest.restoreAllMocks();
});

test.each(["owner", "manager", "cashier"])(
  "%s captures confirmed CASH without Staff requirement for management",
  async (actor) => {
    const result = await call(await input(), actor);
    expect(result.statusCode).toBe(200);
    const data = c.RestaurantPaymentResponseSchema.parse(
      JSON.parse(result.body),
    ).data;
    expect(data).toMatchObject({
      status: "SUCCEEDED",
      appliedAmountMinor: 10000,
      cashTenderedMinor: 10000,
      changeMinor: 0,
      actorId: actor,
    });
    expect(data.session).toMatchObject({
      dueMinor: 10000,
      paidMinor: 10000,
      status: "OPEN",
    });
    expect(await S.activeTable(scope(), session.tableId)).toMatchObject({
      data: { guestSessionId: session.guestSessionId, status: "OPEN" },
    });
    expect((await S.order(scope(), order.orderId)).data).toMatchObject({
      status: "SUBMITTED",
      dueMinor: 10000,
      paidMinor: 10000,
      paymentAttemptCount: 1,
      succeededPaymentCount: 1,
      paidByMethodMinor: { CASH: 10000, MOBILE_MONEY: 0, CARD: 0 },
    });
  },
);
test.each(["MOBILE_MONEY", "CARD"] as const)(
  "%s is confirmed evidence with no provider/pending flow",
  async (method) => {
    const body = {
      ...(await input(4000, method)),
      externalReference: "confirmed-123",
    };
    const { data } = await capture(body);
    expect(data).toMatchObject({
      method,
      status: "SUCCEEDED",
      appliedAmountMinor: 4000,
      externalReference: "confirmed-123",
    });
    expect(data).not.toHaveProperty("cashTenderedMinor");
    expect(data).not.toHaveProperty("changeMinor");
    expect(data.session).toMatchObject({
      dueMinor: 10000,
      paidMinor: 4000,
      reservedMinor: 0,
      pendingPaymentCount: 0,
    });
  },
);
test("partial and multiple payments preserve due, frozen replay after later payments and cash change", async () => {
  const body = { ...(await input(4000)), cashTenderedMinor: 5000 };
  const first = await capture(body);
  expect(first.data.changeMinor).toBe(1000);
  const second = await capture(await input(6000, "CARD"));
  expect(second.data.session.paidMinor).toBe(10000);
  const before = new Map(m.rows);
  expect(await capture(body)).toEqual(first);
  expect(m.rows).toEqual(before);
  expect((await S.session(scope(), session.guestSessionId)).data).toMatchObject(
    {
      status: "OPEN",
      dueMinor: 10000,
      paidMinor: 10000,
      reservedMinor: 0,
      pendingPaymentCount: 0,
    },
  );
  expect(
    (await S.order(scope(), order.orderId)).data.paidByMethodMinor,
  ).toEqual({ CASH: 4000, MOBILE_MONEY: 0, CARD: 6000 });
});
test("three Orders: exact allocation set, references, immutable result and reordered replay", async () => {
  const orders = [order, await newOrder(), await newOrder()];
  const body = await input(
    15000,
    "CASH",
    orders.map((o) => ({ orderId: o.orderId, amountMinor: 5000 })),
  );
  const result = await capture(body);
  const pk = K.restaurantPaymentPK(org, f.outlet.id, result.data.paymentId);
  expect(
    (
      await R.get(
        scope(),
        { PK: pk, SK: K.restaurantTransactionMetaSK() },
        "PAYMENT",
      )
    )?.data,
  ).toMatchObject({ appliedAmountMinor: 15000 });
  const allocs = await R.query(
    scope(),
    pk,
    K.restaurantPaymentAllocationPrefix(),
    "PAYMENT_ALLOCATION",
    { limit: 10 },
  );
  expect(allocs.rows).toHaveLength(3);
  for (const o of orders) {
    expect((await S.order(scope(), o.orderId)).data.paidMinor).toBe(5000);
    expect(
      (
        await R.query(
          scope(),
          orderKey(o).PK,
          K.restaurantPaymentReferencePrefix(),
          "PAYMENT_REFERENCE",
          { limit: 100 },
        )
      ).rows,
    ).toHaveLength(1);
  }
  expect(
    (
      await R.query(
        scope(),
        sessionKey().PK,
        K.restaurantPaymentReferencePrefix(),
        "PAYMENT_REFERENCE",
        { limit: 100 },
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await R.get(
        scope(),
        { PK: pk, SK: K.restaurantPaymentResultSK() },
        "PAYMENT_RESULT",
      )
    )?.data,
  ).toEqual(result.data);
  expect(
    await capture({ ...body, allocations: [...body.allocations].reverse() }),
  ).toEqual(result);
  expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
});
test.each([1, 3, 10])(
  "%s full allocations fit atomic guard with exact bounded write count",
  async (n) => {
    const orders = [order];
    for (let i = 1; i < n; i++) orders.push(await newOrder());
    const body = await input(
      n * 10000,
      "CASH",
      orders.map((o) => ({ orderId: o.orderId, amountMinor: 10000 })),
    );
    m.db.resetHistory();
    await capture(body);
    const actions = m.db.commandCalls(TransactWriteItemsCommand)[0].args[0]
      .input.TransactItems!;
    expect(actions).toHaveLength(5 * n + 14);
    expect(Buffer.byteLength(JSON.stringify(actions))).toBeLessThan(
      3 * 1024 * 1024,
    );
    console.log("PAYMENT_TX_BOUND", {
      allocations: n,
      actions: actions.length,
      bytes: Buffer.byteLength(JSON.stringify(actions)),
    });
  },
);
test.each(["WAITER", "KITCHEN", "INVALID"])(
  "%s cannot capture through handler or service",
  async (role) => {
    await person("denied", role === "INVALID" ? "CASHIER" : role);
    m.seedAccess(org, "denied", role);
    const body = await input();
    m.db.resetHistory();
    expect((await call(body, "denied")).statusCode).toBe(403);
    await expect(capture(body, "denied")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(m.db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  },
);
test.each([
  "unassigned",
  "staff",
  "assignment",
  "membership",
  "product",
  "role",
  "outlet",
])("%s denies capture and old replay after revocation", async (kind) => {
  const body = await input(1000);
  await capture(body);
  if (kind === "staff")
    patchData(SR.staffKey(org, "cashier"), { status: "INACTIVE" });
  if (kind === "assignment")
    patchData(SR.assignmentKeys(org, "cashier", f.outlet.id)[0], {
      status: "INACTIVE",
    });
  if (kind === "unassigned") {
    const k = SR.assignmentKeys(org, "cashier", f.outlet.id)[0];
    m.rows.delete(JSON.stringify([k.PK, k.SK]));
  }
  if (kind === "membership")
    patch(
      { PK: K.orgKey(org), SK: K.orgUserAccessSK("cashier") },
      (raw) => (raw.status = "INACTIVE"),
    );
  if (kind === "product")
    patch(
      { PK: K.orgKey(org), SK: K.productAccessSK("RESTAURANTS") },
      (raw) => (raw.status = "INACTIVE"),
    );
  if (kind === "role") m.seedAccess(org, "cashier", "WAITER");
  if (kind === "outlet")
    patchData(
      { PK: K.orgKey(org), SK: K.restaurantOutletSK(f.outlet.id) },
      { isActive: false },
    );
  const before = new Map(m.rows);
  m.db.resetHistory();
  expect((await call(body)).statusCode).toBe(403);
  expect(m.rows).toEqual(before);
  expect(m.db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});
test.each(["amount", "method", "tender", "reference", "order", "version"])(
  "changed %s under same request identity conflicts",
  async (kind) => {
    const body = await input(4000);
    await capture(body);
    const changed = { ...body, allocations: [...body.allocations] };
    if (kind === "amount")
      changed.allocations = [{ orderId: order.orderId, amountMinor: 3000 }];
    if (kind === "method")
      Object.assign(changed, { method: "CARD", cashTenderedMinor: undefined });
    if (kind === "tender") changed.cashTenderedMinor = 5000;
    if (kind === "reference")
      Object.assign(changed, { externalReference: "changed" });
    if (kind === "order")
      changed.allocations = [{ orderId: id(85000), amountMinor: 4000 }];
    if (kind === "version") changed.expectedVersion++;
    await expect(capture(changed)).rejects.toMatchObject({
      messageCode: "RESTAURANTS_IDEMPOTENCY_CONFLICT",
    });
  },
);
test("ambiguous committed response replays exactly once", async () => {
  const original = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    await original(actions);
    throw new Error("Lost response");
  });
  const body = await input();
  const first = await capture(body);
  expect(await capture(body)).toEqual(first);
  expect(
    (await S.session(scope(), session.guestSessionId)).data.paidMinor,
  ).toBe(10000);
});
test("two concurrent cashiers cannot consume the same final capacity", async () => {
  const body = await input();
  const other = { ...body, clientRequestId: req() };
  const results = await Promise.allSettled([
    capture(body),
    capture(other, "cashier2"),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(
    (await S.session(scope(), session.guestSessionId)).data.paidMinor,
  ).toBe(10000);
});
test("duplicate concurrent retry shares one result and one paid increment", async () => {
  const body = await input();
  const [a, b] = await Promise.all([capture(body), capture(body)]);
  expect(a).toEqual(b);
  expect((await S.order(scope(), order.orderId)).data.paymentAttemptCount).toBe(
    1,
  );
});
test("payment then later submission increases due without rewriting evidence or locking ordering", async () => {
  const body = await input();
  const first = await capture(body);
  const later = await add();
  await submit(later);
  expect((await S.session(scope(), session.guestSessionId)).data).toMatchObject(
    { status: "OPEN", dueMinor: 20000, paidMinor: 10000 },
  );
  expect(await capture(body)).toEqual(first);
});
test("new round winning during capture causes safe conflict, never a lost due increment", async () => {
  const later = await add();
  const body = await input();
  const original = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    await submit(later);
    await original(actions);
  });
  await expect(capture(body)).rejects.toMatchObject({
    messageCode: "RESTAURANTS_WRITE_CONFLICT",
  });
  expect((await S.session(scope(), session.guestSessionId)).data).toMatchObject(
    { dueMinor: 20000, paidMinor: 0 },
  );
  await capture(await input());
  expect((await S.session(scope(), session.guestSessionId)).data).toMatchObject(
    { dueMinor: 20000, paidMinor: 10000 },
  );
});
test("accepted cancellation winning during payment rejects entire stale capture", async () => {
  const body = await input();
  const original = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    const o = await S.order(scope(), order.orderId);
    const l = await S.line(scope(), order.orderId, line.itemId);
    await S.mutate(
      ctx(),
      "CANCEL_ITEM",
      {
        clientRequestId: req(),
        expectedVersion: o.data.version,
        expectedItemVersion: l.data.version,
        reason: "Customer correction",
      },
      { orderId: order.orderId, itemId: line.itemId },
    );
    await original(actions);
  });
  await expect(capture(body)).rejects.toMatchObject({
    messageCode: "RESTAURANTS_WRITE_CONFLICT",
  });
  expect((await S.session(scope(), session.guestSessionId)).data).toMatchObject(
    { dueMinor: 0, paidMinor: 0 },
  );
});
test("capture winning prevents cancellation from reducing due below paid", async () => {
  await capture(await input());
  const o = await S.order(scope(), order.orderId),
    l = await S.line(scope(), order.orderId, line.itemId);
  const before = new Map(m.rows);
  await expect(
    S.mutate(
      ctx(),
      "CANCEL_ITEM",
      {
        clientRequestId: req(),
        expectedVersion: o.data.version,
        expectedItemVersion: l.data.version,
        reason: "Correction",
      },
      { orderId: order.orderId, itemId: line.itemId },
    ),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(m.rows).toEqual(before);
});
test("payment does not bypass close guards for work/drafts; explicit eligible closure is compatible", async () => {
  await capture(await input());
  const o = await S.order(scope(), order.orderId);
  await expect(
    S.mutate(
      ctx(),
      "CLOSE_ORDER",
      { clientRequestId: req(), expectedVersion: o.data.version },
      { orderId: order.orderId },
    ),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect((await S.activeTable(scope(), session.tableId)).data?.status).toBe(
    "OPEN",
  );
});
test("reservations reduce capacity without consumption or changing pending counts", async () => {
  patchData(sessionKey(), { reservedMinor: 6000, pendingPaymentCount: 1 });
  patchData(orderKey(), { reservedMinor: 6000, pendingPaymentCount: 1 });
  await expect(capture(await input(5000))).rejects.toMatchObject({
    statusCode: 409,
  });
  const result = await capture(await input(4000));
  expect(result.data.session).toMatchObject({
    dueMinor: 10000,
    paidMinor: 4000,
    reservedMinor: 6000,
    pendingPaymentCount: 1,
  });
  expect((await S.order(scope(), order.orderId)).data).toMatchObject({
    paidMinor: 4000,
    reservedMinor: 6000,
    pendingPaymentCount: 1,
  });
});
test("unsafe/duplicate/oversized/zero/negative allocations and tender reject before mutation", async () => {
  const base = await input();
  const invalid: unknown[] = [
    { ...base, allocations: [] },
    {
      ...base,
      allocations: Array.from({ length: 11 }, (_, index) => ({
        orderId: id(89000 + index),
        amountMinor: 1,
      })),
    },
    { ...base, allocations: [base.allocations[0], base.allocations[0]] },
    ...[0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1].map((amountMinor) => ({
      ...base,
      allocations: [{ orderId: order.orderId, amountMinor }],
    })),
    {
      ...base,
      allocations: [
        { orderId: order.orderId, amountMinor: Number.MAX_SAFE_INTEGER },
        { orderId: id(1), amountMinor: 1 },
      ],
      cashTenderedMinor: undefined,
    },
    { ...base, cashTenderedMinor: 9999 },
    { ...base, method: "CARD" },
    { ...base, method: "OTHER" },
    { ...base, externalReference: "a".repeat(201) },
  ];
  const before = new Map(m.rows);
  for (const body of invalid) expect((await call(body)).statusCode).toBe(400);
  expect(m.rows).toEqual(before);
});
test("capacity, currency, stale session, zero debt, per-Order cap and invalid ownership reject whole payment", async () => {
  const base = await input();
  for (const body of [
    { ...base, expectedVersion: 1 },
    { ...base, currency: "EUR" },
    {
      ...base,
      allocations: [{ orderId: order.orderId, amountMinor: 10001 }],
      cashTenderedMinor: 10001,
    },
  ])
    expect((await call(body)).statusCode).not.toBe(200);
  expect((await call(base, "cashier", id(86000))).statusCode).toBe(403);
  expect((await call(base, "cashier", f.outlet.id, id(86001))).statusCode).toBe(
    404,
  );
  expect(
    (
      await call(
        base,
        "cashier",
        f.outlet.id,
        session.guestSessionId,
        "foreign",
      )
    ).statusCode,
  ).toBe(403);
  patchData(orderKey(), { paymentAttemptCount: 200 });
  await expect(capture(base)).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_LIMIT",
  });
  patchData(orderKey(), { paymentAttemptCount: 0 });
  await capture(base);
  await expect(capture(await input(1))).rejects.toMatchObject({
    statusCode: 409,
  });
});
test("mixed valid and foreign/non-session allocations fail atomically", async () => {
  const standalone = c.RestaurantOrderSchema.parse(
    (
      await S.mutate(ctx(), "CREATE_ORDER", {
        clientRequestId: req(),
        orderType: "COUNTER",
      })
    ).data,
  );
  for (const foreign of [standalone.orderId, id(87000)]) {
    const body = await input(2, "CASH", [
      { orderId: order.orderId, amountMinor: 1 },
      { orderId: foreign, amountMinor: 1 },
    ]);
    const before = new Map(m.rows);
    await expect(capture(body)).rejects.toMatchObject({ statusCode: 404 });
    expect(m.rows).toEqual(before);
  }
});
test("draft values and preparation reads are not part of capture", async () => {
  await add();
  const body = await input(5000);
  m.db.resetHistory();
  await capture(body);
  expect(m.db.commandCalls(QueryCommand)).toHaveLength(0);
  expect(
    m.db
      .commandCalls(GetItemCommand)
      .some((call) => call.args[0].input.Key?.SK?.S?.startsWith("PREP#")),
  ).toBe(false);
  expect((await S.order(scope(), order.orderId)).data.draftLineCount).toBe(1);
});
test("financial evidence cannot be overwritten/deleted and physical identity is validated", async () => {
  const { data } = await capture(await input());
  const key = {
    PK: K.restaurantPaymentPK(org, f.outlet.id, data.paymentId),
    SK: K.restaurantTransactionMetaSK(),
  };
  const row = (await R.get(scope(), key, "PAYMENT"))!;
  expect(() => R.put(row, row)).toThrow();
  expect(() => R.remove(row)).toThrow();
  patchData(key, { paymentId: id(88000) });
  await expect(R.get(scope(), key, "PAYMENT")).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_INTEGRITY",
  });
});
test("only OWNER/MANAGER/CASHIER receive capture, checkout read never implies writes", () => {
  for (const role of [
    "OWNER",
    "MANAGER",
    "CASHIER",
    "WAITER",
    "KITCHEN",
    "UNKNOWN",
  ])
    expect(
      Auth.permissionsForRestaurantsRole(role).includes(
        "RESTAURANTS_PAYMENT_CAPTURE_MANAGE",
      ),
    ).toBe(["OWNER", "MANAGER", "CASHIER"].includes(role));
  expect(
    Auth.hasPermission(
      ["RESTAURANTS_CHECKOUT_READ"],
      "RESTAURANTS_PAYMENT_CAPTURE_MANAGE",
    ),
  ).toBe(false);
});

test("successful payment followed by service completion and explicit closure freezes evidence; CLOSED owner rejects new capture", async () => {
  const { RestaurantPreparationService: Prep } =
    await import("@/lambda/domains/restaurants/preparation-service");
  const body = await input();
  const result = await capture(body);
  const page = await R.query(
    scope(),
    orderKey().PK,
    K.restaurantPreparationPrefix(),
    "PREPARATION",
    { limit: 100 },
  );
  for (const row of page.rows) {
    if (row.entityType !== "RESTAURANT_PREPARATION")
      throw new Error("Unexpected task");
    let task = row.data;
    for (const command of ["START", "READY", "SERVE"] as const) {
      task = (
        await Prep.transition(
          scope(),
          "owner",
          command,
          { clientRequestId: req(), expectedVersion: task.version },
          { orderId: task.orderId, itemId: task.itemId, fireId: task.fireId },
        )
      ).data;
    }
  }
  const current = await S.order(scope(), order.orderId);
  await S.mutate(
    ctx(),
    "CLOSE_ORDER",
    { clientRequestId: req(), expectedVersion: current.data.version },
    { orderId: order.orderId },
  );
  const currentSession = await S.session(scope(), session.guestSessionId);
  await S.mutate(
    ctx(),
    "CLOSE_SESSION",
    { clientRequestId: req(), expectedVersion: currentSession.data.version },
    { sessionId: session.guestSessionId },
  );
  expect((await S.activeTable(scope(), session.tableId)).data).toBeNull();
  const before = new Map(m.rows);
  await expect(capture(await input(1))).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_STATE",
  });
  expect(m.rows).toEqual(before);
  expect(await capture(body)).toEqual(result); // Replay is original evidence, not a fresh financial mutation.
});

test("concurrent premature session close cannot release occupancy while capture commits", async () => {
  const body = await input();
  const original = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    const owner = await S.session(scope(), session.guestSessionId);
    await expect(
      S.mutate(
        ctx(),
        "CLOSE_SESSION",
        { clientRequestId: req(), expectedVersion: owner.data.version },
        { sessionId: session.guestSessionId },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    await original(actions);
  });
  await capture(body);
  expect((await S.activeTable(scope(), session.tableId)).data?.status).toBe(
    "OPEN",
  );
});

test("authorization revoked between capture read and commit fails the entire guarded transaction", async () => {
  const body = await input();
  const original = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    patchData(SR.assignmentKeys(org, "cashier", f.outlet.id)[0], {
      status: "INACTIVE",
    });
    await original(actions);
  });
  await expect(capture(body)).rejects.toMatchObject({ statusCode: 403 });
  expect(
    (await S.session(scope(), session.guestSessionId)).data.paidMinor,
  ).toBe(0);
  expect(
    [...m.rows.values()]
      .map((raw) => unmarshall(raw))
      .filter((row) => row.entityType === "RESTAURANT_PAYMENT"),
  ).toHaveLength(0);
});

test("mixed sessions/table mismatch, Order currency and individual capacity fail closed without partial effects", async () => {
  const otherSession = c.GuestSessionSchema.parse(
    (
      await S.mutate(ctx(), "OPEN_SESSION", {
        clientRequestId: req(),
        tableId: f.tables[1].id,
        areaId: f.tables[1].serviceAreaId,
      })
    ).data,
  );
  const otherOrder = c.RestaurantOrderSchema.parse(
    (
      await S.mutate(ctx(), "CREATE_ORDER", {
        clientRequestId: req(),
        orderType: "DINE_IN",
        guestSessionId: otherSession.guestSessionId,
      })
    ).data,
  );
  const body = await input(2, "CASH", [
    { orderId: order.orderId, amountMinor: 1 },
    { orderId: otherOrder.orderId, amountMinor: 1 },
  ]);
  await expect(capture(body)).rejects.toMatchObject({ statusCode: 404 });
  patchData(orderKey(), { currency: "EUR" });
  await expect(capture(await input())).rejects.toMatchObject({
    messageCode: "RESTAURANTS_CURRENCY_MISMATCH",
  });
  patchData(orderKey(), { currency: "XOF", tableId: f.tables[1].id });
  await expect(capture(await input())).rejects.toMatchObject({
    statusCode: 404,
  });
  patchData(orderKey(), { tableId: session.tableId, reservedMinor: 9000 });
  await expect(capture(await input(2000))).rejects.toMatchObject({
    statusCode: 409,
  });
  expect(
    (await S.session(scope(), session.guestSessionId)).data.paidMinor,
  ).toBe(0);
});

test("1/3/10 management branches omit only Staff guards and maximum evidence stays far below byte guard", async () => {
  const orders = [order];
  for (let i = 1; i < 10; i++) orders.push(await newOrder());
  for (const n of [1, 3, 10]) {
    const allocations = orders
      .slice(0, n)
      .map((o) => ({ orderId: o.orderId, amountMinor: 1 }));
    const body = {
      ...(await input(n, "CARD", allocations)),
      externalReference: "é".repeat(200),
    };
    m.db.resetHistory();
    await capture(body, "owner");
    const actions = m.db.commandCalls(TransactWriteItemsCommand)[0].args[0]
      .input.TransactItems!;
    expect(actions).toHaveLength(4 * n + 12); // partial payment retains UNPAID membership
    expect(Buffer.byteLength(JSON.stringify(actions))).toBeLessThan(80000);
  }
});

test("cash applied 8000/tender10000 stores change2000, and no cash tender remains permitted as optional evidence", async () => {
  const result = await capture({
    ...(await input(8000)),
    cashTenderedMinor: 10000,
  });
  expect(result.data).toMatchObject({
    appliedAmountMinor: 8000,
    cashTenderedMinor: 10000,
    changeMinor: 2000,
  });
  const body = await input(2000);
  const { cashTenderedMinor: _tender, ...withoutTender } = body;
  expect((await capture(withoutTender)).data).not.toHaveProperty("changeMinor");
});

test("Payment contracts reject key leakage, inconsistent applied sum and cash evidence", async () => {
  const { data } = await capture(await input());
  for (const invalid of [
    { ...data, PK: "forbidden" },
    { ...data, appliedAmountMinor: 9000 },
    { ...data, changeMinor: 1 },
    { ...data, session: { ...data.session, guestSessionId: id(120) } },
  ])
    expect(c.RestaurantPaymentResultSchema.safeParse(invalid).success).toBe(
      false,
    );
  const pk = K.restaurantPaymentPK(org, f.outlet.id, data.paymentId);
  expect(pk).toBe(`ORG#${org}#OUT#${f.outlet.id}#PAY#${data.paymentId}`);
  expect(K.restaurantPaymentAllocationSK(order.orderId)).toBe(
    `ALLOC#${order.orderId}`,
  );
  expect(() =>
    K.restaurantPaymentPK(org, "bad#outlet", data.paymentId),
  ).toThrow();
  const day = data.committedAt.slice(0, 10).replace(/-/g, "");
  expect(
    (
      await R.query(
        scope(),
        K.restaurantTransactionHistoryPK(org, f.outlet.id, "PAY", day),
        "",
        "PAYMENT_REFERENCE",
        { limit: 100 },
      )
    ).rows,
  ).toHaveLength(1);
});

test("allocation pages and session history retain bounded scoped cursors", async () => {
  const orders = [order, await newOrder(), await newOrder()];
  const body = await input(
    3,
    "CARD",
    orders.map((o) => ({ orderId: o.orderId, amountMinor: 1 })),
  );
  const first = await capture(body);
  const pk = K.restaurantPaymentPK(org, f.outlet.id, first.data.paymentId);
  const a = await R.query(
    scope(),
    pk,
    K.restaurantPaymentAllocationPrefix(),
    "PAYMENT_ALLOCATION",
    { limit: 1 },
  );
  expect(a.rows).toHaveLength(1);
  expect(a.nextCursor).toBeDefined();
  const b = await R.query(
    scope(),
    pk,
    K.restaurantPaymentAllocationPrefix(),
    "PAYMENT_ALLOCATION",
    { limit: 1, cursor: a.nextCursor },
  );
  expect(b.rows).toHaveLength(1);
  expect(b.rows[0].SK).not.toBe(a.rows[0].SK);
  const second = await capture(await input(1, "CARD"));
  await expect(
    R.query(
      scope(),
      K.restaurantPaymentPK(org, f.outlet.id, second.data.paymentId),
      K.restaurantPaymentAllocationPrefix(),
      "PAYMENT_ALLOCATION",
      { limit: 1, cursor: a.nextCursor },
    ),
  ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
  const refs = await R.query(
    scope(),
    sessionKey().PK,
    K.restaurantPaymentReferencePrefix(),
    "PAYMENT_REFERENCE",
    { limit: 1 },
  );
  expect(refs.nextCursor).toBeDefined();
  expect(
    (
      await R.query(
        scope(),
        sessionKey().PK,
        K.restaurantPaymentReferencePrefix(),
        "PAYMENT_REFERENCE",
        { limit: 1, cursor: refs.nextCursor },
      )
    ).rows,
  ).toHaveLength(1);
});

test("reusing another actor's payment identity conflicts rather than transferring attribution", async () => {
  const body = await input(1);
  await capture(body);
  await expect(capture(body, "cashier2")).rejects.toMatchObject({
    messageCode: "RESTAURANTS_IDEMPOTENCY_CONFLICT",
  });
  expect(
    (await S.session(scope(), session.guestSessionId)).data.paidMinor,
  ).toBe(1);
});

test("existing paid/reserved debt constrains additional confirmed capacity without consuming reservations", async () => {
  await submit(await add()); // due 20000
  await capture(await input(5000, "CARD"));
  patchData(sessionKey(), { reservedMinor: 10000, pendingPaymentCount: 1 });
  patchData(orderKey(), { reservedMinor: 10000, pendingPaymentCount: 1 });
  await expect(capture(await input(6000))).rejects.toMatchObject({
    statusCode: 409,
  });
  const result = await capture(await input(5000));
  expect(result.data.session).toMatchObject({
    dueMinor: 20000,
    paidMinor: 10000,
    reservedMinor: 10000,
    pendingPaymentCount: 1,
  });
});

test("attempt 200 succeeds once and malformed method summaries fail safely", async () => {
  patchData(orderKey(), { paymentAttemptCount: 199, succeededPaymentCount: 0 });
  const body = await input(1);
  const first = await capture(body);
  expect(await capture(body)).toEqual(first);
  expect((await S.order(scope(), order.orderId)).data).toMatchObject({
    paymentAttemptCount: 200,
    succeededPaymentCount: 1,
  });
  await expect(capture(await input(1))).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_LIMIT",
  });
  patchData(orderKey(), { paymentAttemptCount: 1 });
  patchData(sessionKey(), {
    paidByMethodMinor: { CASH: 2, MOBILE_MONEY: 0, CARD: 0 },
  });
  await expect(capture(await input(1))).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_INTEGRITY",
  });
});

test.each([1, 3, 10])(
  "management %s fully paid allocations have exact 5k+12 actions",
  async (n) => {
    const orders = [order];
    for (let i = 1; i < n; i++) orders.push(await newOrder());
    const body = await input(
      n * 10000,
      "CASH",
      orders.map((o) => ({ orderId: o.orderId, amountMinor: 10000 })),
    );
    m.db.resetHistory();
    await capture(body, "owner");
    expect(
      m.db.commandCalls(TransactWriteItemsCommand)[0].args[0].input
        .TransactItems,
    ).toHaveLength(5 * n + 12);
  },
);
