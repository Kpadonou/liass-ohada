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
    visitRef: null,
    tableName: f.tables[0].name,
    orderingPermitted: true,
    waiterCallAvailable: true,
  });
  expect(Object.keys(result)).not.toEqual(
    expect.arrayContaining([
      "orgId",
      "restaurantId",
      "outletId",
      "tableId",
      "guestSessionId",
      "sessionId",
      "PK",
      "SK",
      "version",
    ]),
  );
  const claims = await openGuest(result.capability);
  expect(claims).toMatchObject({
    kind: "GUEST",
    guestHandle: result.guestHandle,
  });
  expect(claims.rights).toContain("ORDER_SUBMIT");
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
  expect(response.visitRef).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const before = await openGuest(response.capability);
  expect(before.sessionId).toBe(
    (opened.data as { guestSessionId: string }).guestSessionId,
  );
  expect(before.exp - before.iat).toBe(1800);
  const serialized = JSON.stringify(response);
  for (const internal of [
    org,
    f.restaurant.id,
    f.outlet.id,
    f.tables[0].id,
    before.sessionId!,
  ])
    expect(serialized).not.toContain(internal);
  expect(Object.keys(response)).not.toEqual(
    expect.arrayContaining([
      "orgId",
      "outletId",
      "tableId",
      "guestSessionId",
      "PK",
      "SK",
      "version",
    ]),
  );
  const renewed = await GuestService.renew(response.capability);
  if (renewed.state !== "OCCUPIED") throw new Error("Expected occupied");
  expect(renewed.visitRef).toBe(response.visitRef);
  expect(await openGuest(renewed.capability)).toMatchObject({
    guestHandle: before.guestHandle,
    enteredAt: before.enteredAt,
    sessionId: before.sessionId,
  });
  const repeated = await GuestService.resolve({ token });
  if (repeated.state !== "OCCUPIED") throw new Error("Expected occupied");
  expect(repeated.visitRef).toBe(response.visitRef);
  expect(repeated.capability).not.toBe(response.capability);
  expect(repeated.guestHandle).not.toBe(response.guestHandle);
});
test("FREE cannot upgrade through renew", async () => {
  const response = await GuestService.resolve({ token });
  if (response.state !== "FREE") throw new Error();
  expect(response.visitRef).toBeNull();
  const renewed = await GuestService.renew(response.capability);
  if (renewed.state !== "FREE") throw new Error();
  expect(renewed.visitRef).toBeNull();
  await occupied();
  expect(await GuestService.renew(renewed.capability)).toEqual({
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
  const visitA = response.visitRef;
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
  const next = await GuestService.resolve({ token });
  if (next.state !== "OCCUPIED") throw new Error();
  expect(next.visitRef).not.toBe(visitA);
});
test("visit reference is bound to the canonical table context", async () => {
  await occupied();
  const first = await GuestService.resolve({ token });
  if (first.state !== "OCCUPIED") throw new Error();
  const secondTable = f.tables[1];
  const secondToken = (
    await Config.getTableQr(
      org,
      { outletId: f.outlet.id, serviceAreaId: secondTable.serviceAreaId },
      secondTable.id,
    )
  ).token;
  await Transactions.mutate(
    { orgId: org, outletId: f.outlet.id, actorId: "owner" },
    "OPEN_SESSION",
    {
      clientRequestId: fixtureId(703),
      tableId: secondTable.id,
      areaId: secondTable.serviceAreaId,
    },
  );
  const second = await GuestService.resolve({ token: secondToken });
  if (second.state !== "OCCUPIED") throw new Error();
  expect(second.visitRef).not.toBe(first.visitRef);
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
    sealGuest({ ...principal, exp: principal.iat + 601 }),
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
  expect((await pub("resolve", { token: "s".repeat(7000) })).statusCode).toBe(
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

test.each(["restaurant", "outlet", "area", "table", "product"])(
  "waiter-call revalidates inactive %s before writing",
  async (kind) => {
    const context = await GuestService.resolve({ token });
    if (context.state !== "FREE") throw new Error("expected FREE");
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
    const k = keys[kind as keyof typeof keys],
      old = unmarshall(memory.rows.get(JSON.stringify([k.PK, k.SK]))!);
    patch(
      k,
      kind === "product"
        ? { status: "INACTIVE" }
        : { data: { ...old.data, isActive: false } },
    );
    const writes = memory.transactions.length;
    const result = await pub("waiter-call", {}, "Bearer " + context.capability);
    expect(JSON.parse(result.body)).toEqual({ state: "UNAVAILABLE" });
    expect(memory.transactions).toHaveLength(writes);
  },
);
test("waiter-call rejects tampered, expired, revoked and inconsistent canonical contexts", async () => {
  const c = await GuestService.resolve({ token });
  if (c.state !== "FREE") throw new Error();
  const principal = await openGuest(c.capability);
  const expired = await sealGuest({
    ...principal,
    enteredAt: principal.iat - 500,
    iat: principal.iat - 500,
    exp: principal.iat - 1,
  });
  for (const capability of [
    c.capability.slice(0, -8) + "tampered",
    expired,
    "staff-jwt",
  ]) {
    const before = memory.transactions.length;
    const r = await pub("waiter-call", {}, "Bearer " + capability);
    expect(["UNAVAILABLE", "EXPIRED"]).toContain(JSON.parse(r.body).state);
    expect(memory.transactions).toHaveLength(before);
  }
  patch(tableKey(), { qrRevoked: true });
  expect(
    JSON.parse((await pub("waiter-call", {}, "Bearer " + c.capability)).body)
      .state,
  ).toBe("UNAVAILABLE");
});
test("waiter-call FREE and OCCUPIED use canonical state without creating a session", async () => {
  const c = await GuestService.resolve({ token });
  if (c.state !== "FREE") throw new Error();
  const before = memory.transactions.length;
  const response = await pub("waiter-call", {}, "Bearer " + c.capability);
  expect(JSON.parse(response.body).state).toBe("REQUESTED");
  const writes = memory.transactions
    .slice(before)
    .flatMap((t) => t.TransactItems ?? []);
  expect(
    writes.some(
      (w) => w.Put?.Item?.entityType?.S === "RESTAURANT_GUEST_SESSION",
    ),
  ).toBe(false);
  const json = response.body;
  for (const v of [
    org,
    f.outlet.id,
    f.tables[0].id,
    "acknowledgedBy",
    "PK",
    "SK",
    "version",
  ])
    expect(json).not.toContain(v);
});
test.each(["OWNER", "MANAGER", "WAITER", "CASHIER", "KITCHEN"])(
  "route-specific waiter authorization for %s preserves QR management",
  async (role) => {
    const user = "role-" + role;
    memory.seedAccess(org, user, role);
    // Outlet authorization itself is already covered by service-access tests; this exercises dispatch/middleware.
    const { WaiterCalls } =
      await import("@/lambda/domains/restaurants/waiter-call");
    const activity = jest
      .spyOn(WaiterCalls, "activity")
      .mockResolvedValue({ items: [] });
    const ack = jest.spyOn(WaiterCalls, "acknowledge").mockResolvedValue({
      waiterCallId: fixtureId(950),
      state: "ACKNOWLEDGED",
      acknowledgedAt: new Date().toISOString(),
    });
    const request = (
      routeKey: string,
      pathParameters: Record<string, string>,
    ) =>
      staffHandler({
        routeKey,
        headers: { "x-org-id": org },
        body: "{}",
        pathParameters,
        requestContext: { authorizer: { jwt: { claims: { sub: user } } } },
      } as never);
    const allowed = ["OWNER", "MANAGER", "WAITER"].includes(role);
    expect(
      (
        await request("GET /restaurants/outlets/{outletId}/guest-activity", {
          outletId: f.outlet.id,
        })
      ).statusCode,
    ).toBe(allowed ? 200 : 403);
    expect(activity).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(
      (
        await request(
          "POST /restaurants/outlets/{outletId}/waiter-calls/{waiterCallId}/acknowledge",
          { outletId: f.outlet.id, waiterCallId: fixtureId(950) },
        )
      ).statusCode,
    ).toBe(allowed ? 200 : 403);
    expect(ack).toHaveBeenCalledTimes(allowed ? 1 : 0);
    const qr = await request(
      "GET /restaurants/outlets/{outletId}/service-areas/{areaId}/tables/{tableId}/qr/status",
      { outletId: f.outlet.id, areaId: f.areas[0].id, tableId: f.tables[0].id },
    );
    expect(qr.statusCode).toBe(["OWNER", "MANAGER"].includes(role) ? 200 : 403);
  },
);

test("waiter-call denies incoherent occupancy and Guest cannot enter new staff routes", async () => {
  const c = await GuestService.resolve({ token });
  if (c.state !== "FREE") throw new Error();
  const k = {
    PK: K.restaurantOccupancyPK(org, f.outlet.id, f.tables[0].id),
    SK: K.restaurantOccupancySK(),
  };
  memory.rows.set(
    JSON.stringify([k.PK, k.SK]),
    marshall({
      ...k,
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
  const before = memory.transactions.length;
  expect(
    JSON.parse((await pub("waiter-call", {}, "Bearer " + c.capability)).body)
      .state,
  ).toBe("UNAVAILABLE");
  expect(memory.transactions).toHaveLength(before);
  for (const routeKey of [
    "GET /restaurants/outlets/{outletId}/guest-activity",
    "POST /restaurants/outlets/{outletId}/waiter-calls/{waiterCallId}/acknowledge",
  ]) {
    const r = await staffHandler({
      routeKey,
      headers: { "x-org-id": org, authorization: "Bearer " + c.capability },
      body: "{}",
      pathParameters: {
        outletId: f.outlet.id,
        ...(routeKey.startsWith("POST")
          ? { waiterCallId: fixtureId(999) }
          : {}),
      },
      requestContext: { authorizer: { guest: { kind: "GUEST" } } },
    } as never);
    expect(r.statusCode).toBe(401);
  }
});

test("expired FREE access transparently re-resolves the same QR and preserves handle", async () => {
  const response = await GuestService.resolve({ token });
  if (response.state !== "FREE") throw Error();
  const p = await openGuest(response.capability);
  const now = Math.floor(Date.now() / 1000);
  const expired = await sealGuest({
    ...p,
    enteredAt: now - 601,
    iat: now - 601,
    exp: now - 1,
  });
  expect(await GuestService.renew(expired)).toEqual({ state: "EXPIRED" });
  const recovered = await GuestService.resolve({
    token,
    previousCapability: expired,
  });
  expect(recovered).toMatchObject({
    state: "FREE",
    guestHandle: p.guestHandle,
  });
  expect(
    memory.transactions.filter((t) =>
      t.TransactItems?.some(
        (a) => a.Put?.Item?.entityType?.S === "RESTAURANT_GUEST_SESSION",
      ),
    ),
  ).toHaveLength(0);
});
test("FREE recovery may bind the same phone to the first staff-opened service", async () => {
  const response = await GuestService.resolve({ token });
  if (response.state !== "FREE") throw Error();
  await occupied();
  expect(await GuestService.renew(response.capability)).toEqual({
    state: "EXPIRED",
  });
  expect(
    await GuestService.resolve({
      token,
      previousCapability: response.capability,
    }),
  ).toMatchObject({ state: "OCCUPIED", guestHandle: response.guestHandle });
});
test("re-resolution cannot move an occupied phone to a later unrelated service", async () => {
  const session = (await occupied()).data as {
    version: number;
    guestSessionId: string;
  };
  const response = await GuestService.resolve({ token });
  if (response.state !== "OCCUPIED") throw Error();
  await Transactions.mutate(
    { orgId: org, outletId: f.outlet.id, actorId: "owner" },
    "CLOSE_SESSION",
    { clientRequestId: fixtureId(6000), expectedVersion: session.version },
    { sessionId: session.guestSessionId },
  );
  expect(
    await GuestService.resolve({
      token,
      previousCapability: response.capability,
    }),
  ).toEqual({ state: "VISIT_ENDED" });
});
test("re-resolution still blocks revoked QR and invalid previous proof", async () => {
  const response = await GuestService.resolve({ token });
  if (response.state !== "FREE") throw Error();
  expect(
    await GuestService.resolve({ token, previousCapability: "x".repeat(100) }),
  ).toEqual({ state: "UNAVAILABLE" });
  const key = {
    PK: K.orgKey(org),
    SK: K.restaurantTableSK(f.outlet.id, f.areas[0].id, f.tables[0].id),
  };
  patch(key, { qrRevoked: true });
  expect(
    await GuestService.resolve({
      token,
      previousCapability: response.capability,
    }),
  ).toEqual({ state: "UNAVAILABLE" });
});
