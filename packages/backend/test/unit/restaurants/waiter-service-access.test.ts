import {
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  BatchGetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { DomainAuthorizationService as Auth } from "@/lambda/shared/services/domain-authorization-service";
import { RestaurantStaffIdentityService as Identity } from "@/lambda/shared/services/restaurant-staff-identity-service";
import { RestaurantTransactionsService as S } from "@/lambda/domains/restaurants/transaction-service";
import { RestaurantTransactionsRepository as R } from "@/lambda/domains/restaurants/transaction-repository";
import { RestaurantStaffService as Staff } from "@/lambda/domains/restaurants/staff-service";
import { RestaurantStaffRepository as SR } from "@/lambda/domains/restaurants/staff-repository";
import { RestaurantsService as Config } from "@/lambda/domains/restaurants/restaurant-service";
import { RestaurantServiceAccess as Access } from "@/lambda/domains/restaurants/service-access";
import { restaurantTransactionHandler } from "@/lambda/domains/restaurants/transaction-handler";
import { restaurantStaffHandler } from "@/lambda/domains/restaurants/staff-handler";
import { RESTAURANT_TRANSACTION_ROUTES } from "@/lambda/domains/restaurants/transaction-routes";
import { acceptanceFixture } from "./acceptance-fixture";
import { memoryDynamo, fixtureId } from "./memory-dynamo";
let m: ReturnType<typeof memoryDynamo>,
  f: Awaited<ReturnType<typeof acceptanceFixture>>,
  seq: number;
const org = "org-resto";
const req = () => fixtureId(++seq);
const rows = () => [...m.rows.values()].map((raw) => unmarshall(raw));
const put = (row: Record<string, unknown>) =>
  m.rows.set(
    JSON.stringify([row.PK, row.SK]),
    marshall(row, { removeUndefinedValues: true }),
  );
const patch = (
  key: { PK: string; SK: string },
  value: Record<string, unknown>,
) =>
  put({
    ...unmarshall(m.rows.get(JSON.stringify([key.PK, key.SK]))!),
    ...value,
  });
const scope = () => ({ orgId: org, outletId: f.outlet.id, actorId: "Aissa" });
const body = (index = 0) => ({
  clientRequestId: req(),
  tableId: f.tables[index].id,
  areaId: f.tables[index].serviceAreaId,
});
async function person(id: string, role = "WAITER", assigned = true) {
  m.seedAccess(org, id, role);
  put({
    PK: K.userProfilePK(id),
    SK: K.userProfileSK(),
    entityType: "USER_PROFILE",
    userId: id,
    email: "hidden@example.com",
    normalizedEmail: "hidden@example.com",
    emailVerified: true,
    displayName: `${id} S.`,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    lastSyncedFromIdentityAt: "2026-10-15T00:00:00.000Z",
  });
  await Staff.mutate(org, "owner", id, "BIND", {
    clientRequestId: req(),
    memberUserId: id,
  });
  if (assigned)
    await Staff.mutate(
      org,
      "owner",
      id,
      "ASSIGN",
      { clientRequestId: req() },
      f.outlet.id,
    );
}
function call(
  name: string,
  actor = "Aissa",
  input: object = {},
  outletId = f.outlet.id,
  tenant = org,
  ids: object = {},
  query: object = {},
) {
  return restaurantTransactionHandler(name)({
    headers: { "x-org-id": tenant, "accept-language": "en" },
    body: JSON.stringify(input),
    pathParameters: { outletId, ...ids },
    queryStringParameters: query,
    requestContext: { authorizer: { jwt: { claims: { sub: actor } } } },
  });
}
function self(actor = "Aissa", query: object = {}) {
  return restaurantStaffHandler("my-service-outlets")({
    headers: { "x-org-id": org },
    queryStringParameters: query,
    requestContext: { authorizer: { jwt: { claims: { sub: actor } } } },
  });
}
beforeEach(async () => {
  m = memoryDynamo();
  seq = 8000;
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  f = await acceptanceFixture();
  m.seedAccess(org, "owner", "OWNER");
  m.seedAccess(org, "manager", "MANAGER");
  await person("Aissa");
  await person("Binta");
});
afterEach(() => {
  m.db.restore();
  jest.restoreAllMocks();
});

test("assigned waiter reads all outlet tables without claiming and opens atomically as self", async () => {
  const management = await call("open-session", "owner", body(1));
  expect(management.statusCode).toBe(200);
  const count = rows().length;
  expect((await call("service-floor")).statusCode).toBe(200);
  expect(rows()).toHaveLength(count);
  const response = await call("open-session", "Aissa", body());
  expect(response.statusCode).toBe(200);
  const session = c.GuestSessionResponseSchema.parse(
    JSON.parse(response.body),
  ).data;
  expect(session).toMatchObject({
    openedBy: "Aissa",
    responsibleStaff: {
      staffId: "Aissa",
      displayName: "Aissa S.",
      available: true,
    },
    version: 1,
  });
  expect(session).not.toHaveProperty("partySize");
  const transaction = m.transactions.at(-1)!;
  const stored = transaction.TransactItems!.find(
    (op) => op.Put?.Item?.entityType.S === "RESTAURANT_GUEST_SESSION",
  )!;
  expect(unmarshall(stored.Put!.Item!).data).toMatchObject({
    openedBy: "Aissa",
    responsibleStaffId: "Aissa",
  });
  expect(transaction.TransactItems).toHaveLength(17);
  expect(transaction.TransactItems!.filter((op) => op.Put)).toHaveLength(8);
  const audit = rows().find(
    (r) =>
      r.entityType === "RESTAURANT_TRANSACTION_AUDIT" &&
      r.data.targetId === session.guestSessionId,
  );
  expect(audit?.data).toMatchObject({
    actorId: "Aissa",
    action: "OPEN_SESSION",
    responsibility: {
      tableId: session.tableId,
      before: null,
      after: "Aissa",
      afterDisplayName: "Aissa S.",
    },
  });
  const before = rows().length;
  const floor = c.RestaurantServiceFloorResponseSchema.parse(
    JSON.parse((await call("service-floor", "Binta")).body),
  );
  expect(rows()).toHaveLength(before);
  expect(floor.items.some((t) => t.state === "FREE")).toBe(true);
  expect(floor.items.find((t) => t.tableId === session.tableId)).toMatchObject({
    responsibleStaff: session.responsibleStaff,
  });
  expect(
    floor.items.find((t) => t.tableId === f.tables[1].id),
  ).not.toHaveProperty("responsibleStaff");
});
test.each(["OWNER", "MANAGER"])(
  "%s opens without staff binding or automatic responsibility",
  async (role) => {
    const actor = role === "OWNER" ? "owner" : "manager";
    expect((await call("service-floor", actor)).statusCode).toBe(200);
    const result = await call("open-session", actor, body());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).data).toMatchObject({ openedBy: actor });
    expect(JSON.parse(result.body).data).not.toHaveProperty("responsibleStaff");
  },
);
test.each(["CASHIER", "KITCHEN"])(
  "%s remains denied despite active staff and outlet",
  async (role) => {
    await person("other", role);
    expect((await call("service-floor", "other")).statusCode).toBe(403);
    expect((await call("open-session", "other", body())).statusCode).toBe(403);
    expect((await self("other")).statusCode).toBe(403);
  },
);
test.each([
  "staff",
  "assignment",
  "membership",
  "product",
  "role",
  "missing-staff",
  "foreign-org",
  "inactive-outlet",
])("rejects floor/open after %s invalidation", async (change) => {
  if (change === "staff")
    await Staff.mutate(org, "owner", "Aissa", "UPDATE", {
      clientRequestId: req(),
      expectedVersion: 1,
      status: "INACTIVE",
    });
  if (change === "assignment")
    await Staff.mutate(
      org,
      "owner",
      "Aissa",
      "UNASSIGN",
      { clientRequestId: req(), expectedVersion: 1 },
      f.outlet.id,
    );
  if (change === "membership")
    patch(
      { PK: K.orgKey(org), SK: K.orgUserAccessSK("Aissa") },
      { status: "INACTIVE" },
    );
  if (change === "product")
    m.rows.delete(
      JSON.stringify([K.orgKey(org), K.productAccessSK("RESTAURANTS")]),
    );
  if (change === "role") m.seedAccess(org, "Aissa", "CASHIER");
  if (change === "missing-staff")
    m.rows.delete(JSON.stringify(Object.values(SR.staffKey(org, "Aissa"))));
  if (change === "inactive-outlet")
    await Config.update(
      org,
      "owner",
      "outlet",
      {},
      f.outlet.id,
      { expectedVersion: 1 },
      "deactivate",
    );
  const tenant = change === "foreign-org" ? "foreign" : org;
  expect(
    (await call("service-floor", "Aissa", {}, f.outlet.id, tenant)).statusCode,
  ).toBe(403);
  expect(
    (await call("open-session", "Aissa", body(), f.outlet.id, tenant))
      .statusCode,
  ).toBe(403);
});
test("multiple active outlet assignments are independent; another outlet remains forbidden", async () => {
  const b = await Config.create(
    org,
    "owner",
    "outlet",
    {},
    { name: "Fidjrossè", clientRequestId: req() },
  );
  const c = await Config.create(
    org,
    "owner",
    "outlet",
    {},
    { name: "Calavi", clientRequestId: req() },
  );
  await Staff.mutate(
    org,
    "owner",
    "Aissa",
    "ASSIGN",
    { clientRequestId: req() },
    b.id,
  );
  expect((await call("service-floor", "Aissa", {}, b.id)).statusCode).toBe(200);
  expect((await call("service-floor", "Aissa", {}, c.id)).statusCode).toBe(403);
  expect((await call("open-session", "Aissa", body(), c.id)).statusCode).toBe(
    403,
  );
});
test.each(["staffId", "waiterId", "responsibleStaffId"])(
  "rejects forged %s in opening",
  async (field) => {
    expect(
      (await call("open-session", "Aissa", { ...body(), [field]: "Binta" }))
        .statusCode,
    ).toBe(400);
  },
);
test("ignores forged user/tenant context and never impersonates another employee", async () => {
  const result = await call("open-session", "Aissa", {
    ...body(),
    userId: "Binta",
    orgId: "foreign",
  });
  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body).data).toMatchObject({
    openedBy: "Aissa",
    responsibleStaff: { staffId: "Aissa" },
  });
});
test("foreign staff persistence identity is rejected", async () => {
  patch(SR.staffKey(org, "Aissa"), { orgId: "foreign" });
  expect((await call("open-session", "Aissa", body())).statusCode).not.toBe(
    200,
  );
});
test("all historical/order/close/responsibility commands remain denied to an assigned waiter", async () => {
  const s = c.GuestSessionResponseSchema.parse(
    JSON.parse((await call("open-session", "Aissa", body())).body),
  ).data;
  const writes: Record<string, object> = {
    CLOSE_SESSION: { clientRequestId: req(), expectedVersion: 1 },
    REPLACE_RESPONSIBLE_STAFF: {
      clientRequestId: req(),
      expectedVersion: 1,
      staffId: "Binta",
    },
    CREATE_ORDER: { clientRequestId: req(), orderType: "COUNTER" },
  };
  for (const route of RESTAURANT_TRANSACTION_ROUTES) {
    if (route.name === "service-floor" || route.name === "open-session")
      continue;
    expect(Auth.permissionsForRestaurantsRole("WAITER")).not.toContain(
      route.permission,
    );
    if ("query" in route || ("command" in route && writes[route.command])) {
      const paths = Object.fromEntries(
        [...route.path.matchAll(/\{(\w+)\}/g)]
          .filter((match) => match[1] !== "outletId")
          .map((match) => [
            match[1],
            match[1] === "sessionId"
              ? s.guestSessionId
              : match[1] === "tableId"
                ? s.tableId
                : fixtureId(9100),
          ]),
      );
      const query =
        "query" in route && route.query.endsWith("HISTORY")
          ? {
              start: "2026-10-15T00:00:00.000Z",
              end: "2026-10-16T00:00:00.000Z",
            }
          : {};
      const result = await call(
        route.name,
        "Aissa",
        "command" in route ? writes[route.command] : {},
        f.outlet.id,
        org,
        paths,
        query,
      );
      expect(result.statusCode).toBe(403);
    }
  }
  expect(
    (
      await call(
        "replace-responsible-staff",
        "Aissa",
        writes.REPLACE_RESPONSIBLE_STAFF,
        f.outlet.id,
        org,
        { sessionId: s.guestSessionId },
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await call(
        "close-session",
        "Aissa",
        writes.CLOSE_SESSION,
        f.outlet.id,
        org,
        { sessionId: s.guestSessionId },
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (await call("create-order", "Aissa", writes.CREATE_ORDER)).statusCode,
  ).toBe(403);
  await expect(
    Identity.get(org, "Aissa").then((a) => Identity.writeChecks(org, a!)),
  ).rejects.toMatchObject({ statusCode: 403 });
});
test("idempotency is durable, intent/actor isolated, and independent from later reassignment", async () => {
  const input = body();
  const a = await call("open-session", "Aissa", input);
  const count = rows().length;
  expect(await call("open-session", "Aissa", input)).toEqual(a);
  expect(rows()).toHaveLength(count);
  expect((await call("open-session", "Binta", input)).statusCode).toBe(409);
  expect(
    (await call("open-session", "Aissa", { ...input, tableId: f.tables[1].id }))
      .statusCode,
  ).toBe(409);
  const s = JSON.parse(a.body).data;
  expect(
    (
      await call(
        "replace-responsible-staff",
        "manager",
        { clientRequestId: req(), expectedVersion: 1, staffId: "Binta" },
        f.outlet.id,
        org,
        { sessionId: s.guestSessionId },
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (await S.session(scope(), s.guestSessionId)).data.responsibleStaffId,
  ).toBe("Binta");
  expect((await call("open-session", "Aissa", input)).statusCode).toBe(200);
  expect(
    (await S.session(scope(), s.guestSessionId)).data.responsibleStaffId,
  ).toBe("Binta");
});
test("two waiters race: one complete session and winner responsibility only", async () => {
  const results = await Promise.all([
    call("open-session", "Aissa", body()),
    call("open-session", "Binta", body()),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const winner = JSON.parse(
    results.find((r) => r.statusCode === 200)!.body,
  ).data;
  expect(winner.responsibleStaff.staffId).toBe(winner.openedBy);
  expect(
    rows().filter((r) => r.entityType === "RESTAURANT_GUEST_SESSION"),
  ).toHaveLength(1);
  expect(
    rows().filter((r) => r.entityType === "RESTAURANT_TABLE_OCCUPANCY"),
  ).toHaveLength(1);
  expect(
    rows().filter((r) => r.entityType === "RESTAURANT_TRANSACTION_AUDIT"),
  ).toHaveLength(1);
});
test.each(["staff", "assignment", "role", "product", "membership"])(
  "%s revocation between validation and commit aborts the whole opening",
  async (change) => {
    const commit = R.commit.bind(R);
    jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
      if (change === "role") m.seedAccess(org, "Aissa", "KITCHEN");
      if (change === "product")
        patch(
          { PK: K.orgKey(org), SK: K.productAccessSK("RESTAURANTS") },
          { status: "SUSPENDED" },
        );
      if (change === "membership")
        patch(
          { PK: K.orgKey(org), SK: K.orgUserAccessSK("Aissa") },
          { status: "INACTIVE" },
        );
      if (change === "staff" || change === "assignment") {
        const key =
          change === "staff"
            ? SR.staffKey(org, "Aissa")
            : SR.assignmentKeys(org, "Aissa", f.outlet.id)[0];
        const old = unmarshall(m.rows.get(JSON.stringify([key.PK, key.SK]))!);
        put({ ...old, data: { ...old.data, status: "INACTIVE", version: 2 } });
      }
      await commit(actions);
    });
    const response = await call("open-session", "Aissa", body());
    expect(response.statusCode).toBe(403);
    expect(
      rows().filter((r) => r.entityType === "RESTAURANT_GUEST_SESSION"),
    ).toHaveLength(0);
    expect(
      rows().filter((r) => r.entityType === "RESTAURANT_TABLE_OCCUPANCY"),
    ).toHaveLength(0);
    expect(
      rows().filter((r) => r.entityType === "RESTAURANT_TRANSACTION_AUDIT"),
    ).toHaveLength(0);
  },
);
test.each(["staff", "assignment"])(
  "later %s deactivation retains session/reference and blocks future access/replay",
  async (change) => {
    const input = body();
    const s = JSON.parse(
      (await call("open-session", "Aissa", input)).body,
    ).data;
    if (change === "staff")
      await Staff.mutate(org, "owner", "Aissa", "UPDATE", {
        clientRequestId: req(),
        expectedVersion: 1,
        status: "INACTIVE",
      });
    else
      await Staff.mutate(
        org,
        "owner",
        "Aissa",
        "UNASSIGN",
        { clientRequestId: req(), expectedVersion: 1 },
        f.outlet.id,
      );
    expect(
      (await S.session(scope(), s.guestSessionId)).data.responsibleStaffId,
    ).toBe("Aissa");
    const read = await call("get-session", "owner", {}, f.outlet.id, org, {
      sessionId: s.guestSessionId,
    });
    expect(JSON.parse(read.body).data.responsibleStaff).toEqual({
      staffId: "Aissa",
      displayName: "Aissa S.",
      available: false,
    });
    expect((await call("service-floor")).statusCode).toBe(403);
    expect((await call("open-session", "Aissa", body(1))).statusCode).toBe(403);
    expect((await call("open-session", "Aissa", input)).statusCode).toBe(403);
  },
);
test("authorization is fixed bounded GetItem reads without Scan/Query/GSI or N+1", async () => {
  m.db.resetHistory();
  await Access.authorize(scope(), "Aissa");
  expect(m.db.commandCalls(GetItemCommand)).toHaveLength(6);
  expect(m.db.commandCalls(QueryCommand)).toHaveLength(0);
  expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
  expect(
    m.db
      .commandCalls(GetItemCommand)
      .every((c) => c.args[0].input.ConsistentRead === true),
  ).toBe(true);
});
test("self context is bounded, paginated, active-only, scoped to current user and private", async () => {
  const b = await Config.create(
    org,
    "owner",
    "outlet",
    {},
    { name: "Fidjrossè", clientRequestId: req() },
  );
  await Staff.mutate(
    org,
    "owner",
    "Aissa",
    "ASSIGN",
    { clientRequestId: req() },
    b.id,
  );
  const first = c.RestaurantMyOutletsResponseSchema.parse(
    JSON.parse((await self("Aissa", { limit: "1" })).body),
  );
  expect(first.items).toHaveLength(1);
  expect(first.nextCursor).toBeDefined();
  const next = c.RestaurantMyOutletsResponseSchema.parse(
    JSON.parse(
      (await self("Aissa", { limit: "1", cursor: first.nextCursor })).body,
    ),
  );
  expect([...first.items, ...next.items].map((o) => o.name).sort()).toEqual([
    "Agla",
    "Fidjrossè",
  ]);
  expect((await self("Binta", { cursor: first.nextCursor })).statusCode).toBe(
    400,
  );
  expect((await self("Aissa", { staffId: "Binta" })).statusCode).toBe(400);
  expect((await self("Aissa", { cursor: "garbage" })).statusCode).toBe(400);
  const json = JSON.stringify(first.items);
  expect(json).not.toMatch(/userId|staffId|Cognito|email|PK|SK|status|version/);
  await Staff.mutate(
    org,
    "owner",
    "Aissa",
    "UNASSIGN",
    { clientRequestId: req(), expectedVersion: 1 },
    f.outlet.id,
  );
  const remaining = JSON.parse((await self()).body);
  expect(remaining.items).toEqual([{ outletId: b.id, name: "Fidjrossè" }]);
  m.db.resetHistory();
  await self();
  expect(m.db.commandCalls(QueryCommand)).toHaveLength(1);
  expect(m.db.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({
    ConsistentRead: true,
    Limit: 50,
  });
  expect(m.db.commandCalls(BatchGetItemCommand)).toHaveLength(1);
  expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
});

test.each(["OWNER", "MANAGER"])(
  "bound %s still opens without automatic responsibility",
  async (role) => {
    await person("management", role);
    const response = await call("open-session", "management", body());
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data).not.toHaveProperty(
      "responsibleStaff",
    );
  },
);
test("self-context contract rejects directory and persistence leakage", () => {
  for (const item of [
    { outletId: f.outlet.id, name: "Agla", userId: "Aissa" },
    { outletId: f.outlet.id, name: "Agla", PK: "secret" },
    { outletId: f.outlet.id, name: "Agla", email: "hidden@example.com" },
    { outletId: f.outlet.id, name: "Agla", restaurantRole: "OWNER" },
  ])
    expect(
      c.RestaurantMyOutletsResponseSchema.safeParse({ items: [item] }).success,
    ).toBe(false);
});
