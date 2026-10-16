import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { RestaurantTransactionsRepository as R } from "@/lambda/domains/restaurants/transaction-repository";
import { DomainAuthorizationService as Auth } from "@/lambda/shared/services/domain-authorization-service";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { RestaurantTransactionsService as S } from "@/lambda/domains/restaurants/transaction-service";
import { RestaurantStaffService as Staff } from "@/lambda/domains/restaurants/staff-service";
import { RestaurantStaffRepository as SR } from "@/lambda/domains/restaurants/staff-repository";
import { RestaurantsService as Config } from "@/lambda/domains/restaurants/restaurant-service";
import { restaurantTransactionHandler } from "@/lambda/domains/restaurants/transaction-handler";
import { RESTAURANT_TRANSACTION_ROUTES } from "@/lambda/domains/restaurants/transaction-routes";
import { acceptanceFixture } from "./acceptance-fixture";
import { memoryDynamo, fixtureId } from "./memory-dynamo";
const org = "org-resto";
let m: ReturnType<typeof memoryDynamo>,
  f: Awaited<ReturnType<typeof acceptanceFixture>>,
  session: c.GuestSessionRead,
  order: c.RestaurantOrder,
  seq: number;
const request = () => fixtureId(++seq);
const scope = () => ({ orgId: org, outletId: f.outlet.id, actorId: "owner" });
function call(
  name: string,
  actor = "Aissa",
  body: object = {},
  ids: object = {},
  query: object = {},
  outletId = f.outlet.id,
  tenant = org,
) {
  return restaurantTransactionHandler(name)({
    headers: { "x-org-id": tenant, "accept-language": "en" },
    body: JSON.stringify(body),
    pathParameters: { outletId, ...ids },
    queryStringParameters: query,
    requestContext: { authorizer: { jwt: { claims: { sub: actor } } } },
  });
}
function patch(
  key: { PK: string; SK: string },
  changes: Record<string, unknown>,
) {
  const old = unmarshall(m.rows.get(JSON.stringify([key.PK, key.SK]))!);
  m.rows.set(
    JSON.stringify([key.PK, key.SK]),
    marshall({ ...old, ...changes }, { removeUndefinedValues: true }),
  );
}
async function person(id: string, assigned = true) {
  m.seedAccess(org, id, "WAITER");
  await Staff.mutate(org, "manager", id, "BIND", {
    clientRequestId: request(),
    memberUserId: id,
    operationalLabel: `${id} S.`,
  });
  if (assigned)
    await Staff.mutate(
      org,
      "manager",
      id,
      "ASSIGN",
      { clientRequestId: request() },
      f.outlet.id,
    );
}
async function createOrder(guestSessionId = session.guestSessionId) {
  return c.RestaurantOrderSchema.parse(
    (
      await S.mutate({ ...scope(), actorId: "Binta" }, "CREATE_ORDER", {
        clientRequestId: request(),
        orderType: "DINE_IN",
        guestSessionId,
      })
    ).data,
  );
}
async function add(index = 0, orderId = order.orderId) {
  const current = (await S.order(scope(), orderId)).data;
  const item = f.items[index];
  return c.RestaurantOrderItemSchema.parse(
    (
      await S.mutate(
        scope(),
        "ADD_ITEM",
        {
          clientRequestId: request(),
          expectedVersion: current.version,
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
beforeEach(async () => {
  m = memoryDynamo();
  seq = 20000;
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  f = await acceptanceFixture();
  m.seedAccess(org, "owner", "OWNER");
  m.seedAccess(org, "manager", "MANAGER");
  await person("Aissa");
  await person("Binta");
  const opened = await call("open-session", "Binta", {
    clientRequestId: request(),
    tableId: f.tables[0].id,
    areaId: f.tables[0].serviceAreaId,
  });
  expect(opened.statusCode).toBe(200);
  session = c.GuestSessionResponseSchema.parse(JSON.parse(opened.body)).data;
  order = await createOrder();
});
afterEach(() => {
  m.db.restore();
  jest.restoreAllMocks();
});

const ids = () => ({ orderId: order.orderId });
const current = async () => (await S.order(scope(), order.orderId)).data;
const draftBody = async (index = 0) => ({
  clientRequestId: request(),
  expectedVersion: (await current()).version,
  menuItemId: f.items[index].id,
  categoryId: f.items[index].categoryId,
  expectedMenuItemVersion: f.items[index].version,
  quantity: 1,
});
const submitBody = async (line: c.RestaurantOrderItem) => ({
  clientRequestId: request(),
  expectedVersion: (await current()).version,
  items: [{ itemId: line.itemId, expectedVersion: line.version }],
});
const createBody = () => ({
  clientRequestId: request(),
  orderType: "DINE_IN",
  guestSessionId: session.guestSessionId,
});
const data = (response: { statusCode: number; body: string }) => {
  expect(response.statusCode).toBe(200);
  return JSON.parse(response.body).data;
};
const snapshotRows = () => JSON.stringify([...m.rows]);
const scoped = ["CREATE", "DRAFT", "SUBMIT"].map(
  (x) => `RESTAURANTS_SERVICE_ORDER_${x}_MANAGE`,
);

test.each([
  "OWNER",
  "MANAGER",
  "WAITER",
  "CASHIER",
  "KITCHEN",
  "INVALID",
  undefined,
])("narrow command projection %s", (role) => {
  const permissions = Auth.permissionsForRestaurantsRole(role);
  for (const p of scoped)
    expect(permissions.includes(p as never)).toBe(
      ["OWNER", "MANAGER", "WAITER"].includes(role ?? ""),
    );
  if (role === "WAITER")
    expect(
      permissions.filter((p) => p.startsWith("RESTAURANTS_ORDER_")),
    ).toEqual([]);
});
test("only normal command routes use scoped permissions", () => {
  expect(
    RESTAURANT_TRANSACTION_ROUTES.filter((r) =>
      scoped.includes(r.permission),
    ).map((r) => r.name),
  ).toEqual([
    "create-order",
    "add-draft-item",
    "edit-draft-item",
    "cancel-order-item",
    "submit-order",
  ]);
});
test.each(["owner", "manager", "Aissa"])(
  "%s creates safely and durable create intent replays",
  async (actor) => {
    const body = createBody();
    const created = c.RestaurantOrderSchema.parse(
      data(await call("create-order", actor, body)),
    );
    expect(created).toMatchObject({
      guestSessionId: session.guestSessionId,
      tableId: f.tables[0].id,
      currency: "XOF",
      createdBy: actor,
    });
    expect(created.waiterId).toBe(actor === "Aissa" ? actor : undefined);
    if (actor === "Aissa") {
      expect(
        [...m.rows.values()]
          .map((row) => unmarshall(row))
          .some(
            (row) =>
              row.entityType === "RESTAURANT_WAITER_ORDER" &&
              row.data.targetId === created.orderId,
          ),
      ).toBe(true);
    }
    const before = snapshotRows();
    expect(data(await call("create-order", actor, body))).toEqual(created);
    expect(snapshotRows()).toBe(before);
    expect(
      (
        await call("create-order", actor, {
          ...body,
          orderType: "COUNTER",
          guestSessionId: undefined,
        })
      ).statusCode,
    ).toBe(actor === "Aissa" ? 403 : 409);
    expect(
      (
        await call("create-order", actor, {
          ...createBody(),
          waiterId: "Binta",
        })
      ).statusCode,
    ).toBe(400);
  },
);
test.each(["COUNTER", "TAKEAWAY"])(
  "waiter cannot create or mutate %s",
  async (orderType) => {
    expect(
      (
        await call("create-order", "Aissa", {
          clientRequestId: request(),
          orderType,
        })
      ).statusCode,
    ).toBe(403);
    const standalone = data(
      await call("create-order", "owner", {
        clientRequestId: request(),
        orderType,
      }),
    );
    expect(
      (
        await call("add-draft-item", "Aissa", await draftBody(), {
          orderId: standalone.orderId,
        })
      ).statusCode,
    ).toBe(404);
  },
);
test("draft add/edit/remove replay, immutable accepted lines and explicit later rounds", async () => {
  // Binta is responsible; Aissa can operate the entire assigned outlet.
  expect(order.waiterId).toBe("Binta");
  expect(
    (await S.session(scope(), session.guestSessionId)).data.responsibleStaffId,
  ).toBe("Binta");
  const addBody = await draftBody();
  const line = c.RestaurantOrderItemSchema.parse(
    data(await call("add-draft-item", "Aissa", addBody, ids())),
  );
  expect(data(await call("add-draft-item", "Aissa", addBody, ids()))).toEqual(
    line,
  );
  expect(
    (await call("add-draft-item", "Aissa", { ...addBody, quantity: 2 }, ids()))
      .statusCode,
  ).toBe(409);
  const edit = {
    ...(await draftBody()),
    expectedItemVersion: line.version,
    quantity: 2,
  };
  const lineIds = { ...ids(), itemId: line.itemId };
  const edited = c.RestaurantOrderItemSchema.parse(
    data(await call("edit-draft-item", "Aissa", edit, lineIds)),
  );
  expect(data(await call("edit-draft-item", "Aissa", edit, lineIds))).toEqual(
    edited,
  );
  expect(
    (await call("edit-draft-item", "Aissa", { ...edit, quantity: 3 }, lineIds))
      .statusCode,
  ).toBe(409);
  expect(
    (
      await call(
        "edit-draft-item",
        "Aissa",
        { ...edit, clientRequestId: request() },
        lineIds,
      )
    ).statusCode,
  ).toBe(409);
  const submit = await submitBody(edited);
  data(await call("submit-order", "Aissa", submit, ids()));
  const beforeReplay = snapshotRows();
  data(await call("submit-order", "Aissa", submit, ids()));
  expect(snapshotRows()).toBe(beforeReplay);
  expect(
    (
      await call(
        "submit-order",
        "Aissa",
        { ...submit, items: [{ itemId: edited.itemId, expectedVersion: 99 }] },
        ids(),
      )
    ).statusCode,
  ).toBe(409);
  const accepted = (await S.line(scope(), order.orderId, line.itemId)).data;
  expect(accepted.snapshot).toMatchObject({
    unitPriceMinor: 5000,
    quantity: 2,
    lineTotalMinor: 10000,
    acceptedBy: "Aissa",
  });
  expect((await S.session(scope(), session.guestSessionId)).data.dueMinor).toBe(
    10000,
  );
  expect(
    (
      await call(
        "edit-draft-item",
        "Aissa",
        { ...(await draftBody()), expectedItemVersion: accepted.version },
        lineIds,
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await call(
        "cancel-order-item",
        "Aissa",
        {
          clientRequestId: request(),
          expectedVersion: (await current()).version,
          expectedItemVersion: accepted.version,
          reason: "Not a draft",
        },
        lineIds,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await call(
        "edit-draft-item",
        "Aissa",
        {
          ...(await draftBody()),
          expectedItemVersion: accepted.version,
          snapshot: accepted.snapshot,
        },
        lineIds,
      )
    ).statusCode,
  ).toBe(400);
  const removed = c.RestaurantOrderItemSchema.parse(
    data(await call("add-draft-item", "Aissa", await draftBody(1), ids())),
  );
  const remove = {
    clientRequestId: request(),
    expectedVersion: (await current()).version,
    expectedItemVersion: removed.version,
    reason: "Draft correction",
  };
  const removeIds = { ...ids(), itemId: removed.itemId };
  expect(
    data(await call("cancel-order-item", "Aissa", remove, removeIds)),
  ).toMatchObject({ status: "CANCELLED" });
  expect(
    data(await call("cancel-order-item", "Aissa", remove, removeIds)),
  ).not.toHaveProperty("snapshot");
  expect((await S.session(scope(), session.guestSessionId)).data.dueMinor).toBe(
    10000,
  );
  const later = c.RestaurantOrderItemSchema.parse(
    data(await call("add-draft-item", "Aissa", await draftBody(2), ids())),
  );
  data(await call("submit-order", "Aissa", await submitBody(later), ids()));
  expect((await S.line(scope(), order.orderId, line.itemId)).data).toEqual(
    accepted,
  );
  expect(
    (await S.line(scope(), order.orderId, later.itemId)).data.snapshot
      ?.submissionId,
  ).not.toBe(accepted.snapshot?.submissionId);
  expect((await current()).dueMinor).toBe(10500);
  expect((await S.session(scope(), session.guestSessionId)).data.dueMinor).toBe(
    10500,
  );
  expect(
    [...m.rows.values()]
      .map((row) => unmarshall(row))
      .filter((row) => row.entityType === "RESTAURANT_SUBMISSION"),
  ).toHaveLength(2);
});
async function revoke(change: string) {
  if (change === "assignment" || change === "deleted-assignment") {
    const key = SR.assignmentKeys(org, "Aissa", f.outlet.id)[0];
    if (change === "deleted-assignment")
      m.rows.delete(JSON.stringify([key.PK, key.SK]));
    else {
      const old = await SR.get(org, key, "ASSIGNMENT");
      patch(key, {
        data: { ...old, status: "INACTIVE", version: old!.version + 1 },
      });
    }
  }
  if (change === "staff") {
    const key = SR.staffKey(org, "Aissa");
    const old = await SR.get(org, key, "STAFF");
    patch(key, {
      data: { ...old, status: "INACTIVE", version: old!.version + 1 },
    });
  }
  if (change === "membership")
    patch(
      { PK: K.orgKey(org), SK: K.orgUserAccessSK("Aissa") },
      { status: "INACTIVE" },
    );
  if (change === "product")
    patch(
      { PK: K.orgKey(org), SK: K.productAccessSK("RESTAURANTS") },
      { status: "INACTIVE" },
    );
  if (change === "role") m.seedAccess(org, "Aissa", "KITCHEN");
  if (change === "outlet") {
    const old = await Config.get(org, "outlet", {}, f.outlet.id);
    // Use canonical configuration deactivation; commercial writes must see its version.
    await Config.update(
      org,
      "owner",
      "outlet",
      {},
      f.outlet.id,
      { expectedVersion: old.version },
      "deactivate",
    );
  }
}
test.each([
  "assignment",
  "deleted-assignment",
  "staff",
  "membership",
  "product",
  "role",
  "outlet",
])(
  "%s revocation denies all commands and successful intent replay before writes",
  async (change) => {
    const create = createBody();
    data(await call("create-order", "Aissa", create));
    const body = await draftBody();
    const line = c.RestaurantOrderItemSchema.parse(
      data(await call("add-draft-item", "Aissa", body, ids())),
    );
    await revoke(change);
    const before = snapshotRows();
    for (const [name, input, path] of [
      ["create-order", create, {}],
      ["add-draft-item", body, ids()],
      [
        "edit-draft-item",
        { ...body, expectedItemVersion: 1 },
        { ...ids(), itemId: line.itemId },
      ],
      [
        "cancel-order-item",
        {
          clientRequestId: request(),
          expectedVersion: 2,
          expectedItemVersion: 1,
          reason: "Draft",
        },
        { ...ids(), itemId: line.itemId },
      ],
      ["submit-order", await submitBody(line), ids()],
    ] as const)
      expect((await call(name, "Aissa", input, path)).statusCode).toBe(403);
    expect(snapshotRows()).toBe(before);
  },
);
test.each(["CASHIER", "KITCHEN", "UNKNOWN", undefined])(
  "%s has no normal command authorization",
  async (role) => {
    m.seedAccess(org, "Aissa", role ?? "WAITER");
    if (role === undefined)
      patch(
        { PK: K.orgKey(org), SK: K.orgUserAccessSK("Aissa") },
        { productRoles: {} },
      );
    const before = snapshotRows();
    const draft = await draftBody();
    const lookup = jest.spyOn(S, "order");
    for (const name of [
      "create-order",
      "add-draft-item",
      "edit-draft-item",
      "cancel-order-item",
      "submit-order",
    ]) {
      const body =
        name === "create-order"
          ? createBody()
          : name === "submit-order"
            ? {
                clientRequestId: request(),
                expectedVersion: 1,
                items: [{ itemId: fixtureId(999), expectedVersion: 1 }],
              }
            : name === "cancel-order-item"
              ? {
                  clientRequestId: request(),
                  expectedVersion: 1,
                  expectedItemVersion: 1,
                  reason: "Draft",
                }
              : {
                  ...draft,
                  ...(name === "edit-draft-item"
                    ? { expectedItemVersion: 1 }
                    : {}),
                };
      expect(
        (
          await call(
            name,
            "Aissa",
            body,
            name === "create-order"
              ? {}
              : {
                  ...ids(),
                  ...(name === "edit-draft-item" || name === "cancel-order-item"
                    ? { itemId: fixtureId(999) }
                    : {}),
                },
          )
        ).statusCode,
      ).toBe(403);
    }
    expect(lookup).not.toHaveBeenCalled();
    expect(snapshotRows()).toBe(before);
  },
);
test("wrong outlet, tenant, parent/table ownership and closed-session boundaries", async () => {
  await person("unassigned", false);
  expect(
    (await call("create-order", "unassigned", createBody())).statusCode,
  ).toBe(403);
  const other = await Config.create(
    org,
    "owner",
    "outlet",
    {},
    { clientRequestId: request(), name: "Other" },
  );
  expect(
    (await call("create-order", "Aissa", createBody(), {}, {}, other.id))
      .statusCode,
  ).toBe(403);
  await Staff.mutate(
    org,
    "owner",
    "Aissa",
    "ASSIGN",
    { clientRequestId: request() },
    other.id,
  );
  expect(
    (await call("create-order", "Aissa", createBody(), {}, {}, other.id))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await call(
        "add-draft-item",
        "Aissa",
        await draftBody(),
        ids(),
        {},
        other.id,
      )
    ).statusCode,
  ).toBe(404);
  m.seedAccess("foreign", "Aissa", "OWNER");
  const foreign = await call(
    "create-order",
    "Aissa",
    createBody(),
    {},
    {},
    f.outlet.id,
    "foreign",
  );
  expect(foreign.statusCode).toBe(404);
  expect(foreign.body).not.toContain(session.guestSessionId);
  // A client cannot substitute another session/table on an existing-Order command.
  expect(
    (
      await call(
        "add-draft-item",
        "Aissa",
        { ...(await draftBody()), guestSessionId: fixtureId(99) },
        ids(),
      )
    ).statusCode,
  ).toBe(400);
  const key = {
    PK: K.restaurantOrderPK(org, f.outlet.id, order.orderId),
    SK: "META",
  };
  patch(key, { data: { ...order, tableId: f.tables[1].id } });
  expect(
    (await call("add-draft-item", "Aissa", await draftBody(), ids()))
      .statusCode,
  ).toBe(404);
  patch(key, { data: order });
  const sessionKey = {
    PK: K.restaurantSessionPK(org, f.outlet.id, session.guestSessionId),
    SK: "META",
  };
  const original = (await S.session(scope(), session.guestSessionId)).data;
  patch(sessionKey, {
    data: {
      ...original,
      status: "CLOSED",
      openOrderCount: 0,
      closedAt: new Date().toISOString(),
      closedBy: "owner",
      version: original.version + 1,
    },
  });
  const before = snapshotRows();
  expect((await call("create-order", "Aissa", createBody())).statusCode).toBe(
    404,
  );
  expect(
    (await call("add-draft-item", "Aissa", await draftBody(), ids()))
      .statusCode,
  ).toBe(404);
  expect(snapshotRows()).toBe(before);
});
test.each([
  "create-order",
  "add-draft-item",
  "edit-draft-item",
  "cancel-order-item",
  "submit-order",
])("%s rejects concurrent session closure atomically", async (name) => {
  const line = await add();
  const body =
    name === "create-order"
      ? createBody()
      : name === "submit-order"
        ? await submitBody(line)
        : name === "cancel-order-item"
          ? {
              clientRequestId: request(),
              expectedVersion: 2,
              expectedItemVersion: 1,
              reason: "Draft",
            }
          : {
              ...(await draftBody()),
              ...(name === "edit-draft-item" ? { expectedItemVersion: 1 } : {}),
            };
  const beforeOrder = await current();
  const beforeLine = (await S.line(scope(), order.orderId, line.itemId)).data;
  const commit = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    const old = (await S.session(scope(), session.guestSessionId)).data;
    patch(
      {
        PK: K.restaurantSessionPK(org, f.outlet.id, session.guestSessionId),
        SK: "META",
      },
      {
        data: {
          ...old,
          status: "CLOSED",
          openOrderCount: 0,
          closedAt: new Date().toISOString(),
          closedBy: "owner",
          version: old.version + 1,
        },
      },
    );
    return commit(actions);
  });
  const response = await call(
    name,
    "Aissa",
    body,
    name === "create-order"
      ? {}
      : {
          ...ids(),
          ...(name === "edit-draft-item" || name === "cancel-order-item"
            ? { itemId: line.itemId }
            : {}),
        },
  );
  expect([404, 409]).toContain(response.statusCode);
  expect(await current()).toEqual(beforeOrder);
  expect((await S.line(scope(), order.orderId, line.itemId)).data).toEqual(
    beforeLine,
  );
});
test.each(["assignment", "staff", "membership", "product", "role", "outlet"])(
  "%s revocation between authorization and commit rejects all commercial writes",
  async (change) => {
    const body = await draftBody();
    const before = await current();
    const commit = R.commit.bind(R);
    jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
      await revoke(change);
      return commit(actions);
    });
    expect([403, 409]).toContain(
      (await call("add-draft-item", "Aissa", body, ids())).statusCode,
    );
    expect(await current()).toEqual(before);
    expect(
      [...m.rows.values()]
        .map((row) => unmarshall(row))
        .filter((row) => row.entityType === "RESTAURANT_ORDER_ITEM"),
    ).toHaveLength(0);
  },
);
test("concurrent edits and edit vs submit never overwrite accepted content", async () => {
  const line = await add();
  const edit = { ...(await draftBody()), expectedItemVersion: 1, quantity: 2 };
  const lineIds = { ...ids(), itemId: line.itemId };
  const results = await Promise.all([
    call("edit-draft-item", "Aissa", edit, lineIds),
    call(
      "edit-draft-item",
      "Binta",
      { ...edit, clientRequestId: request(), quantity: 3 },
      lineIds,
    ),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const changed = (await S.line(scope(), order.orderId, line.itemId)).data;
  const nextEdit = {
    ...(await draftBody()),
    expectedItemVersion: changed.version,
    quantity: 4,
  };
  const race = await Promise.all([
    call("submit-order", "Aissa", await submitBody(changed), ids()),
    call("edit-draft-item", "Binta", nextEdit, lineIds),
  ]);
  expect(race.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const latest = (await S.line(scope(), order.orderId, line.itemId)).data;
  if (latest.status === "ACCEPTED")
    expect(latest.snapshot?.quantity).toBe(changed.quantity);
  else expect(latest).toMatchObject({ status: "DRAFT", quantity: 4 });
});
test("accepted cancellation cannot replay under the scoped draft permission", async () => {
  const line = await add();
  data(await call("submit-order", "Aissa", await submitBody(line), ids()));
  const body = {
    clientRequestId: request(),
    expectedVersion: (await current()).version,
    expectedItemVersion: 2,
    reason: "Manager correction",
  };
  const lineIds = { ...ids(), itemId: line.itemId };
  data(await call("cancel-order-item", "owner", body, lineIds));
  // Intent fingerprints bind actor. Even a management actor subsequently changed
  // to WAITER cannot replay an accepted-sale reversal through the draft grant.
  await person("owner");
  expect(
    (await call("cancel-order-item", "owner", body, lineIds)).statusCode,
  ).toBe(403);
  expect((await current()).dueMinor).toBe(0);
});
test("configuration review, availability, retained caps and oversized rounds stay canonical", async () => {
  const body = await draftBody();
  expect(
    (
      await call(
        "add-draft-item",
        "Aissa",
        { ...body, expectedMenuItemVersion: 99 },
        ids(),
      )
    ).statusCode,
  ).toBe(409);
  const line = c.RestaurantOrderItemSchema.parse(
    data(await call("add-draft-item", "Aissa", body, ids())),
  );
  await Config.update(
    org,
    "owner",
    "item",
    { outletId: f.outlet.id, categoryId: f.items[0].categoryId },
    f.items[0].id,
    { expectedVersion: 1, availability: "UNAVAILABLE" },
    "availability",
  );
  expect(
    (await call("submit-order", "Aissa", await submitBody(line), ids()))
      .statusCode,
  ).toBe(409);
  const before = snapshotRows();
  expect(
    (
      await call(
        "submit-order",
        "Aissa",
        {
          ...(await submitBody(line)),
          items: Array.from({ length: 13 }, (_, i) => ({
            itemId: fixtureId(900 + i),
            expectedVersion: 1,
          })),
        },
        ids(),
      )
    ).statusCode,
  ).toBe(400);
  expect(snapshotRows()).toBe(before);
  const key = {
    PK: K.restaurantOrderPK(org, f.outlet.id, order.orderId),
    SK: "META",
  };
  patch(key, { data: { ...(await current()), lineCount: 200 } });
  expect(
    (await call("add-draft-item", "Aissa", await draftBody(1), ids()))
      .statusCode,
  ).toBe(400);
  const sessionKey = {
    PK: K.restaurantSessionPK(org, f.outlet.id, session.guestSessionId),
    SK: "META",
  };
  patch(sessionKey, {
    data: {
      ...(await S.session(scope(), session.guestSessionId)).data,
      orderCount: 50,
    },
  });
  expect((await call("create-order", "Aissa", createBody())).statusCode).toBe(
    409,
  );
});
test("exception routes remain denied before mutation", async () => {
  const line = await add();
  data(await call("submit-order", "Aissa", await submitBody(line), ids()));
  const before = snapshotRows();
  for (const [name, body, path] of [
    [
      "cancel-order-item",
      {
        clientRequestId: request(),
        expectedVersion: 3,
        expectedItemVersion: 2,
        reason: "Exception",
      },
      { ...ids(), itemId: line.itemId },
    ],
    [
      "cancel-order",
      { clientRequestId: request(), expectedVersion: 3, reason: "Exception" },
      ids(),
    ],
    ["close-order", { clientRequestId: request(), expectedVersion: 3 }, ids()],
    [
      "close-session",
      { clientRequestId: request(), expectedVersion: 3 },
      { sessionId: session.guestSessionId },
    ],
  ] as const)
    expect((await call(name, "Aissa", body, path)).statusCode).toBe(403);
  expect(snapshotRows()).toBe(before);
  // No preparation/payment/bill command exists in this registry or service scope.
  expect(
    RESTAURANT_TRANSACTION_ROUTES.filter((r) =>
      scoped.includes(r.permission),
    ).every((r) => !/payment|preparation|bill|close/.test(r.name)),
  ).toBe(true);
});
test.each(["assignment", "closed-session"])(
  "successful submit replay remains unavailable after %s",
  async (change) => {
    const line = await add();
    const body = await submitBody(line);
    data(await call("submit-order", "Aissa", body, ids()));
    if (change === "assignment") await revoke(change);
    else {
      const old = (await S.session(scope(), session.guestSessionId)).data;
      patch(
        {
          PK: K.restaurantSessionPK(org, f.outlet.id, session.guestSessionId),
          SK: "META",
        },
        {
          data: {
            ...old,
            status: "CLOSED",
            closedAt: new Date().toISOString(),
            closedBy: "owner",
            openOrderCount: 0,
            paidMinor: old.dueMinor,
            version: old.version + 1,
          },
        },
      );
    }
    const before = snapshotRows();
    expect((await call("submit-order", "Aissa", body, ids())).statusCode).toBe(
      change === "assignment" ? 403 : 404,
    );
    expect(snapshotRows()).toBe(before);
  },
);
test("responsibility references cannot retain command access after assignment revocation", async () => {
  const old = (await S.session(scope(), session.guestSessionId)).data;
  patch(
    {
      PK: K.restaurantSessionPK(org, f.outlet.id, session.guestSessionId),
      SK: "META",
    },
    { data: { ...old, responsibleStaffId: "Aissa" } },
  );
  patch(
    { PK: K.restaurantOrderPK(org, f.outlet.id, order.orderId), SK: "META" },
    { data: { ...order, waiterId: "Aissa" } },
  );
  await revoke("assignment");
  const before = snapshotRows();
  expect(
    (await call("add-draft-item", "Aissa", await draftBody(), ids()))
      .statusCode,
  ).toBe(403);
  expect(snapshotRows()).toBe(before);
});
test("management cancellation of an attributed empty Order removes its existing waiter locator", async () => {
  expect(order.waiterId).toBe("Binta");
  const key = {
    PK: K.restaurantWaiterActivePK(org, f.outlet.id, "Binta"),
    SK: K.restaurantTransactionLocatorSK(order.createdAt, order.orderId),
  };
  expect(m.rows.has(JSON.stringify([key.PK, key.SK]))).toBe(true);
  expect(
    data(
      await call(
        "cancel-order",
        "manager",
        {
          clientRequestId: request(),
          expectedVersion: 1,
          reason: "Unused Order",
        },
        ids(),
      ),
    ),
  ).toMatchObject({ status: "CANCELLED", waiterId: "Binta" });
  expect(m.rows.has(JSON.stringify([key.PK, key.SK]))).toBe(false);
});
