import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { RestaurantTransactionsService as S } from "@/lambda/domains/restaurants/transaction-service";
import { RestaurantTransactionsRepository as R } from "@/lambda/domains/restaurants/transaction-repository";
import { RestaurantPreparationService as P } from "@/lambda/domains/restaurants/preparation-service";
import { restaurantPreparationHandler } from "@/lambda/domains/restaurants/preparation-handler";
import { RestaurantStaffService as Staff } from "@/lambda/domains/restaurants/staff-service";
import { RestaurantStaffRepository as SR } from "@/lambda/domains/restaurants/staff-repository";
import { RestaurantsService as Config } from "@/lambda/domains/restaurants/restaurant-service";
import { DomainAuthorizationService as Auth } from "@/lambda/shared/services/domain-authorization-service";
import { acceptanceFixture } from "./acceptance-fixture";
import { fixtureId, memoryDynamo } from "./memory-dynamo";
let m: ReturnType<typeof memoryDynamo>,
  f: Awaited<ReturnType<typeof acceptanceFixture>>,
  seq: number;
const org = "org-resto";
const req = () => fixtureId(++seq);
const scope = () => ({ orgId: org, outletId: f.outlet.id });
const ctx = () => ({ ...scope(), actorId: "owner" });
const rows = () => [...m.rows.values()].map((r) => unmarshall(r));
const tasks = () =>
  rows()
    .filter((r) => r.entityType === "RESTAURANT_PREPARATION")
    .map((r) => c.RestaurantPreparationSchema.parse(r.data));
const patch = (
  key: { PK: string; SK: string },
  change: (r: {
    data: {
      status: string;
      version: number;
      isActive: boolean;
      outstandingWorkCount?: number;
      latestFireId?: string;
      fireCount?: number;
    };
    status: string;
    productRoles: { RESTAURANTS: string };
  }) => void,
) => {
  const identity = JSON.stringify([key.PK, key.SK]),
    row = unmarshall(m.rows.get(identity)!);
  change(row as Parameters<typeof change>[0]);
  m.rows.set(identity, marshall(row, { removeUndefinedValues: true }));
};
const ids = (t: c.RestaurantPreparation) => ({
  orderId: t.orderId,
  itemId: t.itemId,
  fireId: t.fireId,
});
async function person(user: string, role: string, assigned = true) {
  m.seedAccess(org, user, role);
  await Staff.mutate(org, "owner", user, "BIND", {
    clientRequestId: req(),
    memberUserId: user,
    operationalLabel: `${user} staff`,
  });
  if (assigned)
    await Staff.mutate(
      org,
      "owner",
      user,
      "ASSIGN",
      { clientRequestId: req() },
      f.outlet.id,
    );
}
async function order() {
  return c.RestaurantOrderSchema.parse(
    (
      await S.mutate(ctx(), "CREATE_ORDER", {
        clientRequestId: req(),
        orderType: "COUNTER",
      })
    ).data,
  );
}
async function add(orderId: string, index = 0) {
  const o = await S.order(ctx(), orderId),
    item = f.items[index];
  return c.RestaurantOrderItemSchema.parse(
    (
      await S.mutate(
        ctx(),
        "ADD_ITEM",
        {
          clientRequestId: req(),
          expectedVersion: o.data.version,
          menuItemId: item.id,
          categoryId: item.categoryId,
          expectedMenuItemVersion: item.version,
          quantity: 1,
        },
        { orderId },
      )
    ).data,
  );
}
async function submit(orderId: string, lines: c.RestaurantOrderItem[]) {
  const o = await S.order(ctx(), orderId),
    input = {
      clientRequestId: req(),
      expectedVersion: o.data.version,
      items: lines.map((l) => ({
        itemId: l.itemId,
        expectedVersion: l.version,
      })),
    };
  const result = await S.mutate(ctx(), "SUBMIT_ORDER", input, { orderId });
  return { input, result };
}
async function queued() {
  const o = await order(),
    l = await add(o.orderId);
  await submit(o.orderId, [l]);
  return tasks()[0];
}
const move = (
  t: c.RestaurantPreparation,
  action: "START" | "READY" | "SERVE",
  actor = action === "SERVE" ? "waiter" : "cook",
  clientRequestId = req(),
) =>
  P.transition(
    scope(),
    actor,
    action,
    { clientRequestId, expectedVersion: t.version },
    ids(t),
  );
function call(
  name: string,
  actor: string,
  t: c.RestaurantPreparation,
  input: object = {},
  overrides: object = {},
) {
  return restaurantPreparationHandler(name)({
    headers: { "x-org-id": org, "accept-language": "en" },
    body: JSON.stringify(input),
    pathParameters: { outletId: f.outlet.id, ...ids(t), ...overrides },
    requestContext: { authorizer: { jwt: { claims: { sub: actor } } } },
  });
}
beforeEach(async () => {
  m = memoryDynamo();
  seq = 24000;
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  f = await acceptanceFixture();
  m.seedAccess(org, "owner", "OWNER");
  m.seedAccess(org, "manager", "MANAGER");
  await person("cook", "KITCHEN");
  await person("waiter", "WAITER");
});
afterEach(() => {
  m.db.restore();
  jest.restoreAllMocks();
});

test("submission atomically creates snapshotted tasks/lanes, replay and later rounds preserve old work", async () => {
  const o = await order(),
    l = await add(o.orderId),
    first = await submit(o.orderId, [l]),
    task = tasks()[0];
  expect(task).toMatchObject({
    orderId: o.orderId,
    itemId: l.itemId,
    state: "QUEUED",
    generation: 1,
    name: f.items[0].name,
    stationId: f.items[0].preparationStationId,
  });
  expect(
    c.RestaurantOrderSchema.parse(first.result.data).outstandingWorkCount,
  ).toBe(1);
  const snapshot = (await S.line(ctx(), o.orderId, l.itemId)).data.snapshot;
  expect(task.submissionId).toBe(snapshot!.submissionId);
  const size = rows().length;
  expect(
    await S.mutate(ctx(), "SUBMIT_ORDER", first.input, { orderId: o.orderId }),
  ).toEqual(first.result);
  expect(rows()).toHaveLength(size);
  const l2 = await add(o.orderId, 1);
  await submit(o.orderId, [l2]);
  expect(tasks()).toHaveLength(2);
  expect(tasks().find((t) => t.fireId === task.fireId)).toEqual(task);
  expect(
    m.transactions.some(
      (tx) =>
        tx.TransactItems?.some(
          (a) => a.Put?.Item?.entityType?.S === "RESTAURANT_PREPARATION",
        ) &&
        tx.TransactItems.some(
          (a) => a.Put?.Item?.entityType?.S === "RESTAURANT_SUBMISSION",
        ),
    ),
  ).toBe(true);
  expect((await S.line(ctx(), o.orderId, l.itemId)).data.snapshot).toEqual(
    snapshot,
  );
});
test("no-station items create no preparation work", async () => {
  const o = await order(),
    index = f.items.findIndex((i) => !i.preparationStationId);
  expect(index).toBeGreaterThanOrEqual(0);
  await submit(o.orderId, [await add(o.orderId, index)]);
  expect(tasks()).toHaveLength(0);
  expect((await S.order(ctx(), o.orderId)).data.outstandingWorkCount).toBe(0);
});
test("queue movement, terminal counter and commercial totals remain independent", async () => {
  let t = await queued();
  const before = (await S.order(ctx(), t.orderId)).data;
  for (const [action, state] of [
    ["START", "IN_PROGRESS"],
    ["READY", "READY"],
    ["SERVE", "SERVED"],
  ] as const) {
    t = (await move(t, action)).data;
    expect(t.state).toBe(state);
    const lanes = rows().filter(
      (r) => r.entityType === "RESTAURANT_PREPARATION_WORK",
    );
    expect(lanes).toHaveLength(state === "SERVED" ? 0 : 1);
  }
  const after = (await S.order(ctx(), t.orderId)).data;
  expect(after.outstandingWorkCount).toBe(0);
  expect(after.dueMinor).toBe(before.dueMinor);
  expect(after.financialRevision).toBe(before.financialRevision);
  await expect(move(t, "SERVE")).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_STATE",
  });
});
test("start/ready/serve replay returns original result and changed intent conflicts", async () => {
  let t = await queued();
  for (const action of ["START", "READY", "SERVE"] as const) {
    const id = req(),
      original = t,
      result = await move(
        t,
        action,
        action === "SERVE" ? "waiter" : "cook",
        id,
      );
    expect(
      await move(original, action, action === "SERVE" ? "waiter" : "cook", id),
    ).toEqual(result);
    await expect(
      move(
        { ...original, version: 999 },
        action,
        action === "SERVE" ? "waiter" : "cook",
        id,
      ),
    ).rejects.toMatchObject({
      messageCode: "RESTAURANTS_IDEMPOTENCY_CONFLICT",
    });
    t = result.data;
  }
});
test("invalid transition and stale version fail without writes", async () => {
  const t = await queued(),
    size = rows().length;
  await expect(move(t, "READY")).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_STATE",
  });
  await expect(move({ ...t, version: 99 }, "START")).rejects.toMatchObject({
    messageCode: "RESTAURANTS_WRITE_CONFLICT",
  });
  expect(rows()).toHaveLength(size);
});
test.each(["owner", "manager", "cook"])(
  "%s reads station/order work and starts through handlers",
  async (actor) => {
    const t = await queued();
    expect(
      (
        await call("start-preparation", actor, t, {
          clientRequestId: req(),
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await P.read(
          scope(),
          actor,
          { limit: 1 },
          { stationId: t.stationId, state: "IN_PROGRESS" },
        )
      ).items,
    ).toHaveLength(1);
    expect(
      (await P.read(scope(), actor, { limit: 1 }, { orderId: t.orderId }))
        .items,
    ).toHaveLength(1);
  },
);
test.each(["waiter", "cashier", "missing"])(
  "%s cannot start or read kitchen lanes",
  async (actor) => {
    if (actor !== "waiter")
      m.seedAccess(org, actor, actor === "cashier" ? "CASHIER" : "invalid");
    const t = await queued();
    expect(
      (
        await call("start-preparation", actor, t, {
          clientRequestId: req(),
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(403);
    await expect(
      P.read(
        scope(),
        actor,
        { limit: 1 },
        { stationId: t.stationId, state: "QUEUED" },
      ),
    ).rejects.toBeDefined();
  },
);
test("KITCHEN cannot serve; WAITER cannot start/ready or gain broad transactions", async () => {
  const t = await queued();
  expect(
    (
      await call("serve-preparation", "cook", t, {
        clientRequestId: req(),
        expectedVersion: 1,
      })
    ).statusCode,
  ).toBe(403);
  expect(Auth.permissionsForRestaurantsRole("KITCHEN")).not.toContain(
    "RESTAURANTS_SERVICE_ORDER_READ",
  );
  expect(Auth.permissionsForRestaurantsRole("WAITER")).not.toContain(
    "RESTAURANTS_PREPARATION_READ",
  );
  expect(Auth.permissionsForRestaurantsRole("WAITER")).not.toContain(
    "RESTAURANTS_ORDER_CANCEL_MANAGE",
  );
});
test.each(["staff", "assignment", "membership", "product", "role", "outlet"])(
  "%s revocation rejects command and replay before writes",
  async (kind) => {
    const t = await queued(),
      id = req();
    await move(t, "START", "cook", id);
    const size = rows().length;
    if (kind === "staff")
      patch(SR.staffKey(org, "cook"), (r) => (r.data.status = "INACTIVE"));
    if (kind === "assignment")
      patch(
        SR.assignmentKeys(org, "cook", f.outlet.id)[0],
        (r) => (r.data.status = "INACTIVE"),
      );
    if (kind === "membership")
      patch(
        { PK: K.orgKey(org), SK: K.orgUserAccessSK("cook") },
        (r) => (r.status = "INACTIVE"),
      );
    if (kind === "role")
      patch(
        { PK: K.orgKey(org), SK: K.orgUserAccessSK("cook") },
        (r) => (r.productRoles.RESTAURANTS = "CASHIER"),
      );
    if (kind === "product")
      patch(
        { PK: K.orgKey(org), SK: K.productAccessSK("RESTAURANTS") },
        (r) => (r.status = "INACTIVE"),
      );
    if (kind === "outlet")
      patch(
        { PK: K.orgKey(org), SK: K.restaurantOutletSK(f.outlet.id) },
        (r) => (r.data.isActive = false),
      );
    await expect(move(t, "START", "cook", id)).rejects.toBeDefined();
    expect(rows()).toHaveLength(size);
  },
);
test("unassigned kitchen, foreign tenant/outlet/station and alien cursors fail closed", async () => {
  await person("unassigned", "KITCHEN", false);
  const t = await queued();
  expect(
    (
      await call("start-preparation", "unassigned", t, {
        clientRequestId: req(),
        expectedVersion: 1,
      })
    ).statusCode,
  ).toBe(403);
  await expect(
    P.read(
      { ...scope(), outletId: fixtureId(999) },
      "cook",
      { limit: 1 },
      { stationId: t.stationId, state: "QUEUED" },
    ),
  ).rejects.toBeDefined();
  await expect(
    P.read(
      { ...scope(), orgId: "foreign" },
      "cook",
      { limit: 1 },
      { stationId: t.stationId, state: "QUEUED" },
    ),
  ).rejects.toBeDefined();
  await expect(
    P.read(
      scope(),
      "cook",
      { limit: 1 },
      { stationId: fixtureId(999), state: "QUEUED" },
    ),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_NOT_FOUND" });
  await submit(t.orderId, [await add(t.orderId)]);
  const page = await P.read(
    scope(),
    "cook",
    { limit: 1 },
    { stationId: t.stationId, state: "QUEUED" },
  );
  expect(page.nextCursor).toBeDefined();
  expect(
    (
      await P.read(
        scope(),
        "cook",
        { limit: 1, cursor: page.nextCursor },
        { stationId: t.stationId, state: "QUEUED" },
      )
    ).items,
  ).toHaveLength(1);
  await expect(
    P.read(
      scope(),
      "cook",
      { limit: 1, cursor: page.nextCursor },
      { stationId: t.stationId, state: "READY" },
    ),
  ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
  const orders = await P.read(
    scope(),
    "cook",
    { limit: 1 },
    { orderId: t.orderId },
  );
  expect(orders.nextCursor).toBeDefined();
  expect(
    (
      await P.read(
        scope(),
        "cook",
        { limit: 1, cursor: orders.nextCursor },
        { orderId: t.orderId },
      )
    ).items,
  ).toHaveLength(1);
  expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
  expect(
    m.db.commandCalls(QueryCommand).every((c) => c.args[0].input.Limit! <= 100),
  ).toBe(true);
});
test("station deactivation preserves old routing/operations and rejects new acceptance", async () => {
  const t = await queued();
  await Config.update(
    org,
    "owner",
    "station",
    { outletId: f.outlet.id },
    t.stationId,
    { expectedVersion: t.stationVersion },
    "deactivate",
  );
  expect(
    (
      await P.read(
        scope(),
        "cook",
        { limit: 1 },
        { stationId: t.stationId, state: "QUEUED" },
      )
    ).items[0].stationId,
  ).toBe(t.stationId);
  expect((await move(t, "START")).data.state).toBe("IN_PROGRESS");
  const line = await add(t.orderId);
  await expect(submit(t.orderId, [line])).rejects.toBeDefined();
  expect(tasks()).toHaveLength(1);
});
test.each(["QUEUED", "IN_PROGRESS", "READY"])(
  "management cancellation terminalizes %s task and preserves immutable sale",
  async (state) => {
    let t = await queued();
    if (state !== "QUEUED") t = (await move(t, "START")).data;
    if (state === "READY") t = (await move(t, "READY")).data;
    const line = await S.line(ctx(), t.orderId, t.itemId),
      o = await S.order(ctx(), t.orderId);
    await S.mutate(
      ctx(),
      "CANCEL_ITEM",
      {
        clientRequestId: req(),
        expectedVersion: o.data.version,
        expectedItemVersion: line.data.version,
        reason: "Correction",
      },
      { orderId: t.orderId, itemId: t.itemId },
    );
    expect(tasks()[0].state).toBe("CANCELLED");
    expect(
      rows().filter((r) => r.entityType === "RESTAURANT_PREPARATION_WORK"),
    ).toHaveLength(0);
    expect((await S.order(ctx(), t.orderId)).data.outstandingWorkCount).toBe(0);
    expect((await S.line(ctx(), t.orderId, t.itemId)).data.snapshot).toEqual(
      line.data.snapshot,
    );
  },
);
test("two actors starting same version have one winner", async () => {
  const t = await queued();
  const result = await Promise.allSettled([
    move(t, "START"),
    move(t, "START", "manager"),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(tasks()[0].version).toBe(2);
  expect(
    rows().filter((r) => r.entityType === "RESTAURANT_PREPARATION_WORK"),
  ).toHaveLength(1);
});

test.each(["QUEUED", "IN_PROGRESS"])(
  "task transition racing sale cancellation at %s commits one outcome",
  async (state) => {
    let t = await queued();
    if (state === "IN_PROGRESS") t = (await move(t, "START")).data;
    const o = await S.order(ctx(), t.orderId),
      l = await S.line(ctx(), t.orderId, t.itemId);
    const result = await Promise.allSettled([
      move(t, state === "QUEUED" ? "START" : "READY"),
      S.mutate(
        ctx(),
        "CANCEL_ITEM",
        {
          clientRequestId: req(),
          expectedVersion: o.data.version,
          expectedItemVersion: l.data.version,
          reason: "Correction",
        },
        { orderId: t.orderId, itemId: t.itemId },
      ),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const current = tasks()[0],
      lanes = rows().filter(
        (r) => r.entityType === "RESTAURANT_PREPARATION_WORK",
      );
    expect(lanes).toHaveLength(current.state === "CANCELLED" ? 0 : 1);
    expect((await S.order(ctx(), t.orderId)).data.outstandingWorkCount).toBe(
      current.state === "CANCELLED" ? 0 : 1,
    );
  },
);
test("ready/serve racing the predecessor and duplicate serve never double-decrement", async () => {
  let t = (await move(await queued(), "START")).data;
  const early = await Promise.allSettled([move(t, "READY"), move(t, "SERVE")]);
  expect(early.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  t = tasks()[0];
  const result = await Promise.allSettled([
    move(t, "SERVE"),
    move(t, "SERVE", "manager"),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await S.order(ctx(), t.orderId)).data.outstandingWorkCount).toBe(0);
});
test("parent lifecycle change between preparation read and commit fails atomically", async () => {
  const t = await queued(),
    commit = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    patch(
      { PK: K.restaurantOrderPK(org, f.outlet.id, t.orderId), SK: "META" },
      (r) => {
        r.data.status = "CANCELLED";
        r.data.version++;
      },
    );
    return commit(actions);
  });
  await expect(move(t, "START")).rejects.toMatchObject({
    messageCode: "RESTAURANTS_WRITE_CONFLICT",
  });
  expect(tasks()[0].state).toBe("QUEUED");
});
test("frozen station routing survives menu reassignment for later rounds", async () => {
  const t = await queued(),
    item = f.items[0],
    other = f.stations.find((st) => st.id !== t.stationId)!;
  const updated = await Config.update(
    org,
    "owner",
    "item",
    { outletId: f.outlet.id, categoryId: item.categoryId },
    item.id,
    { expectedVersion: item.version, preparationStationId: other.id },
  );
  f.items[0] = updated;
  await submit(t.orderId, [await add(t.orderId)]);
  expect(tasks().find((x) => x.fireId === t.fireId)?.stationId).toBe(
    t.stationId,
  );
  expect(tasks().find((x) => x.fireId !== t.fireId)?.stationId).toBe(other.id);
});
test("pre-feature accepted lines remain unqueued and cannot be fabricated through reads", async () => {
  const o = await order(),
    l = await add(o.orderId);
  await submit(o.orderId, [l]);
  for (const [key, raw] of m.rows) {
    const row = unmarshall(raw);
    if (
      ["RESTAURANT_PREPARATION", "RESTAURANT_PREPARATION_WORK"].includes(
        row.entityType,
      )
    )
      m.rows.delete(key);
  }
  patch(
    { PK: K.restaurantOrderPK(org, f.outlet.id, o.orderId), SK: "META" },
    (r) => delete r.data.outstandingWorkCount,
  );
  patch(
    {
      PK: K.restaurantOrderPK(org, f.outlet.id, o.orderId),
      SK: K.restaurantOrderItemSK(l.itemId),
    },
    (r) => {
      delete r.data.latestFireId;
      delete r.data.fireCount;
    },
  );
  expect(
    (await P.read(scope(), "cook", { limit: 50 }, { orderId: o.orderId }))
      .items,
  ).toHaveLength(0);
  expect(tasks()).toHaveLength(0);
});
test("public preparation contracts reject physical keys and arbitrary state mutations", async () => {
  const t = await queued();
  expect(
    c.RestaurantPreparationSchema.safeParse({ ...t, PK: "internal" }).success,
  ).toBe(false);
  expect(
    c.PreparationTransitionRequestSchema.safeParse({
      clientRequestId: req(),
      expectedVersion: 1,
      state: "READY",
    }).success,
  ).toBe(false);
});
test("handler validates queue and task parent context and permits only service role to serve", async () => {
  let t = (await move(await queued(), "START")).data;
  t = (await move(t, "READY")).data;
  const read = await restaurantPreparationHandler("station-preparation")({
    headers: { "x-org-id": org },
    pathParameters: {
      outletId: f.outlet.id,
      stationId: t.stationId,
      state: "READY",
    },
    queryStringParameters: { limit: "1" },
    requestContext: { authorizer: { jwt: { claims: { sub: "cook" } } } },
  });
  expect(read.statusCode).toBe(200);
  expect(
    (
      await call("serve-preparation", "waiter", t, {
        clientRequestId: req(),
        expectedVersion: t.version,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await call(
        "start-preparation",
        "cook",
        t,
        { clientRequestId: req(), expectedVersion: 1 },
        { orderId: fixtureId(999) },
      )
    ).statusCode,
  ).toBe(404);
});
test("ambiguous successful commit replays once and authorization is rechecked", async () => {
  const t = await queued(),
    commit = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    await commit(actions);
    throw new Error("Transport interrupted");
  });
  const result = await move(t, "START");
  expect(result.data.version).toBe(2);
  expect(tasks()).toHaveLength(1);
});
test("authorization revocation between read and commit rolls back all operational writes", async () => {
  const t = await queued(),
    commit = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    patch(SR.assignmentKeys(org, "cook", f.outlet.id)[0], (r) => {
      r.data.status = "INACTIVE";
      r.data.version++;
    });
    return commit(actions);
  });
  await expect(move(t, "START")).rejects.toBeDefined();
  expect(tasks()[0].state).toBe("QUEUED");
});
