import { RestaurantStaffIdentityService as Identity } from "@/lambda/shared/services/restaurant-staff-identity-service";
import {
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { RestaurantStaffService as S } from "@/lambda/domains/restaurants/staff-service";
import { RestaurantStaffRepository as R } from "@/lambda/domains/restaurants/staff-repository";
import { RestaurantsService as Config } from "@/lambda/domains/restaurants/restaurant-service";
import { restaurantStaffHandler } from "@/lambda/domains/restaurants/staff-handler";
import { RESTAURANT_STAFF_ROUTES } from "@/lambda/domains/restaurants/staff-routes";
import { DomainAuthorizationService } from "@/lambda/shared/services/domain-authorization-service";
import { RESTAURANTS_TRANSACTION_PERMISSIONS } from "@liass-ohada/shared/shared";
import { fixtureId, memoryDynamo } from "./memory-dynamo";

let m: ReturnType<typeof memoryDynamo>;
let outlets: string[];
let sequence: number;
const org = "staff-org",
  user = "user-a";
const req = () => fixtureId(++sequence);
const put = (item: Record<string, unknown>) => {
  const raw = marshall(item, { removeUndefinedValues: true });
  m.rows.set(JSON.stringify([item.PK, item.SK]), raw);
};
const patch = (PK: string, SK: string, values: Record<string, unknown>) => {
  const key = JSON.stringify([PK, SK]);
  put({ ...unmarshall(m.rows.get(key)!), ...values });
};
function seedSubject(
  id = user,
  tenant = org,
  role = "WAITER",
  name = "Aïssatou S.",
) {
  m.seedAccess(tenant, id, role);
  put({
    PK: K.userProfilePK(id),
    SK: K.userProfileSK(),
    entityType: "USER_PROFILE",
    userId: id,
    email: "person@example.com",
    normalizedEmail: "person@example.com",
    emailVerified: true,
    displayName: name,
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
    lastSyncedFromIdentityAt: "2026-10-10T00:00:00.000Z",
  });
}
const bind = (id = user, input: object = {}) =>
  S.mutate(org, "owner", id, "BIND", {
    memberUserId: id,
    clientRequestId: req(),
    ...input,
  });
const assign = (outletId = outlets[0], input: object = {}, id = user) =>
  S.mutate(
    org,
    "owner",
    id,
    "ASSIGN",
    { clientRequestId: req(), ...input },
    outletId,
  );
const update = (input: object) =>
  S.mutate(org, "owner", user, "UPDATE", { clientRequestId: req(), ...input });
const unassign = (input: object = {}) =>
  S.mutate(
    org,
    "owner",
    user,
    "UNASSIGN",
    { clientRequestId: req(), expectedVersion: 1, ...input },
    outlets[0],
  );
async function call(
  name: string,
  body: object = {},
  actor = "owner",
  paths: object = {},
  query: object = {},
  tenant = org,
) {
  return restaurantStaffHandler(name)({
    headers: { "x-org-id": tenant, "accept-language": "en" },
    body: JSON.stringify(body),
    pathParameters: paths,
    queryStringParameters: query,
    requestContext: { authorizer: { jwt: { claims: { sub: actor } } } },
  });
}
beforeEach(async () => {
  m = memoryDynamo();
  sequence = 0;
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  m.seedAccess(org, "owner", "OWNER");
  m.seedAccess(org, "manager", "MANAGER");
  seedSubject();
  await Config.create(
    org,
    "owner",
    "restaurant",
    {},
    { name: "Resto", clientRequestId: req() },
  );
  outlets = [];
  for (const name of ["Agla", "Cotonou"])
    outlets.push(
      (
        await Config.create(
          org,
          "owner",
          "outlet",
          {},
          { name, clientRequestId: req() },
        )
      ).id,
    );
  m.db.resetHistory();
});
afterEach(() => {
  m.db.restore();
  jest.restoreAllMocks();
});

test("binds an existing platform member, joins canonical role/name and exposes only the strict DTO", async () => {
  const response = await call("bind-staff", {
    memberUserId: user,
    clientRequestId: req(),
  });
  expect(response.statusCode).toBe(200);
  const dto = c.RestaurantStaffResponseSchema.parse(
    JSON.parse(response.body),
  ).data;
  expect(dto).toMatchObject({
    userId: user,
    displayName: "Aïssatou S.",
    restaurantRole: "WAITER",
    status: "ACTIVE",
    version: 1,
    organizationMembershipActive: true,
  });
  expect(JSON.stringify(dto)).not.toMatch(
    /email|provider|cognito|PK|SK|token/i,
  );
  const stored = [...m.rows.values()]
    .map((row) => unmarshall(row))
    .find((row) => row.entityType === "RESTAURANT_STAFF")!;
  expect(stored.data).not.toHaveProperty("restaurantRole");
  expect(stored.data).not.toHaveProperty("displayName");
});
test.each([
  "missing",
  "foreign",
  "inactive",
  "roleless",
  "invalid-role",
  "cabinet",
])("rejects %s staff subject", async (kind) => {
  const id = kind === "missing" || kind === "foreign" ? "another" : user;
  if (kind === "foreign") seedSubject(id, "foreign-org");
  if (kind === "inactive")
    patch(K.orgKey(org), K.orgUserAccessSK(user), { status: "INACTIVE" });
  if (kind === "roleless")
    patch(K.orgKey(org), K.orgUserAccessSK(user), { productRoles: {} });
  if (kind === "invalid-role")
    patch(K.orgKey(org), K.orgUserAccessSK(user), {
      productRoles: { RESTAURANTS: "ADMIN" },
    });
  if (kind === "cabinet")
    patch(K.orgKey(org), K.orgUserAccessSK(user), { accessSource: "CABINET" });
  await expect(bind(id)).rejects.toMatchObject({ statusCode: 403 });
  expect(m.db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});
test("missing or inactive ProductAccess denies administration", async () => {
  const key = JSON.stringify([K.orgKey(org), K.productAccessSK("RESTAURANTS")]);
  const saved = m.rows.get(key)!;
  m.rows.delete(key);
  expect((await call("list-staff")).statusCode).toBe(403);
  await expect(bind()).rejects.toMatchObject({
    messageCode: "PRODUCT_ACCESS_REQUIRED",
  });
  m.rows.set(key, saved);
  patch(K.orgKey(org), K.productAccessSK("RESTAURANTS"), {
    status: "INACTIVE",
  });
  await expect(bind()).rejects.toMatchObject({
    messageCode: "PRODUCT_ACCESS_REQUIRED",
  });
});
test("durable binding replay survives lifecycle changes, duplicate/new intent is rejected", async () => {
  const id = req();
  const first = await bind(user, { clientRequestId: id });
  expect(await bind(user, { clientRequestId: id })).toEqual(first);
  await expect(bind()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_STAFF_EXISTS",
  });
  await expect(
    bind(user, { clientRequestId: id, operationalLabel: "Ali" }),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_IDEMPOTENCY_CONFLICT" });
  await update({ expectedVersion: 1, status: "INACTIVE" });
  expect(await bind(user, { clientRequestId: id })).toEqual(first);
  expect((await S.get(org, user)).version).toBe(2);
});
test("versioned deactivate/reactivate gates retained assignments and preserves history", async () => {
  await bind();
  await assign();
  expect(await S.isActivelyAssigned(org, user, outlets[0])).toBe(true);
  await update({ expectedVersion: 1, status: "INACTIVE" });
  expect(await S.isActivelyAssigned(org, user, outlets[0])).toBe(false);
  await expect(assign(outlets[1])).rejects.toMatchObject({
    messageCode: "RESTAURANTS_STAFF_INACTIVE",
  });
  await expect(
    update({ expectedVersion: 1, status: "ACTIVE" }),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_WRITE_CONFLICT" });
  await update({ expectedVersion: 2, status: "ACTIVE" });
  expect(await S.isActivelyAssigned(org, user, outlets[0])).toBe(true);
});
test("assigns multiple outlets; paginated adjacency works in both directions", async () => {
  await bind();
  await assign();
  await assign(outlets[1]);
  const page = await S.staffOutlets(org, user, { limit: 1 });
  expect(page.items).toHaveLength(1);
  expect(page.nextCursor).toBeDefined();
  const next = await S.staffOutlets(org, user, {
    limit: 1,
    cursor: page.nextCursor,
  });
  expect(next.items).toHaveLength(1);
  expect(next.items[0].outletId).not.toBe(page.items[0].outletId);
  const staff = await S.outletStaff(org, outlets[0], {});
  expect(staff.items).toHaveLength(1);
  expect(staff.items[0].staff.restaurantRole).toBe("WAITER");
  expect(staff.items[0].assignment.status).toBe("ACTIVE");
});
test("assignment replay, duplicates, unassignment and explicit versioned reassignment", async () => {
  await bind();
  const id = req();
  const result = await assign(outlets[0], { clientRequestId: id });
  expect(await assign(outlets[0], { clientRequestId: id })).toEqual(result);
  await expect(assign()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_STAFF_ASSIGNMENT_EXISTS",
  });
  await expect(unassign({ expectedVersion: 2 })).rejects.toMatchObject({
    messageCode: "RESTAURANTS_WRITE_CONFLICT",
  });
  await unassign();
  expect(await S.isActivelyAssigned(org, user, outlets[0])).toBe(false);
  expect(
    (await S.outletStaff(org, outlets[0], {})).items[0].assignment.status,
  ).toBe("INACTIVE");
  await expect(assign()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_WRITE_CONFLICT",
  });
  expect(await assign(outlets[0], { expectedVersion: 2 })).toMatchObject({
    version: 3,
    status: "ACTIVE",
  });
  expect(await S.isActivelyAssigned(org, user, outlets[0])).toBe(true);
});
test("inactive outlet rejects new assignment, foreign outlet rejects assignment and listing", async () => {
  await bind();
  await Config.update(
    org,
    "owner",
    "outlet",
    {},
    outlets[0],
    { expectedVersion: 1 },
    "deactivate",
  );
  await expect(assign()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_PARENT_INACTIVE",
  });
  await Config.create(
    "foreign-org",
    "owner",
    "restaurant",
    {},
    { name: "Foreign", clientRequestId: req() },
  );
  const other = await Config.create(
    "foreign-org",
    "owner",
    "outlet",
    {},
    { name: "Foreign", clientRequestId: req() },
  );
  await expect(assign(other.id)).rejects.toMatchObject({ statusCode: 404 });
  await expect(S.outletStaff(org, other.id, {})).rejects.toMatchObject({
    statusCode: 404,
  });
  expect(await S.isActivelyAssigned(org, user, other.id)).toBe(false);
});
test("tenant directory pagination is bounded, cursor scope cannot cross tenant/outlet/user/list type", async () => {
  await bind();
  seedSubject("user-b");
  await bind("user-b");
  const page = await S.list(org, { limit: 1 });
  expect(page.items).toHaveLength(1);
  expect(
    (await S.list(org, { limit: 1, cursor: page.nextCursor })).items,
  ).toHaveLength(1);
  expect((await S.list("foreign-org", {})).items).toEqual([]);
  await expect(
    S.list("foreign-org", { cursor: page.nextCursor }),
  ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
  await expect(
    S.staffOutlets(org, user, { cursor: page.nextCursor }),
  ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
  await expect(S.list(org, { cursor: "invalid" })).rejects.toMatchObject({
    messageCode: "ERROR_INVALID_CURSOR",
  });
  await assign();
  await assign(outlets[1]);
  const outletsPage = await S.staffOutlets(org, user, { limit: 1 });
  await expect(
    S.staffOutlets(org, "user-b", { cursor: outletsPage.nextCursor }),
  ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
  await expect(
    S.outletStaff(org, outlets[0], { cursor: outletsPage.nextCursor }),
  ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
  for (const query of m.db.commandCalls(QueryCommand)) {
    expect(query.args[0].input.Limit).toBeLessThanOrEqual(100);
    expect(query.args[0].input.FilterExpression).toBeUndefined();
    expect(query.args[0].input.IndexName).toBeUndefined();
  }
  expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
});
test.each(["OWNER", "MANAGER"])(
  "%s administers without retroactive staff records",
  async (role) => {
    const actor = role.toLowerCase();
    expect(
      (
        await call(
          "bind-staff",
          { memberUserId: user, clientRequestId: req() },
          actor,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await call("get-staff", {}, actor, { memberUserId: user })).statusCode,
    ).toBe(200);
    expect((await call("list-staff", {}, actor)).statusCode).toBe(200);
    expect(await R.get(org, R.staffKey(org, actor), "STAFF")).toBeUndefined();
  },
);
test.each(["WAITER", "CASHIER", "KITCHEN"])(
  "%s cannot administer any staff route and gains no transaction rights",
  async (role) => {
    seedSubject("operational", org, role);
    await bind("operational");
    await assign(outlets[0], {}, "operational");
    for (const route of RESTAURANT_STAFF_ROUTES) {
      if ("query" in route && route.query === "MY_OUTLETS") continue;
      const body =
        "command" in route
          ? route.command === "BIND"
            ? { memberUserId: user, clientRequestId: req() }
            : route.command === "UPDATE"
              ? {
                  clientRequestId: req(),
                  expectedVersion: 1,
                  status: "INACTIVE",
                }
              : route.command === "ASSIGN"
                ? { clientRequestId: req() }
                : { clientRequestId: req(), expectedVersion: 1 }
          : {};
      const paths = {
        ...(route.path.includes("{memberUserId}")
          ? { memberUserId: user }
          : {}),
        ...(route.path.includes("{outletId}") ? { outletId: outlets[0] } : {}),
      };
      expect(
        (await call(route.name, body, "operational", paths)).statusCode,
      ).toBe(403);
    }
    const permissions =
      DomainAuthorizationService.permissionsForRestaurantsRole(role);
    expect(
      permissions.some((permission) =>
        RESTAURANTS_TRANSACTION_PERMISSIONS.includes(
          permission as (typeof RESTAURANTS_TRANSACTION_PERMISSIONS)[number],
        ),
      ),
    ).toBe(false);
  },
);
test("inactive actor and foreign tenant header deny administration", async () => {
  patch(K.orgKey(org), K.orgUserAccessSK("owner"), { status: "INACTIVE" });
  expect((await call("list-staff")).statusCode).toBe(403);
  expect(
    (await call("list-staff", {}, "manager", {}, {}, "foreign-org")).statusCode,
  ).toBe(403);
});
test("audit is atomic, reconstructs actor/subject/outlet/before-after, and no history is deleted", async () => {
  await bind();
  await update({ expectedVersion: 1, operationalLabel: "Aïssa" });
  await assign();
  await unassign();
  const audits = [...m.rows.values()]
    .map((row) => unmarshall(row))
    .filter((row) => row.entityType === "RESTAURANT_STAFF_AUDIT");
  expect(audits).toHaveLength(4);
  expect(audits.map((row) => row.data.action)).toEqual([
    "BIND",
    "UPDATE",
    "ASSIGN",
    "UNASSIGN",
  ]);
  expect(audits[1].data).toMatchObject({
    actorId: "owner",
    userId: user,
    before: { version: 1 },
    after: { version: 2, operationalLabel: "Aïssa" },
  });
  expect(audits[3].data).toMatchObject({
    outletId: outlets[0],
    before: { status: "ACTIVE" },
    after: { status: "INACTIVE" },
  });
  for (const tx of m.transactions.slice(-4)) {
    expect(
      tx.TransactItems?.some(
        (action) => action.Put?.Item?.entityType.S === "RESTAURANT_STAFF_AUDIT",
      ),
    ).toBe(true);
    expect(
      tx.TransactItems?.some(
        (action) =>
          action.Put?.Item?.entityType.S === "RESTAURANT_STAFF_COMMAND",
      ),
    ).toBe(true);
    expect(tx.TransactItems?.some((action) => action.Delete)).toBe(false);
    expect(
      tx.TransactItems?.filter((action) =>
        action.ConditionCheck?.TableName?.includes("accounting"),
      ).length,
    ).toBeGreaterThanOrEqual(2);
  }
});
test("canonical role/name changes are read live, inactive identity and entitlement fail assignment check closed", async () => {
  await bind();
  await assign();
  patch(K.userProfilePK(user), K.userProfileSK(), {
    displayName: "Aïssatou D.",
  });
  patch(K.orgKey(org), K.orgUserAccessSK(user), {
    productRoles: { RESTAURANTS: "CASHIER" },
  });
  expect(await S.dto(org, await S.get(org, user))).toMatchObject({
    restaurantRole: "CASHIER",
    displayName: "Aïssatou D.",
  });
  m.db.resetHistory();
  expect(await S.isActivelyAssigned(org, user, outlets[0])).toBe(true);
  expect(m.db.commandCalls(GetItemCommand)).toHaveLength(6);
  expect(m.db.commandCalls(QueryCommand)).toHaveLength(0);
  patch(K.orgKey(org), K.orgUserAccessSK(user), { status: "INACTIVE" });
  expect(await S.isActivelyAssigned(org, user, outlets[0])).toBe(false);
  expect(
    (await S.dto(org, await S.get(org, user))).organizationMembershipActive,
  ).toBe(false);
  // Security cleanup remains possible even after upstream membership revocation.
  await update({ expectedVersion: 1, status: "INACTIVE" });
  await unassign();
  await expect(
    update({ expectedVersion: 2, status: "ACTIVE" }),
  ).rejects.toMatchObject({ statusCode: 403 });
});
test.each(["person@example.com", user, fixtureId(999)])(
  "unsafe canonical label %s never becomes an operational name",
  async (name) => {
    patch(K.userProfilePK(user), K.userProfileSK(), { displayName: name });
    await expect(bind()).rejects.toMatchObject({
      messageCode: "RESTAURANTS_STAFF_LABEL_REQUIRED",
    });
    await bind(user, { operationalLabel: "Aïssatou S." });
    expect((await S.dto(org, await S.get(org, user))).displayName).toBe(
      "Aïssatou S.",
    );
    await expect(
      update({ expectedVersion: 1, operationalLabel: null }),
    ).rejects.toMatchObject({
      messageCode: "RESTAURANTS_STAFF_LABEL_REQUIRED",
    });
  },
);
test("label can be explicitly cleared to canonical name, concurrent update loses no data", async () => {
  await bind(user, { operationalLabel: "Aïssa" });
  await update({ expectedVersion: 1, operationalLabel: null });
  expect((await S.dto(org, await S.get(org, user))).displayName).toBe(
    "Aïssatou S.",
  );
  const results = await Promise.allSettled([
    update({ expectedVersion: 2, operationalLabel: "Name A" }),
    update({ expectedVersion: 2, operationalLabel: "Name B" }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect((await S.get(org, user)).version).toBe(3);
});
test("simultaneous identical command converges to one audit and one version", async () => {
  const id = req();
  const results = await Promise.all([
    bind(user, { clientRequestId: id }),
    bind(user, { clientRequestId: id }),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(
    [...m.rows.values()]
      .map((row) => unmarshall(row))
      .filter((row) => row.entityType === "RESTAURANT_STAFF_AUDIT"),
  ).toHaveLength(1);
});
test("platform membership revocation between read and commit cancels the entire write", async () => {
  const commit = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    patch(K.orgKey(org), K.orgUserAccessSK(user), { status: "INACTIVE" });
    return commit(actions);
  });
  await expect(bind()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_WRITE_CONFLICT",
  });
  expect(await R.get(org, R.staffKey(org, user), "STAFF")).toBeUndefined();
  expect(
    [...m.rows.values()]
      .map((row) => unmarshall(row))
      .filter((row) => row.entityType === "RESTAURANT_STAFF_AUDIT"),
  ).toEqual([]);
});
test("outlet deactivation between read and commit cancels both projections", async () => {
  await bind();
  const commit = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    await Config.update(
      org,
      "owner",
      "outlet",
      {},
      outlets[0],
      { expectedVersion: 1 },
      "deactivate",
    );
    return commit(actions);
  });
  await expect(assign()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_WRITE_CONFLICT",
  });
  for (const key of R.assignmentKeys(org, user, outlets[0]))
    expect(await R.get(org, key, "ASSIGNMENT")).toBeUndefined();
});
test.each([
  { role: "OWNER" },
  { productRoles: { RESTAURANTS: "OWNER" } },
  { password: "secret" },
  { email: "test@example.com" },
  { operationalLabel: "test@example.com" },
  { outletIds: [fixtureId(1)] },
])("strict binding schema rejects unauthorized fields: %j", async (extra) => {
  expect(
    (
      await call("bind-staff", {
        memberUserId: user,
        clientRequestId: req(),
        ...extra,
      })
    ).statusCode,
  ).toBe(400);
});
test("strict lifecycle and assignment schemas reject missing versions and HR statuses", async () => {
  expect(
    c.UpdateRestaurantStaffRequestSchema.safeParse({
      clientRequestId: req(),
      expectedVersion: 1,
    }).success,
  ).toBe(false);
  expect(
    c.UpdateRestaurantStaffRequestSchema.safeParse({
      clientRequestId: req(),
      expectedVersion: 1,
      status: "VACATION",
    }).success,
  ).toBe(false);
  expect(
    c.UnassignRestaurantStaffOutletRequestSchema.safeParse({
      clientRequestId: req(),
    }).success,
  ).toBe(false);
  expect(
    c.AssignRestaurantStaffOutletRequestSchema.safeParse({
      clientRequestId: req(),
      role: "WAITER",
    }).success,
  ).toBe(false);
  expect(
    c.RestaurantStaffResponseSchema.safeParse({ data: { PK: "private" } })
      .success,
  ).toBe(false);
});

test("management HTTP routes return validated assignment/lifecycle DTOs", async () => {
  await bind();
  const paths = { memberUserId: user, outletId: outlets[0] };
  expect(
    (
      await call(
        "assign-staff-outlet",
        { clientRequestId: req() },
        "manager",
        paths,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (await call("list-staff-outlets", {}, "manager", { memberUserId: user }))
      .statusCode,
  ).toBe(200);
  expect(
    (await call("list-outlet-staff", {}, "manager", { outletId: outlets[0] }))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await call(
        "unassign-staff-outlet",
        { clientRequestId: req(), expectedVersion: 1 },
        "manager",
        paths,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await call(
        "update-staff",
        { clientRequestId: req(), expectedVersion: 1, status: "INACTIVE" },
        "manager",
        { memberUserId: user },
      )
    ).statusCode,
  ).toBe(200);
});
test("binding oneself deduplicates Platform guards without losing management authorization", async () => {
  const result = await bind("owner", { operationalLabel: "Owner" });
  expect(result.userId).toBe("owner");
  const guards = m.transactions
    .at(-1)!
    .TransactItems!.filter((action) => action.ConditionCheck);
  expect(guards).toHaveLength(3); // one membership, ProductAccess and active organization
});
test("ProductAccess loss, role loss and outlet deactivation each fail the assignment prerequisite closed", async () => {
  await bind();
  await assign();
  patch(K.orgKey(org), K.orgUserAccessSK(user), { productRoles: {} });
  expect(await S.isActivelyAssigned(org, user, outlets[0])).toBe(false);
  patch(K.orgKey(org), K.orgUserAccessSK(user), {
    productRoles: { RESTAURANTS: "WAITER" },
  });
  patch(K.orgKey(org), K.productAccessSK("RESTAURANTS"), {
    status: "INACTIVE",
  });
  expect(await S.isActivelyAssigned(org, user, outlets[0])).toBe(false);
  patch(K.orgKey(org), K.productAccessSK("RESTAURANTS"), { status: "ACTIVE" });
  await Config.update(
    org,
    "owner",
    "outlet",
    {},
    outlets[0],
    { expectedVersion: 1 },
    "deactivate",
  );
  expect(await S.isActivelyAssigned(org, user, outlets[0])).toBe(false);
});
test("tampered stored staff/assignment identities cannot escape DTO mapping", async () => {
  await bind();
  await assign();
  const staffKey = R.staffKey(org, user);
  const raw = m.rows.get(JSON.stringify([staffKey.PK, staffKey.SK]))!;
  const previous = unmarshall(raw);
  patch(staffKey.PK, staffKey.SK, {
    data: { ...previous.data, userId: "foreign-user" },
  });
  await expect(S.get(org, user)).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_INTEGRITY",
  });
  put(previous);
  const assignmentKey = R.assignmentKeys(org, user, outlets[0])[0];
  const assignment = unmarshall(
    m.rows.get(JSON.stringify([assignmentKey.PK, assignmentKey.SK]))!,
  );
  patch(assignmentKey.PK, assignmentKey.SK, {
    data: { ...assignment.data, outletId: outlets[1] },
  });
  await expect(
    S.isActivelyAssigned(org, user, outlets[0]),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_TRANSACTION_INTEGRITY" });
});

test("self-binding cannot commit after the actor is demoted between identity snapshots", async () => {
  const get = Identity.get.bind(Identity);
  let captured = false;
  jest.spyOn(Identity, "get").mockImplementation(async (tenant, id) => {
    const identity = await get(tenant, id);
    if (id === "owner" && !captured) {
      captured = true;
      patch(K.orgKey(org), K.orgUserAccessSK("owner"), {
        productRoles: { RESTAURANTS: "WAITER" },
      });
    }
    return identity;
  });
  await expect(
    bind("owner", { operationalLabel: "Owner" }),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_WRITE_CONFLICT" });
  expect(await R.get(org, R.staffKey(org, "owner"), "STAFF")).toBeUndefined();
});
test("lifecycle and unassignment retries are durable, version checks do not repeat the write", async () => {
  await bind();
  await assign();
  const id = req();
  const first = await update({
    expectedVersion: 1,
    status: "INACTIVE",
    clientRequestId: id,
  });
  expect(
    await update({
      expectedVersion: 1,
      status: "INACTIVE",
      clientRequestId: id,
    }),
  ).toEqual(first);
  const unassignId = req();
  const removed = await unassign({ clientRequestId: unassignId });
  expect(await unassign({ clientRequestId: unassignId })).toEqual(removed);
  expect(
    [...m.rows.values()]
      .map((row) => unmarshall(row))
      .filter((row) => row.entityType === "RESTAURANT_STAFF_AUDIT"),
  ).toHaveLength(4);
});
test("outlet staff pagination includes retained inactive staff/assignments for management", async () => {
  await bind();
  await assign();
  seedSubject("user-b");
  await bind("user-b");
  await assign(outlets[0], {}, "user-b");
  await update({ expectedVersion: 1, status: "INACTIVE" });
  await unassign();
  const first = await S.outletStaff(org, outlets[0], { limit: 1 });
  const second = await S.outletStaff(org, outlets[0], {
    limit: 1,
    cursor: first.nextCursor,
  });
  expect(first.items[0]).toMatchObject({
    staff: { userId: user, status: "INACTIVE" },
    assignment: { status: "INACTIVE" },
  });
  expect(second.items[0].staff.userId).toBe("user-b");
  expect(second.nextCursor).toBeUndefined();
  await expect(
    S.outletStaff(org, outlets[1], { cursor: first.nextCursor }),
  ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
});

test("a mismatched canonical profile cannot leak another person's display name", async () => {
  patch(K.userProfilePK(user), K.userProfileSK(), {
    userId: "someone-else",
    displayName: "Private person",
  });
  await expect(bind()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_STAFF_LABEL_REQUIRED",
  });
  await bind(user, { operationalLabel: "Aïssa" });
  expect((await S.dto(org, await S.get(org, user))).displayName).toBe("Aïssa");
});
