import { ScanCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { handler as directory } from "@/lambda/domains/identity/list-organization-members";
import { handler as initialRole } from "@/lambda/domains/identity/assign-initial-product-role";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { config } from "@/lambda/shared/config";
import { RestaurantStaffRepository as StaffRepository } from "@/lambda/domains/restaurants/staff-repository";
import { RestaurantsService as Config } from "@/lambda/domains/restaurants/restaurant-service";
import { restaurantStaffHandler } from "@/lambda/domains/restaurants/staff-handler";
import { restaurantTransactionHandler } from "@/lambda/domains/restaurants/transaction-handler";
import { memoryDynamo, fixtureId } from "./memory-dynamo";
import { acceptanceFixture } from "./acceptance-fixture";

const org = "org-resto",
  member = "aissatou";
let m: ReturnType<typeof memoryDynamo>,
  f: Awaited<ReturnType<typeof acceptanceFixture>>,
  secondOutlet: string,
  sequence: number;
const req = () => fixtureId(++sequence);
const rows = () => [...m.rows.values()].map((raw) => unmarshall(raw));
const put = (row: Record<string, unknown>) =>
  m.rows.set(
    JSON.stringify([row.PK, row.SK]),
    marshall(row, { removeUndefinedValues: true }),
  );
const row = (SK: string, tenant = org) =>
  unmarshall(m.rows.get(JSON.stringify([K.orgKey(tenant), SK]))!);
const patch = (SK: string, changes: Record<string, unknown>) =>
  put({ ...row(SK), ...changes });
const event = (
  actor = "owner",
  body: object = {},
  pathParameters: object = {},
  queryStringParameters: object = {},
  tenant = org,
) => ({
  headers: { "x-org-id": tenant, "accept-language": "en" },
  body: JSON.stringify(body),
  pathParameters,
  queryStringParameters,
  requestContext: { authorizer: { jwt: { claims: { sub: actor } } } },
});
const role = (value = "WAITER", actor = "owner", clientRequestId = req()) =>
  initialRole(
    event(
      actor,
      { clientRequestId, role: value },
      { memberUserId: member, productCode: "RESTAURANTS" },
    ),
  );
const staff = (
  name: string,
  body: object = {},
  paths: object = {},
  actor = "owner",
) => restaurantStaffHandler(name)(event(actor, body, paths));
const bind = (clientRequestId = req(), actor = "owner", extra: object = {}) =>
  staff(
    "bind-staff",
    { memberUserId: member, clientRequestId, ...extra },
    {},
    actor,
  );
const assign = (
  outletId = f.outlet.id,
  clientRequestId = req(),
  extra: object = {},
) =>
  staff(
    "assign-staff-outlet",
    { clientRequestId, ...extra },
    { memberUserId: member, outletId },
  );
const mine = () => staff("my-service-outlets", {}, {}, member);
const floor = () =>
  restaurantTransactionHandler("service-floor")(
    event(member, {}, { outletId: f.outlet.id }),
  );
const readStaff = () => staff("get-staff", {}, { memberUserId: member });
const outlets = () => staff("list-staff-outlets", {}, { memberUserId: member });
const body = (response: { body: string }) => JSON.parse(response.body);
beforeEach(async () => {
  m = memoryDynamo();
  sequence = 9000;
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  m.seedAccess(org, "owner", "OWNER");
  m.seedAccess(org, "manager", "MANAGER");
  patch(K.orgUserAccessSK("manager"), { role: "MEMBER" });
  f = await acceptanceFixture();
  secondOutlet = (
    await Config.create(
      org,
      "owner",
      "outlet",
      {},
      { name: "Fidjrossè", clientRequestId: req() },
    )
  ).id;
  put({
    PK: K.orgKey(org),
    SK: K.orgUserAccessSK(member),
    entityType: "USER_ORG_ACCESS",
    orgId: org,
    userId: member,
    role: "MEMBER",
    status: "ACTIVE",
    accessSource: "DIRECT",
    workspaceType: "COMPANY",
  });
  put({
    PK: K.userProfilePK(member),
    SK: K.userProfileSK(),
    entityType: "USER_PROFILE",
    userId: member,
    email: "aissatou@example.test",
    normalizedEmail: "aissatou@example.test",
    emailVerified: true,
    displayName: "Aïssatou S.",
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    lastSyncedFromIdentityAt: "2026-10-15T00:00:00.000Z",
  });
  m.db.resetHistory();
});
afterEach(() => {
  m.db.restore();
  jest.restoreAllMocks();
});

test("real command composition: directory → initial role → staff → two outlets → own authenticated service and atomic responsibility", async () => {
  const list = await directory(event());
  expect(list.statusCode).toBe(200);
  expect(
    body(list).items.find((item: { userId: string }) => item.userId === member),
  ).toMatchObject({ displayName: "Aïssatou S.", status: "ACTIVE" });
  expect((await role()).statusCode).toBe(200);
  const platform = JSON.stringify(row(K.orgUserAccessSK(member)));
  const start = m.transactions.length;
  expect((await bind()).statusCode).toBe(200);
  expect((await assign()).statusCode).toBe(200);
  expect((await assign(secondOutlet)).statusCode).toBe(200);
  expect(JSON.stringify(row(K.orgUserAccessSK(member)))).toBe(platform);
  for (const tx of m.transactions.slice(start))
    for (const operation of tx.TransactItems ?? []) {
      if (operation.Put || operation.Update || operation.Delete)
        expect(
          (operation.Put ?? operation.Update ?? operation.Delete)!.TableName,
        ).not.toBe(config.PLATFORM_TABLE_NAME);
    }
  expect(body(await readStaff()).data).toMatchObject({
    userId: member,
    displayName: "Aïssatou S.",
    restaurantRole: "WAITER",
    status: "ACTIVE",
  });
  expect(row(K.restaurantStaffSK(member)).data).not.toHaveProperty("role");
  expect(row(K.restaurantStaffSK(member)).data).not.toHaveProperty(
    "restaurantRole",
  );
  expect(
    body(await mine())
      .items.map((item: { name: string }) => item.name)
      .sort(),
  ).toEqual(["Agla", "Fidjrossè"]);
  expect((await floor()).statusCode).toBe(200);
  const table = f.tables[3];
  const opened = await restaurantTransactionHandler("open-session")(
    event(
      member,
      {
        clientRequestId: req(),
        tableId: table.id,
        areaId: table.serviceAreaId,
      },
      { outletId: f.outlet.id },
    ),
  );
  expect(opened.statusCode).toBe(200);
  const session = c.GuestSessionResponseSchema.parse(body(opened)).data;
  expect(session).toMatchObject({
    openedBy: member,
    responsibleStaff: {
      staffId: member,
      displayName: "Aïssatou S.",
      available: true,
    },
  });
  const hydrated = c.RestaurantServiceFloorResponseSchema.parse(
    body(await floor()),
  );
  expect(
    hydrated.items.find((item) => item.tableId === table.id),
  ).toMatchObject({
    state: "OCCUPIED",
    responsibleStaff: session.responsibleStaff,
  });
  expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
  expect(
    rows().filter(
      (item) => item.entityType === "PRODUCT_ROLE_ASSIGNMENT_AUDIT",
    ),
  ).toHaveLength(1);
  expect(
    rows().filter((item) => item.entityType === "RESTAURANT_STAFF_AUDIT"),
  ).toHaveLength(3);
});

test.each(["MANAGER", "WAITER", "CASHIER", "KITCHEN"])(
  "canonical %s role supports Staff binding and multiple outlets without copying authorization",
  async (value) => {
    expect((await role(value)).statusCode).toBe(200);
    expect((await bind()).statusCode).toBe(200);
    expect((await assign()).statusCode).toBe(200);
    expect((await assign(secondOutlet)).statusCode).toBe(200);
    expect(body(await readStaff()).data.restaurantRole).toBe(value);
  },
);

test("zero outlets is valid provisioning and grants no arbitrary floor access", async () => {
  await role();
  await bind();
  expect(body(await mine())).toEqual({ items: [] });
  expect((await floor()).statusCode).toBe(403);
  expect(body(await readStaff()).data.status).toBe("ACTIVE");
});

test("resume after lost responses and partial outlet completion preserves identities and command effects", async () => {
  const roleId = req(),
    bindId = req(),
    firstOutletId = req(),
    secondOutletId = req();
  await role("WAITER", "owner", roleId);
  await bind(bindId); // Response can be lost; durable replay is authoritative.
  await assign(f.outlet.id, firstOutletId);
  const transactions = m.transactions.length;
  expect((await role("WAITER", "owner", roleId)).statusCode).toBe(200);
  expect((await bind(bindId)).statusCode).toBe(200);
  expect((await assign(f.outlet.id, firstOutletId)).statusCode).toBe(200);
  expect(m.transactions).toHaveLength(transactions);
  expect((await assign(secondOutlet, secondOutletId)).statusCode).toBe(200);
  expect(body(await outlets()).items).toHaveLength(2);
  expect(
    rows().filter((item) => item.entityType === "RESTAURANT_STAFF"),
  ).toHaveLength(1);
  expect(
    rows().filter((item) => item.entityType === "RESTAURANT_STAFF_AUDIT"),
  ).toHaveLength(3);
});

test("new browser intents reconcile duplicate create/assignment through current canonical reads", async () => {
  await role();
  await bind();
  await assign();
  expect((await role()).statusCode).toBe(200);
  expect(body(await bind()).error.code).toBe("RESTAURANTS_STAFF_EXISTS");
  expect(body(await assign()).error.code).toBe(
    "RESTAURANTS_STAFF_ASSIGNMENT_EXISTS",
  );
  expect(body(await readStaff()).data.status).toBe("ACTIVE");
  expect(body(await outlets()).items[0].status).toBe("ACTIVE");
  expect((await assign(secondOutlet)).statusCode).toBe(200);
});

test("retained staff and outlet records reactivate explicitly with versions", async () => {
  await role();
  await bind();
  await assign();
  const paths = { memberUserId: member, outletId: f.outlet.id };
  expect(
    (
      await staff(
        "unassign-staff-outlet",
        { clientRequestId: req(), expectedVersion: 1 },
        paths,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await staff(
        "update-staff",
        { clientRequestId: req(), expectedVersion: 1, status: "INACTIVE" },
        { memberUserId: member },
      )
    ).statusCode,
  ).toBe(200);
  expect((await bind()).statusCode).toBe(409);
  const activate = {
    clientRequestId: req(),
    expectedVersion: 2,
    status: "ACTIVE",
  };
  expect(
    (await staff("update-staff", activate, { memberUserId: member }))
      .statusCode,
  ).toBe(200);
  expect(
    (await staff("update-staff", activate, { memberUserId: member }))
      .statusCode,
  ).toBe(200);
  expect(
    (await assign(f.outlet.id, req(), { expectedVersion: 2 })).statusCode,
  ).toBe(200);
  expect(body(await readStaff()).data.version).toBe(3);
  expect(body(await outlets()).items[0]).toMatchObject({
    version: 3,
    status: "ACTIVE",
  });
  expect(
    rows().filter((item) => item.entityType === "RESTAURANT_STAFF"),
  ).toHaveLength(1);
});

test("concurrent provisioning creates one Staff and one pair of outlet projections", async () => {
  await role();
  const creates = await Promise.all([bind(), bind()]);
  expect(creates.map((result) => result.statusCode).sort()).toEqual([200, 409]);
  const assignments = await Promise.all([assign(), assign()]);
  expect(assignments.map((result) => result.statusCode).sort()).toEqual([
    200, 409,
  ]);
  expect(body(await readStaff()).data.status).toBe("ACTIVE");
  expect(body(await outlets()).items).toHaveLength(1);
  expect(
    rows().filter((item) => item.entityType === "RESTAURANT_STAFF"),
  ).toHaveLength(1);
});

test("MANAGER retains staff management but cannot perform initial Platform role assignment", async () => {
  expect((await role("WAITER", "manager")).statusCode).toBe(403);
  expect((await bind(req(), "manager")).statusCode).toBe(403);
  await role();
  expect((await bind(req(), "manager")).statusCode).toBe(200);
  expect((await role("OWNER")).statusCode).toBe(400);
  expect(row(K.orgUserAccessSK("owner")).productRoles).toEqual({
    RESTAURANTS: "OWNER",
  });
});

test("a different existing role cannot be replaced through provisioning or a forged Staff role", async () => {
  await role("CASHIER");
  expect((await role("WAITER")).statusCode).toBe(409);
  expect((await bind(req(), "owner", { role: "WAITER" })).statusCode).toBe(400);
  expect((await bind()).statusCode).toBe(200);
  expect(body(await readStaff()).data.restaurantRole).toBe("CASHIER");
});

test.each([
  { status: "SUSPENDED" },
  { status: "REVOKED" },
  { accessSource: "CABINET" },
  { accessSource: "OTHER" },
  { orgId: "foreign" },
])("ineligible direct member cannot bind: %j", async (changes) => {
  await role();
  patch(K.orgUserAccessSK(member), changes);
  expect((await bind()).statusCode).toBe(403);
});

test("missing role, foreign member/outlet and forged tenant cannot authorize provisioning", async () => {
  expect((await bind()).statusCode).toBe(403);
  await role();
  const forged = await bind(req(), "owner", { orgId: "foreign" });
  expect(forged.statusCode).toBe(200);
  expect(body(forged).data.userId).toBe(member);
  expect((await assign(fixtureId(999999))).statusCode).toBe(404);
  expect(
    (
      await staff("bind-staff", {
        clientRequestId: req(),
        memberUserId: "foreign-member",
      })
    ).statusCode,
  ).toBe(403);
});

test.each(["BIND", "REACTIVATE", "ASSIGN"])(
  "inactive organization blocks %s",
  async (step) => {
    await role();
    const bindId = req();
    if (step !== "BIND") await bind(bindId);
    if (step === "REACTIVATE")
      await staff(
        "update-staff",
        { clientRequestId: req(), expectedVersion: 1, status: "INACTIVE" },
        { memberUserId: member },
      );
    patch(K.organizationSK(), { status: "INACTIVE" });
    const response =
      step === "BIND"
        ? await bind(bindId)
        : step === "ASSIGN"
          ? await assign()
          : await staff(
              "update-staff",
              { clientRequestId: req(), expectedVersion: 2, status: "ACTIVE" },
              { memberUserId: member },
            );
    expect(response.statusCode).toBe(403);
  },
);

test("organization deactivation between validation and commit cancels the complete Staff write", async () => {
  await role();
  const commit = StaffRepository.commit.bind(StaffRepository);
  jest
    .spyOn(StaffRepository, "commit")
    .mockImplementationOnce(async (actions) => {
      patch(K.organizationSK(), { status: "INACTIVE" });
      return commit(actions);
    });
  expect((await bind()).statusCode).toBe(409);
  expect(rows().some((item) => item.entityType === "RESTAURANT_STAFF")).toBe(
    false,
  );
});

test("lost Staff response resumes from the Platform step without cleanup or duplicate business effects", async () => {
  const roleId = req(),
    bindId = req();
  await role("WAITER", "owner", roleId);
  const commit = StaffRepository.commit.bind(StaffRepository);
  jest
    .spyOn(StaffRepository, "commit")
    .mockImplementationOnce(async (actions) => {
      await commit(actions);
      throw new Error("Lost response after commit");
    });
  expect((await bind(bindId)).statusCode).toBe(500);
  expect((await role("WAITER", "owner", roleId)).statusCode).toBe(200);
  expect((await bind(bindId)).statusCode).toBe(200);
  expect((await assign()).statusCode).toBe(200);
  expect(
    rows().filter((item) => item.entityType === "RESTAURANT_STAFF"),
  ).toHaveLength(1);
  expect(
    rows().filter((item) => item.entityType === "RESTAURANT_STAFF_AUDIT"),
  ).toHaveLength(2);
});

test("failed second outlet can resume while the first active assignment remains satisfied", async () => {
  await role();
  await bind();
  await assign();
  const outlet = row(K.restaurantOutletSK(secondOutlet));
  put({ ...outlet, data: { ...outlet.data, isActive: false } });
  const requestId = req();
  expect((await assign(secondOutlet, requestId)).statusCode).toBe(409);
  expect(body(await outlets()).items).toHaveLength(1);
  put(outlet);
  expect((await assign()).statusCode).toBe(409);
  expect((await assign(secondOutlet, requestId)).statusCode).toBe(200);
  expect(body(await outlets()).items).toHaveLength(2);
});

test("inactive organization rejects replay of a previously successful binding", async () => {
  await role();
  const id = req();
  await bind(id);
  patch(K.organizationSK(), { status: "INACTIVE" });
  expect((await bind(id)).statusCode).toBe(403);
});
