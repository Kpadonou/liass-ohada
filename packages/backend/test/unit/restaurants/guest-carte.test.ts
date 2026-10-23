import { randomBytes } from "crypto";
import { mockClient } from "aws-sdk-client-mock";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  GetItemCommand,
  QueryCommand,
  BatchGetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { acceptanceFixture } from "./acceptance-fixture";
import { memoryDynamo, fixtureId } from "./memory-dynamo";
import { GuestService } from "@/lambda/domains/restaurants/guest-service";
import { GuestCarteService } from "@/lambda/domains/restaurants/guest-carte";
import {
  openGuest,
  sealGuest,
} from "@/lambda/domains/restaurants/guest-capability";
import { openReference } from "@/lambda/domains/restaurants/guest-references";
import { RestaurantsService as Config } from "@/lambda/domains/restaurants/restaurant-service";
import { RestaurantTransactionsService as Transactions } from "@/lambda/domains/restaurants/transaction-service";
import { handler } from "@/lambda/domains/restaurants/guest-public";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
let memory: ReturnType<typeof memoryDynamo>,
  f: Awaited<ReturnType<typeof acceptanceFixture>>,
  cap: string;
const org = "org-resto",
  secret = mockClient(SecretsManagerClient);
const key = (sk: string) => ({ PK: K.orgKey(org), SK: sk });
function patch(sk: string, changes: Record<string, unknown>, root = false) {
  let k = key(sk),
    id = JSON.stringify([k.PK, k.SK]);
  let old = unmarshall(memory.rows.get(id)!);
  memory.rows.set(
    id,
    marshall(
      root
        ? { ...old, ...changes }
        : { ...old, data: { ...old.data, ...changes } },
    ),
  );
}
const read = (etag?: string) => GuestCarteService.read(cap, undefined, etag);
const request = (
  headers: Record<string, string> = {},
  params?: Record<string, string>,
) =>
  handler({
    routeKey: "GET /public/restaurants/guest/carte",
    headers: { authorization: "Bearer " + cap, ...headers },
    queryStringParameters: params,
    requestContext: { requestId: "carte-test" },
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
  let token = (
    await Config.getTableQr(
      org,
      { outletId: f.outlet.id, serviceAreaId: f.areas[0].id },
      f.tables[0].id,
    )
  ).token;
  const c = await GuestService.resolve({ token });
  if (!("capability" in c)) throw Error();
  cap = c.capability;
});
afterEach(() => {
  memory.db.restore();
  jest.restoreAllMocks();
});
test.each(["DISABLED", "STAFF_APPROVAL", "DIRECT"])(
  "FREE browses canonical Carte under %s without writes",
  async (policy) => {
    patch(K.restaurantSK(), { guestOrderingPolicy: policy });
    const count = memory.transactions.length;
    const before = memory.db.commandCalls(GetItemCommand).length;
    const r = await read();
    expect(r.body.state).toBe("READY");
    expect(memory.transactions.length).toBe(count);
    const gets = memory.db
      .commandCalls(GetItemCommand)
      .slice(before)
      .map((c) => JSON.stringify(c.args[0].input));
    expect(gets).toHaveLength(8);
    expect(new Set(gets).size).toBe(8);
    const queries = memory.db.commandCalls(QueryCommand);
    expect(queries.length).toBe(1);
    expect(queries[0].args[0].input.ConsistentRead).toBe(true);
    expect(memory.db.commandCalls(BatchGetItemCommand).length).toBe(1);
    expect(Buffer.byteLength(JSON.stringify(r.body))).toBeLessThan(1024 * 1024);
  },
);
test("visit capability is exact and cannot browse a later visit", async () => {
  const s = await Transactions.mutate(
    { orgId: org, outletId: f.outlet.id, actorId: "owner" },
    "OPEN_SESSION",
    {
      clientRequestId: fixtureId(800),
      tableId: f.tables[0].id,
      areaId: f.areas[0].id,
    },
  );
  if (!("guestSessionId" in s.data) || !s.data.guestSessionId) throw Error();
  const old = await openGuest(cap);
  cap = await sealGuest({
    ...old,
    sessionId: s.data.guestSessionId,
    rights: ["CARTE_READ"],
    exp: old.iat + 1800,
  });
  expect((await read()).body.state).toBe("READY");
  await Transactions.mutate(
    { orgId: org, outletId: f.outlet.id, actorId: "owner" },
    "CLOSE_SESSION",
    { clientRequestId: fixtureId(801), expectedVersion: s.data.version },
    { sessionId: s.data.guestSessionId },
  );
  expect((await read()).body.state).toBe("VISIT_ENDED");
  await Transactions.mutate(
    { orgId: org, outletId: f.outlet.id, actorId: "owner" },
    "OPEN_SESSION",
    {
      clientRequestId: fixtureId(802),
      tableId: f.tables[0].id,
      areaId: f.areas[0].id,
    },
  );
  expect((await read()).body.state).toBe("VISIT_ENDED");
});
test("mobile cache trace is 200, 304 at 61s, 304 at 121s, then 200 on epoch rollover; old references keep their full lifetime", async () => {
  const session = await Transactions.mutate(
    { orgId: org, outletId: f.outlet.id, actorId: "owner" },
    "OPEN_SESSION",
    {
      clientRequestId: fixtureId(850),
      tableId: f.tables[0].id,
      areaId: f.areas[0].id,
    },
  );
  if (!("guestSessionId" in session.data) || !session.data.guestSessionId)
    throw Error();
  const original = await openGuest(cap),
    base = Date.UTC(2026, 9, 22, 10, 1, 0),
    iat = base / 1000;
  jest.useFakeTimers({ now: base });
  try {
    cap = await sealGuest({
      ...original,
      sessionId: session.data.guestSessionId,
      iat,
      enteredAt: iat,
      exp: iat + 1800,
    });
    const p = await openGuest(cap),
      a = await read(),
      b = await read();
    expect(a.statusCode).toBe(200);
    expect(a.etag).toBeDefined();
    expect(a.body.state).toBe("READY");
    if (a.body.state !== "READY" || b.body.state !== "READY") throw Error();
    const ref = a.body.categories[0].items[0].selectionRef;
    expect(ref).not.toBe(b.body.categories[0].items[0].selectionRef);
    expect(a.etag).toBe(b.etag);
    expect((await read(a.etag)).statusCode).toBe(304);
    jest.setSystemTime(base + 61_000);
    expect((await read(a.etag)).statusCode).toBe(304);
    jest.setSystemTime(base + 121_000);
    expect((await read(a.etag)).statusCode).toBe(304);
    const rollover = Date.UTC(2026, 9, 22, 10, 15, 1);
    jest.setSystemTime(rollover);
    const c = await read(a.etag);
    expect(c.statusCode).toBe(200);
    expect(c.etag).not.toBe(a.etag);
    expect((await openReference(p, "selection", ref)).exp).toBe(iat + 900);
    jest.setSystemTime(base + 901_000);
    await expect(openReference(p, "selection", ref)).rejects.toThrow();
  } finally {
    jest.useRealTimers();
  }
});
test("price changes invalidate the content validator", async () => {
  const before = await read();
  patch(
    K.restaurantMenuItemSK(f.outlet.id, f.items[0].categoryId, f.items[0].id),
    { price: { amountMinor: 999, currency: "XOF" } },
  );
  const after = await read(before.etag);
  expect(after.statusCode).toBe(200);
  expect(after.etag).not.toBe(before.etag);
});
test("HTTP 304 is bodyless and security is checked before conditional matching", async () => {
  const a = await request();
  const b = await request({ "if-none-match": a.headers.ETag });
  expect(b.statusCode).toBe(304);
  expect(b.body).toBe("");
  patch(
    K.restaurantTableSK(f.outlet.id, f.areas[0].id, f.tables[0].id),
    { qrRevoked: true },
    true,
  );
  const denied = await request({ "if-none-match": a.headers.ETag });
  expect(JSON.parse(denied.body)).toEqual({ state: "UNAVAILABLE" });
  expect(denied.statusCode).not.toBe(304);
});
test("references are encrypted, 15-minute bounded, context/configuration bound and usage isolated", async () => {
  const r = await read();
  if (r.body.state !== "READY") throw Error();
  const ref = r.body.categories[0].items[0].selectionRef;
  const p = await openGuest(cap),
    c = await openReference(p, "selection", ref);
  expect(c.exp - c.iat).toBe(900);
  expect(JSON.parse(c.value)).toHaveProperty("itemVersion");
  await expect(
    openReference({ ...p, tableId: fixtureId(999) }, "selection", ref),
  ).rejects.toThrow();
  await expect(
    openReference({ ...p, sessionId: fixtureId(999) }, "selection", ref),
  ).rejects.toThrow();
  await expect(openReference(p, "continuation", ref)).rejects.toThrow();
  await expect(
    openReference(p, "selection", ref.slice(0, -1) + "!"),
  ).rejects.toThrow();
});
test.each([
  "tampered",
  "expired",
  "product",
  "restaurant",
  "outlet",
  "area",
  "table",
  "rotated",
])("rejects %s context safely", async (kind) => {
  const validator = (await request()).headers.ETag;
  if (kind === "tampered") cap = cap.slice(0, -1) + "!";
  else if (kind === "expired") {
    let p = await openGuest(cap);
    cap = await sealGuest({
      ...p,
      iat: p.iat - 1000,
      enteredAt: p.enteredAt - 1000,
      exp: p.iat - 400,
    });
  } else if (kind === "rotated")
    patch(
      K.restaurantTableSK(f.outlet.id, f.areas[0].id, f.tables[0].id),
      { qrToken: randomBytes(32).toString("base64url") },
      true,
    );
  else if (kind === "product")
    patch(K.productAccessSK("RESTAURANTS"), { status: "INACTIVE" }, true);
  else
    patch(
      (
        {
          restaurant: K.restaurantSK(),
          outlet: K.restaurantOutletSK(f.outlet.id),
          area: K.restaurantServiceAreaSK(f.outlet.id, f.areas[0].id),
          table: K.restaurantTableSK(
            f.outlet.id,
            f.areas[0].id,
            f.tables[0].id,
          ),
        } as Record<string, string>
      )[kind],
      { isActive: false },
    );
  const r = await request({ "if-none-match": validator });
  expect(r.statusCode).not.toBe(304);
  expect(["UNAVAILABLE", "EXPIRED"]).toContain(JSON.parse(r.body).state);
  expect(Object.keys(JSON.parse(r.body))).toEqual(["state"]);
});
test("no active menu, inactive category/item, availability and canonical category ordering", async () => {
  patch(K.restaurantCategorySK(f.outlet.id, f.categories[1].id), {
    position: 0,
  });
  patch(K.restaurantCategorySK(f.outlet.id, f.categories[0].id), {
    position: 5,
  });
  patch(K.restaurantCategorySK(f.outlet.id, f.categories[2].id), {
    isActive: false,
  });
  patch(
    K.restaurantMenuItemSK(f.outlet.id, f.items[0].categoryId, f.items[0].id),
    { availability: "UNAVAILABLE" },
  );
  const r = await read();
  if (r.body.state !== "READY") throw Error();
  expect(r.body.categories[0].name).toBe("Drinks");
  expect(
    r.body.categories
      .flatMap((c) => c.items)
      .some((i) => i.availability === "UNAVAILABLE"),
  ).toBe(true);
  expect(r.body.categories.some((c) => c.name === "Desserts")).toBe(false);
  patch(K.restaurantMenuSK(f.outlet.id), { isActive: false });
  expect((await read()).body.state).toBe("NO_MENU");
});
test("serialized DTO contains no internal fields or identifier values", async () => {
  const r = await request(),
    s = r.body;
  for (const field of [
    "orgId",
    "restaurantId",
    "outletId",
    "tableId",
    "guestSessionId",
    "menuId",
    "menuCategoryId",
    "menuItemId",
    "stationId",
    "stockItemId",
    "PK",
    "SK",
    "version",
    "createdAt",
    "updatedAt",
  ])
    expect(s).not.toContain('"' + field + '"');
  for (const value of [
    org,
    f.menu.id,
    f.outlet.id,
    ...f.items.map((i) => i.id),
    ...f.categories.map((i) => i.id),
  ])
    expect(s).not.toContain(value);
});
test("500-row bound has encrypted continuation, no Scan or cross-browser cursor reuse", async () => {
  const original = unmarshall(
    memory.rows.get(
      JSON.stringify([
        K.orgKey(org),
        K.restaurantMenuItemSK(
          f.outlet.id,
          f.items[0].categoryId,
          f.items[0].id,
        ),
      ]),
    )!,
  );
  for (let i = 0; i < 505; i++) {
    const id = fixtureId(5000 + i),
      sk = K.restaurantMenuItemSK(f.outlet.id, f.items[0].categoryId, id);
    memory.rows.set(
      JSON.stringify([K.orgKey(org), sk]),
      marshall({
        ...original,
        SK: sk,
        data: { ...original.data, id, name: "Plat " + i },
      }),
    );
  }
  const a = await read();
  if (a.body.state !== "READY") throw Error();
  expect(a.body.categories.flatMap((c) => c.items)).toHaveLength(500);
  expect(a.body.nextCursor).toBeDefined();
  expect(memory.db.commandCalls(QueryCommand)).toHaveLength(10);
  const categoryKeys = memory.db
    .commandCalls(BatchGetItemCommand)
    .flatMap((call) =>
      Object.values(call.args[0].input.RequestItems ?? {}).flatMap((r) =>
        (r.Keys ?? []).map((k) => JSON.stringify(k)),
      ),
    );
  expect(new Set(categoryKeys).size).toBe(categoryKeys.length);
  expect(Buffer.byteLength(JSON.stringify(a.body))).toBeLessThan(1024 * 1024);
  const b = await GuestCarteService.read(cap, a.body.nextCursor);
  if (b.body.state !== "READY") throw Error();
  expect(b.body.categories.flatMap((c) => c.items)).toHaveLength(10);
  expect(b.body.nextCursor).toBeUndefined();
  const p = await openGuest(cap);
  await expect(
    GuestCarteService.read(
      await sealGuest({ ...p, guestHandle: "x".repeat(22) }),
      a.body.nextCursor,
    ),
  ).rejects.toThrow();
});
test.each(["name", "availability", "position"])(
  "ETag invalidates %s independently from Menu.version",
  async (field) => {
    const before = await read();
    if (field === "position")
      patch(K.restaurantCategorySK(f.outlet.id, f.categories[0].id), {
        position: 42,
      });
    else
      patch(
        K.restaurantMenuItemSK(
          f.outlet.id,
          f.items[0].categoryId,
          f.items[0].id,
        ),
        field === "name"
          ? { name: "Changed" }
          : { availability: "UNAVAILABLE" },
      );
    const after = await read(before.etag);
    expect(after.statusCode).toBe(200);
    expect(after.etag).not.toBe(before.etag);
  },
);
test("expired selection reference is rejected independently of opaque context claims", async () => {
  const r = await read();
  if (r.body.state !== "READY") throw Error();
  const p = await openGuest(cap);
  jest.useFakeTimers({
    now: new Date(Date.parse(r.body.referencesExpireAt) + 1000),
  });
  try {
    await expect(
      openReference(p, "selection", r.body.categories[0].items[0].selectionRef),
    ).rejects.toThrow();
  } finally {
    jest.useRealTimers();
  }
});
