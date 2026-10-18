import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  BatchGetItemCommand,
  BatchGetItemCommandInput,
  GetItemCommand,
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
async function order(
  orderType: "DINE_IN" | "TAKEAWAY" | "COUNTER" = "COUNTER",
  guestSessionId?: string,
) {
  return c.RestaurantOrderSchema.parse(
    (
      await S.mutate(ctx(), "CREATE_ORDER", {
        clientRequestId: req(),
        orderType,
        ...(guestSessionId ? { guestSessionId } : {}),
      })
    ).data,
  );
}
async function add(orderId: string, index = 0, notes?: string) {
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
          ...(notes ? { notes } : {}),
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

// PREP-1B: composition is read-only; existing task/command schemas stay unchanged.
async function tableVisit() {
  const table = f.tables[0];
  const renamed = await Config.update(
    org,
    "owner",
    "table",
    { outletId: f.outlet.id, serviceAreaId: table.serviceAreaId },
    table.id,
    { expectedVersion: table.version, name: "Terrasse jardin" },
  );
  f.tables[0] = renamed;
  return c.GuestSessionSchema.parse(
    (
      await S.mutate(ctx(), "OPEN_SESSION", {
        clientRequestId: req(),
        tableId: table.id,
        areaId: table.serviceAreaId,
      })
    ).data,
  );
}
const queueRead = (stationId: string, input: object = {}) =>
  P.read(scope(), "cook", input, { stationId, state: "QUEUED" });
const rawPatch = (
  key: { PK: string; SK: string },
  change: (
    data: Record<string, unknown> & { data: Record<string, unknown> },
  ) => void,
) => {
  const identity = JSON.stringify([key.PK, key.SK]);
  const raw = unmarshall(m.rows.get(identity)!);
  change(raw as Record<string, unknown> & { data: Record<string, unknown> });
  m.rows.set(identity, marshall(raw, { removeUndefinedValues: true }));
};
const orderKey = (id: string) => ({
  PK: K.restaurantOrderPK(org, f.outlet.id, id),
  SK: K.restaurantTransactionMetaSK(),
});
const sessionKey = (id: string) => ({
  PK: K.restaurantSessionPK(org, f.outlet.id, id),
  SK: K.restaurantTransactionMetaSK(),
});

test("PREP-1B mixed service contexts use the session name snapshot, preserve accepted data, and never expose table code/IDs", async () => {
  const session = await tableVisit();
  for (const mode of ["DINE_IN", "TAKEAWAY", "COUNTER"] as const) {
    const o = await order(
      mode,
      mode === "DINE_IN" ? session.guestSessionId : undefined,
    );
    await submit(o.orderId, [await add(o.orderId, 0, "Sans piment")]);
  }
  const before = tasks();
  await Config.update(
    org,
    "owner",
    "table",
    { outletId: f.outlet.id, serviceAreaId: f.tables[0].serviceAreaId },
    f.tables[0].id,
    { expectedVersion: f.tables[0].version, name: "Nouveau nom" },
  );
  const page = await queueRead(before[0].stationId);
  expect(page.items.map((item) => item.serviceContext)).toEqual(
    expect.arrayContaining([
      { mode: "DINE_IN", tableName: "Terrasse jardin" },
      { mode: "TAKEAWAY" },
      { mode: "COUNTER" },
    ]),
  );
  for (const item of page.items) {
    const { serviceContext, ...task } = item;
    expect(task).toEqual(before.find((t) => t.fireId === item.fireId));
    expect(task.notes).toBe("Sans piment");
    expect(serviceContext).not.toHaveProperty("tableCode");
    expect(serviceContext).not.toHaveProperty("tableId");
  }
  expect(tasks()).toEqual(before);
  expect(c.PreparationListResponseSchema.parse(page)).toEqual(page);
});

test("PREP-1B deduplicates 50 tasks from 8 Orders and 4 sessions into three bounded batches", async () => {
  const visit = await tableVisit();
  // Additional canonical visits on the remaining configured tables.
  const sessions = [visit];
  for (const table of f.tables.slice(1))
    sessions.push(
      c.GuestSessionSchema.parse(
        (
          await S.mutate(ctx(), "OPEN_SESSION", {
            clientRequestId: req(),
            tableId: table.id,
            areaId: table.serviceAreaId,
          })
        ).data,
      ),
    );
  for (let i = 0; i < 8; i++) {
    const o = await order("DINE_IN", sessions[i % 4].guestSessionId);
    const lines = [];
    for (let j = 0; j < (i < 2 ? 7 : 6); j++) lines.push(await add(o.orderId));
    await submit(o.orderId, lines);
  }
  const station = tasks()[0].stationId;
  m.db.resetHistory();
  const page = await queueRead(station, { limit: 100 });
  expect(page.items).toHaveLength(50);
  const batches = m.db
    .commandCalls(BatchGetItemCommand)
    .map((call) => Object.values(call.args[0].input.RequestItems!)[0].Keys!);
  expect(batches.map((keys) => keys.length)).toEqual([50, 8, 4]);
  expect(m.db.commandCalls(QueryCommand)).toHaveLength(1);
  // Fixed authorization/configuration reads, never one Get per task/Order/session.
  expect(m.db.commandCalls(GetItemCommand)).toHaveLength(8);
  expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
});

test("PREP-1B order preparation reuses the authorized parent and preserves closed-session context", async () => {
  const session = await tableVisit();
  const o = await order("DINE_IN", session.guestSessionId);
  await submit(o.orderId, [await add(o.orderId)]);
  rawPatch(sessionKey(session.guestSessionId), (raw) => {
    raw.data.status = "CLOSED";
    raw.data.closedAt = new Date().toISOString();
    raw.data.closedBy = "owner";
    raw.data.openOrderCount = 0;
    raw.data.paidMinor = raw.data.dueMinor;
  });
  m.db.resetHistory();
  const page = await P.read(scope(), "cook", {}, { orderId: o.orderId });
  expect(page.items[0].serviceContext).toEqual({
    mode: "DINE_IN",
    tableName: "Terrasse jardin",
  });
  expect(m.db.commandCalls(BatchGetItemCommand)).toHaveLength(1);
  const keys = Object.values(
    m.db.commandCalls(BatchGetItemCommand)[0].args[0].input.RequestItems!,
  )[0].Keys!;
  expect(keys).toHaveLength(1);
  expect(keys[0].PK.S).toBe(sessionKey(session.guestSessionId).PK);
  expect(m.db.commandCalls(QueryCommand)).toHaveLength(1);
});

test.each([
  "missing Order",
  "missing session",
  "foreign Order",
  "foreign session",
  "wrong table",
  "blank name",
])(
  "PREP-1B %s fails safely without a technical identity fallback",
  async (problem) => {
    const session = await tableVisit();
    const o = await order("DINE_IN", session.guestSessionId);
    await submit(o.orderId, [await add(o.orderId)]);
    const task = tasks()[0];
    if (problem === "missing Order")
      m.rows.delete(JSON.stringify(Object.values(orderKey(o.orderId))));
    if (problem === "missing session")
      m.rows.delete(
        JSON.stringify(Object.values(sessionKey(session.guestSessionId))),
      );
    if (problem === "foreign Order")
      rawPatch(orderKey(o.orderId), (raw) => {
        raw.data.outletId = fixtureId(99001);
      });
    if (problem === "foreign session")
      rawPatch(sessionKey(session.guestSessionId), (raw) => {
        raw.orgId = "foreign";
        raw.data.orgId = "foreign";
      });
    if (problem === "wrong table")
      rawPatch(orderKey(o.orderId), (raw) => {
        raw.data.tableId = fixtureId(99002);
      });
    if (problem === "blank name")
      rawPatch(sessionKey(session.guestSessionId), (raw) => {
        raw.data.tableName = "  ";
      });
    await expect(queueRead(task.stationId)).rejects.toMatchObject({
      messageCode: "RESTAURANTS_TRANSACTION_INTEGRITY",
    });
  },
);

test("PREP-1B cursor pages preserve per-task context and empty pages add no parent batches", async () => {
  const visit = await tableVisit();
  const a = await order("DINE_IN", visit.guestSessionId);
  await submit(a.orderId, [await add(a.orderId)]);
  const b = await order("TAKEAWAY");
  await submit(b.orderId, [await add(b.orderId)]);
  const first = await queueRead(tasks()[0].stationId, { limit: 1 });
  expect(first.nextCursor).toBeDefined();
  const second = await queueRead(tasks()[0].stationId, {
    limit: 1,
    cursor: first.nextCursor,
  });
  expect(second.nextCursor).toBeUndefined();
  expect(
    new Set(
      [...first.items, ...second.items].map((t) => t.serviceContext.mode),
    ),
  ).toEqual(new Set(["DINE_IN", "TAKEAWAY"]));
  m.db.resetHistory();
  const empty = await P.read(
    scope(),
    "cook",
    {},
    { stationId: tasks()[0].stationId, state: "READY" },
  );
  expect(empty.items).toEqual([]);
  expect(m.db.commandCalls(BatchGetItemCommand)).toHaveLength(0);
});

test("PREP-1B parent BatchGet retries response-size/unprocessed subsets and caps retries", async () => {
  const visit = await tableVisit();
  const o = await order("DINE_IN", visit.guestSessionId);
  await submit(o.orderId, [await add(o.orderId)]);
  const t = tasks()[0];
  let orderCalls = 0;
  m.db.on(BatchGetItemCommand).callsFake(async (input) => {
    const [table, request] = Object.entries(
      (input as BatchGetItemCommandInput).RequestItems!,
    )[0];
    const keys = request.Keys!;
    const isOrder = keys[0].PK.S!.includes("#ORD#") && keys[0].SK.S === "META";
    if (isOrder && ++orderCalls === 1)
      return { UnprocessedKeys: input.RequestItems };
    return {
      Responses: {
        [table]: keys.flatMap((key) => {
          const row = m.rows.get(JSON.stringify([key.PK.S, key.SK.S]));
          return row ? [row] : [];
        }),
      },
    };
  });
  expect((await queueRead(t.stationId)).items[0].serviceContext.mode).toBe(
    "DINE_IN",
  );
  expect(orderCalls).toBe(2);
  let calls = 0;
  m.db.on(BatchGetItemCommand).callsFake(async (input) => {
    const keys = Object.values(
      (input as BatchGetItemCommandInput).RequestItems!,
    )[0].Keys!;
    if (keys[0].SK.S === "META") {
      calls++;
      return { UnprocessedKeys: input.RequestItems };
    }
    const table = Object.keys(input.RequestItems!)[0];
    return {
      Responses: {
        [table]: keys.map(
          (key) => m.rows.get(JSON.stringify([key.PK.S, key.SK.S]))!,
        ),
      },
    };
  });
  await expect(queueRead(t.stationId)).rejects.toMatchObject({
    statusCode: 503,
  });
  expect(calls).toBe(3);
});

test("PREP-1B KITCHEN reads context through Preparation but still cannot read Orders or sessions", async () => {
  const t = await queued();
  m.db.resetHistory();
  const response = await restaurantPreparationHandler("station-preparation")({
    headers: { "x-org-id": org },
    pathParameters: {
      outletId: f.outlet.id,
      stationId: t.stationId,
      state: "QUEUED",
    },
    requestContext: { authorizer: { jwt: { claims: { sub: "cook" } } } },
  });
  expect(response.statusCode).toBe(200);
  expect(m.db.commandCalls(GetItemCommand)).toHaveLength(10);
  expect(JSON.parse(response.body).items[0].serviceContext).toEqual({
    mode: "COUNTER",
  });
  const { restaurantTransactionHandler } =
    await import("@/lambda/domains/restaurants/transaction-handler");
  for (const name of ["get-order", "get-session"]) {
    const denied = await restaurantTransactionHandler(name)({
      headers: { "x-org-id": org },
      pathParameters: {
        outletId: f.outlet.id,
        ...(name === "get-order"
          ? { orderId: t.orderId }
          : { sessionId: fixtureId(99999) }),
      },
      requestContext: { authorizer: { jwt: { claims: { sub: "cook" } } } },
    });
    expect(denied.statusCode).toBe(403);
  }
  expect(Auth.permissionsForRestaurantsRole("KITCHEN")).not.toContain(
    "RESTAURANTS_SERVICE_ORDER_READ",
  );
  expect(Auth.permissionsForRestaurantsRole("KITCHEN")).not.toContain(
    "RESTAURANTS_SERVICE_SESSION_READ",
  );
});

test("PREP-1B maximum queue page hydrates 100 distinct Orders and sessions in bounded batches", async () => {
  const visit = await tableVisit();
  const parent = await order("DINE_IN", visit.guestSessionId);
  await submit(parent.orderId, [await add(parent.orderId)]);
  const template = tasks()[0];
  const originalOrder = c.RestaurantOrderSchema.parse(
    (await S.order(ctx(), parent.orderId)).data,
  );
  const originalSession = c.GuestSessionSchema.parse(
    (await R.get(scope(), sessionKey(visit.guestSessionId), "SESSION"))!.data,
  );
  for (const [key, raw] of m.rows) {
    if (
      ["RESTAURANT_PREPARATION", "RESTAURANT_PREPARATION_WORK"].includes(
        raw.entityType.S!,
      )
    )
      m.rows.delete(key);
  }
  const seed = (row: ReturnType<typeof R.row>) =>
    m.rows.set(JSON.stringify([row.PK, row.SK]), marshall(row));
  for (let index = 0; index < 100; index++) {
    const orderId = fixtureId(80000 + index),
      guestSessionId = fixtureId(81000 + index);
    seed(
      R.row(scope(), orderKey(orderId), "ORDER", {
        ...originalOrder,
        orderId,
        guestSessionId,
      }),
    );
    seed(
      R.row(scope(), sessionKey(guestSessionId), "SESSION", {
        ...originalSession,
        guestSessionId,
      }),
    );
    const task = { ...template, orderId };
    seed(
      R.row(
        scope(),
        {
          PK: orderKey(orderId).PK,
          SK: K.restaurantPreparationSK(task.itemId, task.fireId),
        },
        "PREPARATION",
        task,
      ),
    );
    seed(P.queueRow(scope(), task));
  }
  m.db.resetHistory();
  const page = await queueRead(template.stationId, { limit: 100 });
  expect(page.items).toHaveLength(100);
  expect(
    page.items.every(
      (item) =>
        item.serviceContext.mode === "DINE_IN" &&
        item.serviceContext.tableName === "Terrasse jardin",
    ),
  ).toBe(true);
  expect(
    m.db
      .commandCalls(BatchGetItemCommand)
      .map(
        (call) =>
          Object.values(call.args[0].input.RequestItems!)[0].Keys!.length,
      ),
  ).toEqual([100, 100, 100]);
  expect(m.db.commandCalls(QueryCommand)).toHaveLength(1);
});

test("PREP-1B strict context contract rejects table data for non-table modes", () => {
  expect(c.PreparationServiceContextSchema.parse({ mode: "TAKEAWAY" })).toEqual(
    { mode: "TAKEAWAY" },
  );
  for (const invalid of [
    { mode: "DINE_IN" },
    { mode: "DINE_IN", tableName: " " },
    { mode: "COUNTER", tableName: "Fake table" },
    { mode: "TAKEAWAY", tableId: fixtureId(1) },
    { mode: "DELIVERY" },
    { mode: "DINE_IN", tableName: "Terrasse", tableCode: "TC" },
  ])
    expect(c.PreparationServiceContextSchema.safeParse(invalid).success).toBe(
      false,
    );
});
