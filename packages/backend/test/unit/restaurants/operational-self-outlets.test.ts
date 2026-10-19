import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  BatchGetItemCommand,
} from "@aws-sdk/client-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { RestaurantStaffService as Staff } from "@/lambda/domains/restaurants/staff-service";
import { RestaurantStaffRepository as SR } from "@/lambda/domains/restaurants/staff-repository";
import { RestaurantsService as Config } from "@/lambda/domains/restaurants/restaurant-service";
import { restaurantStaffHandler } from "@/lambda/domains/restaurants/staff-handler";
import { restaurantTransactionHandler } from "@/lambda/domains/restaurants/transaction-handler";
import { restaurantPreparationHandler } from "@/lambda/domains/restaurants/preparation-handler";
import { DomainAuthorizationService as Auth } from "@/lambda/shared/services/domain-authorization-service";
import {
  RESTAURANTS_SERVICE_PERMISSIONS,
  RESTAURANTS_PREPARATION_PERMISSIONS,
} from "@liass-ohada/shared/shared";
import { acceptanceFixture } from "./acceptance-fixture";
import { memoryDynamo, fixtureId } from "./memory-dynamo";
let m: ReturnType<typeof memoryDynamo>,
  f: Awaited<ReturnType<typeof acceptanceFixture>>,
  seq: number;
const org = "org-resto",
  permission = "RESTAURANTS_STAFF_OUTLET_SELF_READ";
const req = () => fixtureId(++seq);
const self = (actor = "cook", query: object = {}, tenant = org) =>
  restaurantStaffHandler("my-service-outlets")({
    headers: { "x-org-id": tenant },
    queryStringParameters: query,
    requestContext: { authorizer: { jwt: { claims: { sub: actor } } } },
  });
const data = (response: { body: string }) =>
  c.RestaurantMyOutletsResponseSchema.parse(JSON.parse(response.body));
const patch = (
  key: { PK: string; SK: string },
  change: Record<string, unknown>,
) => {
  const id = JSON.stringify([key.PK, key.SK]),
    row = unmarshall(m.rows.get(id)!);
  m.rows.set(
    id,
    marshall({ ...row, ...change }, { removeUndefinedValues: true }),
  );
};
async function person(
  user: string,
  role: string,
  assigned = true,
  tenant = org,
  owner = "owner",
) {
  m.seedAccess(tenant, user, role);
  await Staff.mutate(tenant, owner, user, "BIND", {
    clientRequestId: req(),
    memberUserId: user,
    operationalLabel: `${user} staff`,
  });
  if (assigned)
    await Staff.mutate(
      tenant,
      owner,
      user,
      "ASSIGN",
      { clientRequestId: req() },
      f.outlet.id,
    );
}
beforeEach(async () => {
  m = memoryDynamo();
  seq = 31000;
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  f = await acceptanceFixture();
  m.seedAccess(org, "owner", "OWNER");
  m.seedAccess(org, "manager", "MANAGER");
  await person("cook", "KITCHEN");
  await person("waiter", "WAITER");
  await person("cashier", "CASHIER");
});
afterEach(() => {
  m.db.restore();
  jest.restoreAllMocks();
});

test.each(["cook", "waiter", "cashier"])(
  "%s discovers active assigned outlets using bounded self reads only",
  async (actor) => {
    m.db.resetHistory();
    const response = await self(actor);
    expect(response.statusCode).toBe(200);
    expect(data(response).items).toEqual([
      { outletId: f.outlet.id, name: f.outlet.name },
    ]);
    expect(m.db.commandCalls(QueryCommand)).toHaveLength(1);
    const query = m.db.commandCalls(QueryCommand)[0].args[0].input;
    expect(query).toMatchObject({
      ConsistentRead: true,
      Limit: 50,
      ScanIndexForward: true,
    });
    expect(unmarshall(query.ExpressionAttributeValues!)[":prefix"]).toBe(
      K.restaurantStaffOutletPrefix(actor),
    );
    expect(m.db.commandCalls(BatchGetItemCommand)).toHaveLength(1);
    expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
    expect(m.db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
    expect(Object.keys(data(response).items[0]).sort()).toEqual([
      "name",
      "outletId",
    ]);
  },
);
test.each(["KITCHEN", "WAITER"])(
  "%s zero-assignment state remains an empty successful page",
  async (role) => {
    await person("empty", role, false);
    const response = await self("empty");
    expect(response.statusCode).toBe(200);
    expect(data(response)).toEqual({ items: [] });
  },
);
test("multiple outlets paginate deterministically and each user sees only their own assignments", async () => {
  expect((await self("cook", {}, "unrelated-tenant")).statusCode).toBe(403);
  const b = await Config.create(
    org,
    "owner",
    "outlet",
    {},
    { clientRequestId: req(), name: "Other outlet" },
  );
  await Staff.mutate(
    org,
    "owner",
    "cook",
    "ASSIGN",
    { clientRequestId: req() },
    b.id,
  );
  await person("other-cook", "KITCHEN", false);
  await Staff.mutate(
    org,
    "owner",
    "other-cook",
    "ASSIGN",
    { clientRequestId: req() },
    b.id,
  );
  const first = data(await self("cook", { limit: "1" }));
  expect(first.nextCursor).toBeDefined();
  expect(data(await self("cook", { limit: "1" }))).toEqual(first);
  const next = data(
    await self("cook", { limit: "1", cursor: first.nextCursor }),
  );
  expect([...first.items, ...next.items].map((o) => o.outletId)).toEqual(
    [f.outlet.id, b.id].sort(),
  );
  expect(data(await self("other-cook")).items).toEqual([
    { outletId: b.id, name: b.name },
  ]);
  expect(
    (await self("other-cook", { cursor: first.nextCursor })).statusCode,
  ).toBe(400);
  m.seedAccess("foreign", "foreign-owner", "OWNER");
  await person("cook", "KITCHEN", false, "foreign", "foreign-owner");
  expect(
    (await self("cook", { cursor: first.nextCursor }, "foreign")).statusCode,
  ).toBe(400);
  expect(data(await self("cook", {}, "foreign")).items).toEqual([]);
});
test.each(["inactive-assignment", "deleted-assignment", "inactive-outlet"])(
  "%s disappears on the very next request",
  async (kind) => {
    expect(data(await self()).items).toHaveLength(1);
    if (kind === "inactive-assignment")
      await Staff.mutate(
        org,
        "owner",
        "cook",
        "UNASSIGN",
        { clientRequestId: req(), expectedVersion: 1 },
        f.outlet.id,
      );
    if (kind === "deleted-assignment")
      for (const key of SR.assignmentKeys(org, "cook", f.outlet.id))
        m.rows.delete(JSON.stringify([key.PK, key.SK]));
    if (kind === "inactive-outlet")
      await Config.update(
        org,
        "owner",
        "outlet",
        {},
        f.outlet.id,
        { expectedVersion: f.outlet.version },
        "deactivate",
      );
    const response = await self();
    expect(response.statusCode).toBe(200);
    expect(data(response).items).toEqual([]);
  },
);
test.each([
  "inactive-staff",
  "missing-staff",
  "membership",
  "product",
  "role",
  "missing-role",
])("%s denies current self discovery", async (kind) => {
  expect((await self()).statusCode).toBe(200);
  if (kind === "inactive-staff")
    await Staff.mutate(org, "owner", "cook", "UPDATE", {
      clientRequestId: req(),
      expectedVersion: 1,
      status: "INACTIVE",
    });
  if (kind === "missing-staff") {
    const key = SR.staffKey(org, "cook");
    m.rows.delete(JSON.stringify([key.PK, key.SK]));
  }
  if (kind === "membership")
    patch(
      { PK: K.orgKey(org), SK: K.orgUserAccessSK("cook") },
      { status: "INACTIVE" },
    );
  if (kind === "product")
    patch(
      { PK: K.orgKey(org), SK: K.productAccessSK("RESTAURANTS") },
      { status: "INACTIVE" },
    );
  if (kind === "role" || kind === "missing-role")
    patch(
      { PK: K.orgKey(org), SK: K.orgUserAccessSK("cook") },
      { productRoles: kind === "role" ? { RESTAURANTS: "INVALID" } : {} },
    );
  expect((await self()).statusCode).toBe(403);
});
test("role change to independently authorized WAITER preserves discovery only under its own grants", async () => {
  patch(
    { PK: K.orgKey(org), SK: K.orgUserAccessSK("cook") },
    { productRoles: { RESTAURANTS: "WAITER" } },
  );
  expect((await self()).statusCode).toBe(200);
  expect(Auth.permissionsForRestaurantsRole("WAITER")).not.toContain(
    "RESTAURANTS_PREPARATION_READ",
  );
});
test.each(["OWNER", "MANAGER"])(
  "%s optional bound-staff self discovery is preserved without changing management requirements",
  async (role) => {
    const actor = role === "OWNER" ? "owner" : "manager";
    expect((await self(actor)).statusCode).toBe(403);
    await person("bound-manager", role);
    expect((await self("bound-manager")).statusCode).toBe(200);
  },
);
test.each(["invalid"])("%s does not acquire self discovery", async (role) => {
  m.seedAccess(org, "denied", role);
  expect((await self("denied")).statusCode).toBe(403);
  expect(Auth.permissionsForRestaurantsRole(role)).not.toContain(permission);
});
test("permission projection keeps discovery independent of every transactional capability", () => {
  for (const role of ["OWNER", "MANAGER", "WAITER", "KITCHEN", "CASHIER"])
    expect(Auth.permissionsForRestaurantsRole(role)).toContain(permission);
  const kitchen = Auth.permissionsForRestaurantsRole("KITCHEN");
  for (const p of RESTAURANTS_SERVICE_PERMISSIONS)
    expect(kitchen).not.toContain(p);
  expect(
    kitchen.filter((p) => p.startsWith("RESTAURANTS_PREPARATION_")),
  ).toEqual(
    RESTAURANTS_PREPARATION_PERMISSIONS.filter(
      (p) => p !== "RESTAURANTS_PREPARATION_SERVE_MANAGE",
    ),
  );
  for (const p of RESTAURANTS_SERVICE_PERMISSIONS)
    expect(Auth.permissionsForRestaurantsRole("WAITER")).toContain(p);
  for (const p of RESTAURANTS_PREPARATION_PERMISSIONS)
    expect(Auth.permissionsForRestaurantsRole("CASHIER")).not.toContain(p);
  expect(Auth.hasPermission([permission], "RESTAURANTS_PREPARATION_READ")).toBe(
    false,
  );
  expect(
    Auth.hasPermission([permission], "RESTAURANTS_SERVICE_FLOOR_READ"),
  ).toBe(false);
});
test.each([
  "service-floor",
  "open-session",
  "get-session",
  "session-orders",
  "get-order",
  "order-items",
])("KITCHEN self discovery never authorizes %s handler", async (name) => {
  expect((await self()).statusCode).toBe(200);
  const response = await restaurantTransactionHandler(name)({
    headers: { "x-org-id": org },
    body:
      name === "open-session"
        ? JSON.stringify({
            clientRequestId: req(),
            tableId: f.tables[0].id,
            areaId: f.areas[0].id,
          })
        : undefined,
    pathParameters: {
      outletId: f.outlet.id,
      ...(name === "get-session" || name === "session-orders"
        ? { sessionId: fixtureId(999) }
        : {}),
      ...(name === "get-order" || name === "order-items"
        ? { orderId: fixtureId(999) }
        : {}),
    },
    requestContext: { authorizer: { jwt: { claims: { sub: "cook" } } } },
  });
  expect(response.statusCode).toBe(403);
});
test("Preparation remains independently permissioned and outlet-assignment scoped", async () => {
  const read = (outletId: string) =>
    restaurantPreparationHandler("station-preparation")({
      headers: { "x-org-id": org },
      pathParameters: {
        outletId,
        stationId: f.stations[0].id,
        state: "QUEUED",
      },
      requestContext: { authorizer: { jwt: { claims: { sub: "cook" } } } },
    });
  expect((await read(f.outlet.id)).statusCode).toBe(200);
  const b = await Config.create(
    org,
    "owner",
    "outlet",
    {},
    { clientRequestId: req(), name: "Unassigned" },
  );
  expect((await read(b.id)).statusCode).toBe(403);
  await Staff.mutate(
    org,
    "owner",
    "cook",
    "UNASSIGN",
    { clientRequestId: req(), expectedVersion: 1 },
    f.outlet.id,
  );
  expect((await read(f.outlet.id)).statusCode).toBe(403);
});
test("a discovery-only grant cannot authorize Preparation through the real handler", async () => {
  jest
    .spyOn(Auth, "permissionsForRestaurantsRole")
    .mockReturnValue([permission]);
  expect((await self()).statusCode).toBe(200);
  const response = await restaurantPreparationHandler("station-preparation")({
    headers: { "x-org-id": org },
    pathParameters: {
      outletId: f.outlet.id,
      stationId: f.stations[0].id,
      state: "QUEUED",
    },
    requestContext: { authorizer: { jwt: { claims: { sub: "cook" } } } },
  });
  expect(response.statusCode).toBe(403);
});
test("self request rejects another actor/physical cursor fields", async () => {
  expect((await self("cook", { staffId: "waiter" })).statusCode).toBe(400);
  expect((await self("cook", { cursor: "invalid" })).statusCode).toBe(400);
});
