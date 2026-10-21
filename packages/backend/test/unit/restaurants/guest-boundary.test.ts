import { randomBytes } from "crypto";
import { mockClient } from "aws-sdk-client-mock";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { GuestService } from "@/lambda/domains/restaurants/guest-service";
import {
  openGuest,
  sealGuest,
  capabilityKey,
} from "@/lambda/domains/restaurants/guest-capability";
import { handler as publicHandler } from "@/lambda/domains/restaurants/guest-public";
import { handler as staffHandler } from "@/lambda/domains/restaurants/guest-qr-staff";
import { QrManagement } from "@/lambda/domains/restaurants/qr-management";
import { RestaurantsService as Config } from "@/lambda/domains/restaurants/restaurant-service";
import { RestaurantTransactionsService as Transactions } from "@/lambda/domains/restaurants/transaction-service";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { acceptanceFixture } from "./acceptance-fixture";
import { memoryDynamo, fixtureId } from "./memory-dynamo";

let memory: ReturnType<typeof memoryDynamo>,
  f: Awaited<ReturnType<typeof acceptanceFixture>>,
  token: string;
const org = "org-resto",
  secret = mockClient(SecretsManagerClient);
const tableKey = () => ({
  PK: K.orgKey(org),
  SK: K.restaurantTableSK(f.outlet.id, f.areas[0].id, f.tables[0].id),
});
function patch(
  key: { PK: string; SK: string },
  changes: Record<string, unknown>,
) {
  const id = JSON.stringify([key.PK, key.SK]);
  const old = unmarshall(memory.rows.get(id)!);
  memory.rows.set(
    id,
    marshall({ ...old, ...changes }, { removeUndefinedValues: true }),
  );
}
async function occupied() {
  return Transactions.mutate(
    { orgId: org, outletId: f.outlet.id, actorId: "owner" },
    "OPEN_SESSION",
    {
      clientRequestId: fixtureId(700),
      tableId: f.tables[0].id,
      areaId: f.areas[0].id,
    },
  );
}
const pub = (operation: string, body: unknown, authorization?: string) =>
  publicHandler({
    routeKey: `POST /public/restaurants/guest/${operation}`,
    body: JSON.stringify(body),
    headers: authorization ? { authorization } : {},
    requestContext: { requestId: "test-correlation" },
    isBase64Encoded: false,
  } as never);
beforeEach(async () => {
  memory = memoryDynamo();
  memory.seedAccess(org, "owner", "OWNER");
  process.env.STAGE = "test";
  process.env.RESTAURANTS_GUEST_SECRET_ARN = randomBytes(8).toString("hex");
  secret.reset();
  secret
    .on(GetSecretValueCommand)
    .resolves({ SecretString: JSON.stringify({ key: "s".repeat(64) }) });
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  f = await acceptanceFixture();
  token = (
    await Config.getTableQr(
      org,
      { outletId: f.outlet.id, serviceAreaId: f.areas[0].id },
      f.tables[0].id,
    )
  ).token;
});
afterEach(() => {
  memory.db.restore();
  jest.restoreAllMocks();
});

test("public resolve needs no staff JWT, performs no write, and exposes only safe table context", async () => {
  const writes = memory.transactions.length;
  const response = await pub("resolve", { token });
  expect(response.statusCode).toBe(200);
  const result = JSON.parse(response.body);
  expect(result).toMatchObject({
    state: "FREE",
    tableName: f.tables[0].name,
    orderingPermitted: false,
    waiterCallAvailable: true,
  });
  expect(Object.keys(result)).not.toEqual(
    expect.arrayContaining([
      "orgId",
      "outletId",
      "tableId",
      "sessionId",
      "version",
    ]),
  );
  const claims = await openGuest(result.capability);
  expect(claims).toMatchObject({
    kind: "GUEST",
    guestHandle: result.guestHandle,
  });
  expect(claims.rights).not.toContain("ORDER_SUBMIT");
  expect(claims.exp - claims.iat).toBe(600);
  expect(memory.transactions).toHaveLength(writes);
  expect(JSON.stringify(result)).not.toContain(org);
});
test.each([
  "",
  "x",
  "x".repeat(4097),
  "!".repeat(43),
  "x".repeat(43),
  randomBytes(32).toString("base64url"),
])("invalid/unknown QR returns a generic state: %p", async (invalid) => {
  expect(JSON.parse((await pub("resolve", { token: invalid })).body)).toEqual({
    state: "UNAVAILABLE",
  });
});
test("guest-supplied tenant or context is rejected", async () =>
  expect(
    JSON.parse((await pub("resolve", { token, orgId: org })).body),
  ).toEqual({ state: "UNAVAILABLE" }));
test.each(["restaurant", "outlet", "area", "table", "product"])(
  "inactive %s is unavailable",
  async (kind) => {
    const keys = {
      restaurant: { PK: K.orgKey(org), SK: K.restaurantSK() },
      outlet: { PK: K.orgKey(org), SK: K.restaurantOutletSK(f.outlet.id) },
      area: {
        PK: K.orgKey(org),
        SK: K.restaurantServiceAreaSK(f.outlet.id, f.areas[0].id),
      },
      table: tableKey(),
      product: { PK: K.orgKey(org), SK: K.productAccessSK("RESTAURANTS") },
    };
    const key = keys[kind as keyof typeof keys],
      old = unmarshall(memory.rows.get(JSON.stringify([key.PK, key.SK]))!);
    patch(
      key,
      kind === "product"
        ? { status: "INACTIVE" }
        : { data: { ...old.data, isActive: false } },
    );
    expect(JSON.parse((await pub("resolve", { token })).body)).toEqual({
      state: "UNAVAILABLE",
    });
  },
);
test("occupied capability binds the exact visit, renews the same handle and entry time", async () => {
  const opened = await occupied();
  const response = await GuestService.resolve({ token });
  if (response.state !== "OCCUPIED") throw new Error("Expected occupied");
  const before = await openGuest(response.capability);
  expect(before.sessionId).toBe(
    (opened.data as { guestSessionId: string }).guestSessionId,
  );
  expect(before.exp - before.iat).toBe(1800);
  const renewed = await GuestService.renew(response.capability);
  if (renewed.state !== "OCCUPIED") throw new Error("Expected occupied");
  expect(await openGuest(renewed.capability)).toMatchObject({
    guestHandle: before.guestHandle,
    enteredAt: before.enteredAt,
    sessionId: before.sessionId,
  });
});
test("FREE cannot upgrade through renew", async () => {
  const response = await GuestService.resolve({ token });
  if (response.state !== "FREE") throw new Error();
  await occupied();
  expect(await GuestService.renew(response.capability)).toEqual({
    state: "EXPIRED",
  });
});
test("DISABLED policy is browse/call only even while occupied", async () => {
  await occupied();
  const key = { PK: K.orgKey(org), SK: K.restaurantSK() };
  patch(key, { data: { ...f.restaurant, guestOrderingPolicy: "DISABLED" } });
  const response = await GuestService.resolve({ token });
  if (response.state !== "OCCUPIED") throw new Error();
  expect(response.orderingPermitted).toBe(false);
  expect((await openGuest(response.capability)).rights).not.toContain(
    "ORDER_SUBMIT",
  );
});
test("inconsistent occupancy is unavailable", async () => {
  const key = {
    PK: K.restaurantOccupancyPK(org, f.outlet.id, f.tables[0].id),
    SK: "ACTIVE",
  };
  memory.rows.set(
    JSON.stringify([key.PK, key.SK]),
    marshall({
      ...key,
      orgId: org,
      outletId: f.outlet.id,
      schemaVersion: 1,
      entityType: "RESTAURANT_TABLE_OCCUPANCY",
      data: {
        guestSessionId: fixtureId(999),
        tableId: f.tables[0].id,
        areaId: f.areas[0].id,
      },
    }),
  );
  expect(await GuestService.resolve({ token })).toEqual({
    state: "UNAVAILABLE",
  });
});
test("closed visit cannot renew or retarget the next visit", async () => {
  const opened = await occupied();
  const session = opened.data as { guestSessionId: string; version: number };
  const response = await GuestService.resolve({ token });
  if (response.state !== "OCCUPIED") throw new Error();
  await Transactions.mutate(
    { orgId: org, outletId: f.outlet.id, actorId: "owner" },
    "CLOSE_SESSION",
    { clientRequestId: fixtureId(701), expectedVersion: session.version },
    { sessionId: session.guestSessionId },
  );
  expect(await GuestService.renew(response.capability)).toEqual({
    state: "VISIT_ENDED",
  });
  await Transactions.mutate(
    { orgId: org, outletId: f.outlet.id, actorId: "owner" },
    "OPEN_SESSION",
    {
      clientRequestId: fixtureId(702),
      tableId: f.tables[0].id,
      areaId: f.areas[0].id,
    },
  );
  expect(await GuestService.renew(response.capability)).toEqual({
    state: "VISIT_ENDED",
  });
});
test("tampering, staff JWT, wrong audience/environment, expiry and algorithm fail closed", async () => {
  const response = await GuestService.resolve({ token });
  if (response.state !== "FREE") throw new Error();
  const principal = await openGuest(response.capability);
  for (const bad of [
    response.capability.slice(0, -5) + "XXXXX",
    "staff.jwt.token",
  ])
    expect(await GuestService.renew(bad)).toEqual({ state: "UNAVAILABLE" });
  const { EncryptJWT } = jest.requireActual("jose");
  const encode = async (
    claims: object,
    header = { alg: "dir", enc: "A256GCM", typ: "resto-guest+jwt" },
  ) =>
    new EncryptJWT(claims)
      .setProtectedHeader(header)
      .encrypt(await capabilityKey());
  for (const changes of [{ aud: "staff" }, { environment: "prod" }])
    expect(
      await GuestService.renew(await encode({ ...principal, ...changes })),
    ).toEqual({ state: "UNAVAILABLE" });
  expect(
    await GuestService.renew(
      await encode({
        ...principal,
        enteredAt: principal.enteredAt - 1200,
        iat: principal.iat - 1200,
        exp: principal.iat - 600,
      }),
    ),
  ).toEqual({ state: "EXPIRED" });
  const parts = response.capability.split(".");
  parts[0] = Buffer.from(
    JSON.stringify({ alg: "dir", enc: "A128GCM", typ: "resto-guest+jwt" }),
  ).toString("base64url");
  expect(await GuestService.renew(parts.join("."))).toEqual({
    state: "UNAVAILABLE",
  });
  await expect(
    sealGuest({ ...principal, rights: ["ORDER_SUBMIT"] }),
  ).rejects.toThrow();
});
test("visit renewal stays below eight hours from first entry", async () => {
  await occupied();
  const response = await GuestService.resolve({ token });
  if (response.state !== "OCCUPIED") throw new Error();
  const principal = await openGuest(response.capability),
    now = Math.floor(Date.now() / 1000);
  const near = await sealGuest({
    ...principal,
    enteredAt: now - 28700,
    exp: now + 100,
  });
  const renewed = await GuestService.renew(near);
  if (renewed.state !== "OCCUPIED") throw new Error();
  expect((await openGuest(renewed.capability)).exp).toBe(now + 100);
});
test("rotation/revocation are atomic, durable, preserve table/session, and invalidate old capabilities", async () => {
  await occupied();
  const initial = await GuestService.resolve({ token });
  if (initial.state !== "OCCUPIED") throw new Error();
  const request = { clientRequestId: fixtureId(800), expectedVersion: 1 };
  const rotated = await QrManagement.mutate(
    org,
    "owner",
    f.outlet.id,
    f.areas[0].id,
    f.tables[0].id,
    "rotate",
    request,
  );
  expect(
    await QrManagement.mutate(
      org,
      "owner",
      f.outlet.id,
      f.areas[0].id,
      f.tables[0].id,
      "rotate",
      request,
    ),
  ).toEqual(rotated);
  expect(await GuestService.resolve({ token })).toEqual({
    state: "UNAVAILABLE",
  });
  expect(await GuestService.renew(initial.capability)).toEqual({
    state: "UNAVAILABLE",
  });
  expect((await GuestService.resolve({ token: rotated.token })).state).toBe(
    "OCCUPIED",
  );
  await QrManagement.mutate(
    org,
    "owner",
    f.outlet.id,
    f.areas[0].id,
    f.tables[0].id,
    "revoke",
    { clientRequestId: fixtureId(801), expectedVersion: rotated.version },
  );
  expect(await GuestService.resolve({ token: rotated.token })).toEqual({
    state: "UNAVAILABLE",
  });
  expect(
    await QrManagement.read(org, f.outlet.id, f.areas[0].id, f.tables[0].id),
  ).toMatchObject({ status: "REVOKED" });
  const restored = await QrManagement.mutate(
    org,
    "owner",
    f.outlet.id,
    f.areas[0].id,
    f.tables[0].id,
    "rotate",
    { clientRequestId: fixtureId(802), expectedVersion: rotated.version + 1 },
  );
  expect(restored.token).not.toBe(rotated.token);
  expect((await GuestService.resolve({ token: restored.token })).state).toBe(
    "OCCUPIED",
  );
  const table = await Config.get(
    org,
    "table",
    { outletId: f.outlet.id, serviceAreaId: f.areas[0].id },
    f.tables[0].id,
  );
  expect(table?.isActive).toBe(true);
});
test("Guest principal cannot pass staff middleware; non-management staff cannot rotate", async () => {
  const result = await staffHandler({
    headers: { "x-org-id": org },
    body: JSON.stringify({
      clientRequestId: fixtureId(900),
      expectedVersion: 1,
    }),
    pathParameters: {
      outletId: f.outlet.id,
      areaId: f.areas[0].id,
      tableId: f.tables[0].id,
    },
    requestContext: { authorizer: { guest: { kind: "GUEST" } } },
  } as never);
  expect(result.statusCode).toBe(401);
  memory.seedAccess(org, "waiter", "WAITER");
  await expect(
    QrManagement.mutate(
      org,
      "waiter",
      f.outlet.id,
      f.areas[0].id,
      f.tables[0].id,
      "rotate",
      { clientRequestId: fixtureId(901), expectedVersion: 1 },
    ),
  ).rejects.toMatchObject({ statusCode: 403 });
});
test("route allowlist, payload and encoding are closed, and logs do not contain secrets", async () => {
  expect((await pub("orders", {})).statusCode).toBe(404);
  expect((await pub("resolve", { token: "s".repeat(2000) })).statusCode).toBe(
    400,
  );
  await pub("renew", {}, "Bearer secret-value");
  expect(JSON.stringify((console.info as jest.Mock).mock.calls)).not.toContain(
    token,
  );
  expect(JSON.stringify((console.info as jest.Mock).mock.calls)).not.toContain(
    "secret-value",
  );
});
