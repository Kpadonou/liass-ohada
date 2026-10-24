import { randomBytes } from "crypto";
import { mockClient } from "aws-sdk-client-mock";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { acceptanceFixture } from "./acceptance-fixture";
import { memoryDynamo, fixtureId } from "./memory-dynamo";
import { GuestService } from "@/lambda/domains/restaurants/guest-service";
import { GuestCarteService } from "@/lambda/domains/restaurants/guest-carte";
import { GuestSubmissions as S } from "@/lambda/domains/restaurants/guest-submissions";
import { RestaurantsService as Config } from "@/lambda/domains/restaurants/restaurant-service";
import { RestaurantTransactionsService as E } from "@/lambda/domains/restaurants/transaction-service";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import * as c from "@liass-ohada/shared/restaurants";
let m: ReturnType<typeof memoryDynamo>,
  f: Awaited<ReturnType<typeof acceptanceFixture>>,
  cap: string,
  token: string,
  scope: { orgId: string; outletId: string; sessionId: string };
const secret = mockClient(SecretsManagerClient),
  org = "org-resto";
const all = () => [...m.rows.values()].map((r) => unmarshall(r));
function patch(sk: string, change: object) {
  const key = JSON.stringify([K.orgKey(org), sk]);
  const row = unmarshall(m.rows.get(key)!);
  m.rows.set(key, marshall({ ...row, data: { ...row.data, ...change } }));
}
async function resolve() {
  const r = await GuestService.resolve({ token });
  if (!("capability" in r)) throw Error(JSON.stringify(r));
  return r.capability;
}
async function body(n = 900) {
  const r = await GuestCarteService.read(cap);
  if (r.body.state !== "READY") throw Error();
  const entry = r.body.categories[0].items[0];
  return c.GuestSubmissionRequestSchema.parse({
    clientRequestId: fixtureId(n),
    lines: [
      {
        reference: entry.reference,
        selectionRef: entry.selectionRef,
        quantity: 2,
        note: "Sans piment",
        presentedAmountMinor: entry.amountMinor,
        currency: r.body.currency,
      },
    ],
  });
}
beforeEach(async () => {
  m = memoryDynamo();
  m.seedAccess(org, "owner", "OWNER");
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  process.env.STAGE = "test";
  process.env.RESTAURANTS_GUEST_SECRET_ARN = randomBytes(8).toString("hex");
  secret.reset();
  secret
    .on(GetSecretValueCommand)
    .resolves({ SecretString: JSON.stringify({ key: "s".repeat(64) }) });
  f = await acceptanceFixture();
  patch(K.restaurantSK(), { guestOrderingPolicy: "STAFF_APPROVAL" });
  token = (
    await Config.getTableQr(
      org,
      { outletId: f.outlet.id, serviceAreaId: f.areas[0].id },
      f.tables[0].id,
    )
  ).token!;
  const s = await E.mutate(
    { orgId: org, outletId: f.outlet.id, actorId: "owner" },
    "OPEN_SESSION",
    {
      clientRequestId: fixtureId(800),
      tableId: f.tables[0].id,
      areaId: f.areas[0].id,
    },
  );
  scope = {
    orgId: org,
    outletId: f.outlet.id,
    sessionId: c.GuestSessionSchema.parse(s.data).guestSessionId,
  };
  cap = await resolve();
});
afterEach(() => {
  m.db.restore();
  jest.useRealTimers();
  jest.restoreAllMocks();
});
test("pending has no order/effects; duplicate and concurrent submissions converge", async () => {
  const input = await body();
  const before = all().filter((r) =>
    /ORDER|PREPARATION|PAYMENT/.test(String(r.entityType)),
  ).length;
  const [a, b] = await Promise.all([
    S.submit(cap, input),
    S.submit(cap, input),
  ]);
  expect(a).toEqual(b);
  expect(a.state).toBe("CONFIRMED");
  expect(
    all().filter((r) => r.entityType === "RESTAURANT_GUEST_ORDER_REQUEST"),
  ).toHaveLength(1);
  expect(
    all().filter(
      (r) =>
        /ORDER|PREPARATION|PAYMENT/.test(String(r.entityType)) &&
        r.entityType !== "RESTAURANT_GUEST_ORDER_REQUEST",
    ),
  ).toHaveLength(before);
  const serialized = JSON.stringify(a);
  for (const field of [
    "orgId",
    "outletId",
    "tableId",
    "sessionId",
    "guestHandle",
    "PK",
    "SK",
    "version",
  ])
    expect(serialized).not.toContain('"' + field + '"');
});
test("only own Guest requests are visible", async () => {
  await S.submit(cap, await body());
  expect(((await S.own(cap)) as { requests: unknown[] }).requests).toHaveLength(
    1,
  );
  const second = await resolve();
  expect(
    ((await S.own(second)) as { requests: unknown[] }).requests,
  ).toHaveLength(0);
});
test("reject bounded reason without creating order, repeated reject safe", async () => {
  const r = await S.submit(cap, await body());
  if (r.state !== "CONFIRMED") throw Error();
  const result = await S.review(
    scope,
    "owner",
    r.request.requestId,
    "reject",
    "Cuisine fermée",
  );
  expect(result.request.state).toBe("REJECTED");
  expect(
    await S.review(scope, "owner", r.request.requestId, "reject", "autre"),
  ).toEqual(result);
  expect(all().some((r) => r.entityType === "RESTAURANT_ORDER")).toBe(false);
});
test("accept uses canonical DINE_IN engine exactly once", async () => {
  const r = await S.submit(cap, await body());
  if (r.state !== "CONFIRMED") throw Error();
  const result = await S.review(scope, "owner", r.request.requestId, "approve");
  expect(result.request.state).toBe("ACCEPTED");
  expect(
    (await S.review(scope, "owner", r.request.requestId, "approve")).request
      .state,
  ).toBe("ACCEPTED");
  const orders = all().filter((r) => r.entityType === "RESTAURANT_ORDER");
  expect(orders).toHaveLength(1);
  expect(orders[0].data.status).not.toBe("DRAFT");
});
test("rate limit is table durable and pending per Guest bounded", async () => {
  const input = await body();
  await S.submit(cap, input);
  expect(
    (await S.submit(cap, { ...input, clientRequestId: fixtureId(901) })).state,
  ).toBe("RATE_LIMITED");
  let now = Date.now();
  jest.spyOn(Date, "now").mockImplementation(() => now);
  now += 5001;
  expect(
    (await S.submit(cap, { ...input, clientRequestId: fixtureId(902) })).state,
  ).toBe("CONFIRMED");
  now += 5001;
  expect(
    (await S.submit(cap, { ...input, clientRequestId: fixtureId(903) })).state,
  ).toBe("LIMIT_REACHED");
});
test.each(["DISABLED", "DIRECT"])("%s cannot submit", async (policy) => {
  patch(K.restaurantSK(), { guestOrderingPolicy: policy });
  expect((await S.submit(cap, await body())).state).toBe("NOT_ALLOWED");
});
test("FREE cannot submit or create a visit", async () => {
  const input = await body();
  const session = await E.session(scope, scope.sessionId);
  await E.mutate(
    { ...scope, actorId: "owner" },
    "CLOSE_SESSION",
    { clientRequestId: fixtureId(810), expectedVersion: session.data.version },
    { sessionId: scope.sessionId },
  );
  cap = await resolve();
  const before = all().filter(
    (r) => r.entityType === "RESTAURANT_GUEST_SESSION",
  ).length;
  expect((await S.submit(cap, input)).state).toBe("NOT_ALLOWED");
  expect(
    all().filter((r) => r.entityType === "RESTAURANT_GUEST_SESSION"),
  ).toHaveLength(before);
});
test("price/config change requires explicit review", async () => {
  const input = await body();
  for (const entry of f.items)
    patch(K.restaurantMenuItemSK(f.outlet.id, entry.categoryId, entry.id), {
      version: entry.version + 1,
    });
  expect((await S.submit(cap, input)).state).toBe("REVIEW_REQUIRED");
});
test("15 minute expiry prevents acceptance", async () => {
  const r = await S.submit(cap, await body());
  if (r.state !== "CONFIRMED") throw Error();
  jest.spyOn(Date, "now").mockReturnValue(Date.now() + 900001);
  expect(
    (await S.review(scope, "owner", r.request.requestId, "approve")).request
      .state,
  ).toBe("EXPIRED");
  expect(all().some((r) => r.entityType === "RESTAURANT_ORDER")).toBe(false);
});
test.each(["CASHIER", "KITCHEN"])("%s cannot review", async (role) => {
  m.seedAccess(org, "other", role as "CASHIER");
  await expect(S.list(scope, "other")).rejects.toBeDefined();
});
test("cross org/outlet cannot read a canonical request", async () => {
  const r = await S.submit(cap, await body());
  if (r.state !== "CONFIRMED") throw Error();
  expect(
    await S.row({ ...scope, orgId: "other" }, r.request.requestId),
  ).toBeUndefined();
  expect(
    await S.row({ ...scope, outletId: fixtureId(999) }, r.request.requestId),
  ).toBeUndefined();
});
test("simultaneous Accept commands converge on one canonical order", async () => {
  const r = await S.submit(cap, await body());
  if (r.state !== "CONFIRMED") throw Error();
  const a = await Promise.allSettled([
    S.review(scope, "owner", r.request.requestId, "approve"),
    S.review(scope, "owner", r.request.requestId, "approve"),
  ]);
  expect(a.every((x) => x.status === "fulfilled")).toBe(true);
  expect((await S.row(scope, r.request.requestId))?.data.state).toBe(
    "ACCEPTED",
  );
  expect(all().filter((r) => r.entityType === "RESTAURANT_ORDER")).toHaveLength(
    1,
  );
});
test("visit close invalidates pending request without effects", async () => {
  const r = await S.submit(cap, await body());
  if (r.state !== "CONFIRMED") throw Error();
  const session = await E.session(scope, scope.sessionId);
  await E.mutate(
    { ...scope, actorId: "owner" },
    "CLOSE_SESSION",
    { clientRequestId: fixtureId(840), expectedVersion: session.data.version },
    { sessionId: scope.sessionId },
  );
  expect((await S.own(cap)).state).toBe("VISIT_ENDED");
  expect(
    (await S.review(scope, "owner", r.request.requestId, "approve")).request
      .state,
  ).toBe("EXPIRED");
  expect(all().some((r) => r.entityType === "RESTAURANT_ORDER")).toBe(false);
});
test("server validates line, unit, note and price bounds", async () => {
  const input = await body();
  for (const quantity of [0, 21, 1.2])
    await expect(
      S.submit(cap, { ...input, lines: [{ ...input.lines[0], quantity }] }),
    ).rejects.toBeDefined();
  await expect(
    S.submit(cap, {
      ...input,
      lines: [{ ...input.lines[0], note: "x".repeat(251) }],
    }),
  ).rejects.toBeDefined();
  expect(
    (
      await S.submit(cap, {
        ...input,
        lines: [{ ...input.lines[0], presentedAmountMinor: 1 }],
      })
    ).state,
  ).toBe("REVIEW_REQUIRED");
  expect(
    c.GuestSubmissionRequestSchema.safeParse({
      ...input,
      lines: Array.from({ length: 13 }, (_, n) => ({
        ...input.lines[0],
        reference: "r".repeat(20) + n,
      })),
    }).success,
  ).toBe(false);
  expect(
    c.GuestSubmissionRequestSchema.safeParse({
      ...input,
      lines: Array.from({ length: 6 }, (_, n) => ({
        ...input.lines[0],
        quantity: 20,
        reference: "r".repeat(20) + n,
      })),
    }).success,
  ).toBe(false);
});
test("two different commands racing obey the table rate gate", async () => {
  const input = await body();
  const r = await Promise.all([
    S.submit(cap, input),
    S.submit(cap, { ...input, clientRequestId: fixtureId(910) }),
  ]);
  expect(r.map((x) => x.state).sort()).toEqual(["CONFIRMED", "RATE_LIMITED"]);
  expect(
    all().filter((r) => r.entityType === "RESTAURANT_GUEST_ORDER_REQUEST"),
  ).toHaveLength(1);
});
test("10 pending visit limit across Guests", async () => {
  let now = Date.now();
  jest.spyOn(Date, "now").mockImplementation(() => now);
  for (let guest = 0; guest < 5; guest++) {
    cap = await resolve();
    const input = await body();
    for (let n = 0; n < 2; n++) {
      expect(
        (
          await S.submit(cap, {
            ...input,
            clientRequestId: fixtureId(1000 + guest * 2 + n),
          })
        ).state,
      ).toBe("CONFIRMED");
      now += 5001;
    }
  }
  cap = await resolve();
  expect((await S.submit(cap, await body(1100))).state).toBe("LIMIT_REACHED");
});
test("20 lifetime submissions remains bounded after rejections", async () => {
  let now = Date.now();
  jest.spyOn(Date, "now").mockImplementation(() => now);
  const input = await body();
  for (let n = 0; n < 20; n++) {
    const r = await S.submit(cap, {
      ...input,
      clientRequestId: fixtureId(1200 + n),
    });
    if (r.state !== "CONFIRMED") throw Error(r.state);
    await S.review(
      scope,
      "owner",
      r.request.requestId,
      "reject",
      "Unavailable",
    );
    now += 5001;
  }
  expect(
    (await S.submit(cap, { ...input, clientRequestId: fixtureId(1300) })).state,
  ).toBe("LIMIT_REACHED");
});
test("invalid and tampered capability cannot write requests", async () => {
  const input = await body();
  for (const value of ["invalid", cap.slice(0, -8) + "tampered"])
    expect((await S.submit(value, input)).state).toBe("UNAVAILABLE");
  expect(
    all().some((r) => r.entityType === "RESTAURANT_GUEST_ORDER_REQUEST"),
  ).toBe(false);
});
test("failed acceptance cannot leave an Order or preparation behind", async () => {
  const r = await S.submit(cap, await body());
  if (r.state !== "CONFIRMED") throw Error();
  for (const entry of f.items)
    patch(K.restaurantMenuItemSK(f.outlet.id, entry.categoryId, entry.id), {
      version: entry.version + 1,
      availability: "UNAVAILABLE",
    });
  await expect(
    S.review(scope, "owner", r.request.requestId, "approve"),
  ).rejects.toBeDefined();
  expect((await S.row(scope, r.request.requestId))?.data.state).toBe(
    "PENDING_APPROVAL",
  );
  expect(
    all().some((r) =>
      [
        "RESTAURANT_ORDER",
        "RESTAURANT_ORDER_ITEM",
        "RESTAURANT_PREPARATION",
      ].includes(r.entityType),
    ),
  ).toBe(false);
  expect(
    (
      await S.review(
        scope,
        "owner",
        r.request.requestId,
        "reject",
        "Item unavailable",
      )
    ).request.state,
  ).toBe("REJECTED");
});
test("expired selection capability is not new submission authority", async () => {
  const input = await body();
  jest.useFakeTimers({ now: Date.now() + 900001 });
  expect((await S.submit(cap, input)).state).toBe("REVIEW_REQUIRED");
});
test("same idempotency key with altered intent cannot create another request", async () => {
  const input = await body();
  await S.submit(cap, input);
  expect(
    (
      await S.submit(cap, {
        ...input,
        lines: [{ ...input.lines[0], quantity: 3 }],
      })
    ).state,
  ).toBe("REVIEW_REQUIRED");
  expect(
    all().filter((r) => r.entityType === "RESTAURANT_GUEST_ORDER_REQUEST"),
  ).toHaveLength(1);
});
test.each(["OWNER", "MANAGER", "WAITER"])(
  "%s can review and atomically accept under canonical outlet authority",
  async (role) => {
    const actor = role === "OWNER" ? "owner" : "reviewer";
    if (actor !== "owner") {
      m.seedAccess(org, actor, role);
      if (role === "WAITER") {
        const profile = {
          PK: K.userProfilePK(actor),
          SK: K.userProfileSK(),
          entityType: "USER_PROFILE",
          userId: actor,
          email: "reviewer@example.test",
          normalizedEmail: "reviewer@example.test",
          emailVerified: true,
          displayName: "Reviewer",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastSyncedFromIdentityAt: new Date().toISOString(),
        };
        m.rows.set(JSON.stringify([profile.PK, profile.SK]), marshall(profile));
        const { RestaurantStaffService: Staff } =
          await import("@/lambda/domains/restaurants/staff-service");
        await Staff.mutate(org, "owner", actor, "BIND", {
          clientRequestId: fixtureId(1600),
          memberUserId: actor,
        });
        await Staff.mutate(
          org,
          "owner",
          actor,
          "ASSIGN",
          { clientRequestId: fixtureId(1601) },
          f.outlet.id,
        );
      }
    }
    const r = await S.submit(cap, await body());
    if (r.state !== "CONFIRMED") throw Error();
    expect((await S.list(scope, actor)).requests).toHaveLength(1);
    expect(
      (await S.review(scope, actor, r.request.requestId, "approve")).request
        .state,
    ).toBe("ACCEPTED");
  },
);
test.each([
  "restaurant",
  "outlet",
  "area",
  "table",
  "revoked",
  "product",
  "occupancy",
])("canonical %s invalidation blocks public submission", async (kind) => {
  const input = await body();
  if (kind === "restaurant") patch(K.restaurantSK(), { isActive: false });
  if (kind === "outlet")
    patch(K.restaurantOutletSK(f.outlet.id), { isActive: false });
  if (kind === "area")
    patch(K.restaurantServiceAreaSK(f.outlet.id, f.areas[0].id), {
      isActive: false,
    });
  if (kind === "table")
    patch(K.restaurantTableSK(f.outlet.id, f.areas[0].id, f.tables[0].id), {
      isActive: false,
    });
  if (kind === "revoked")
    patch(K.restaurantTableSK(f.outlet.id, f.areas[0].id, f.tables[0].id), {
      qrRevoked: true,
    });
  if (kind === "product") {
    const key = JSON.stringify([
      K.orgKey(org),
      K.productAccessSK("RESTAURANTS"),
    ]);
    const r = unmarshall(m.rows.get(key)!);
    m.rows.set(key, marshall({ ...r, status: "INACTIVE" }));
  }
  if (kind === "occupancy") {
    const key = JSON.stringify([
      K.restaurantOccupancyPK(org, f.outlet.id, f.tables[0].id),
      K.restaurantOccupancySK(),
    ]);
    const r = unmarshall(m.rows.get(key)!);
    m.rows.set(
      key,
      marshall({ ...r, data: { ...r.data, guestSessionId: fixtureId(1999) } }),
    );
  }
  const { handler } = await import("@/lambda/domains/restaurants/guest-public");
  const response = await handler({
    routeKey: "POST /public/restaurants/guest/submissions",
    body: JSON.stringify(input),
    headers: { authorization: "Bearer " + cap },
    requestContext: { requestId: "security" },
  } as never);
  expect(JSON.parse(response.body).state).not.toBe("CONFIRMED");
  expect(
    all().some((r) => r.entityType === "RESTAURANT_GUEST_ORDER_REQUEST"),
  ).toBe(false);
});
test("public body is capped at 16 KiB and rejects tenant fields", async () => {
  const { handler } = await import("@/lambda/domains/restaurants/guest-public");
  const input = await body();
  for (const body of [
    JSON.stringify({ ...input, orgId: org }),
    "x".repeat(16385),
  ]) {
    const r = await handler({
      routeKey: "POST /public/restaurants/guest/submissions",
      headers: { authorization: "Bearer " + cap },
      body,
      requestContext: { requestId: "size" },
    } as never);
    expect(r.statusCode).toBe(400);
  }
  expect(
    all().some((r) => r.entityType === "RESTAURANT_GUEST_ORDER_REQUEST"),
  ).toBe(false);
});
test("twelve distinct categories/stations fit one bounded atomic acceptance", async () => {
  const actor = "bounded-waiter";
  m.seedAccess(org, actor, "WAITER");
  const profile = {
    PK: K.userProfilePK(actor),
    SK: K.userProfileSK(),
    entityType: "USER_PROFILE",
    userId: actor,
    email: "waiter@example.test",
    normalizedEmail: "waiter@example.test",
    emailVerified: true,
    displayName: "Waiter",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastSyncedFromIdentityAt: new Date().toISOString(),
  };
  m.rows.set(JSON.stringify([profile.PK, profile.SK]), marshall(profile));
  const { RestaurantStaffService: Staff } =
    await import("@/lambda/domains/restaurants/staff-service");
  await Staff.mutate(org, "owner", actor, "BIND", {
    clientRequestId: fixtureId(1700),
    memberUserId: actor,
  });
  await Staff.mutate(
    org,
    "owner",
    actor,
    "ASSIGN",
    { clientRequestId: fixtureId(1701) },
    f.outlet.id,
  );
  const ids = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const ctx = { outletId: f.outlet.id };
    const cat = await Config.create(org, "owner", "category", ctx, {
      clientRequestId: fixtureId(1800 + i * 3),
      name: "Category " + i,
    });
    const station = await Config.create(org, "owner", "station", ctx, {
      clientRequestId: fixtureId(1801 + i * 3),
      name: "Station " + i,
    });
    await Config.create(
      org,
      "owner",
      "item",
      { ...ctx, categoryId: cat.id },
      {
        clientRequestId: fixtureId(1802 + i * 3),
        name: "Item " + i,
        price: { amountMinor: 100, currency: "XOF" },
        preparationStationId: station.id,
      },
    );
    ids.add("Category " + i);
  }
  const carte = await GuestCarteService.read(cap);
  if (carte.body.state !== "READY") throw Error();
  const lines = carte.body.categories
    .filter((cat) => ids.has(cat.name))
    .flatMap((cat) =>
      cat.items.map((entry) => ({
        reference: entry.reference,
        selectionRef: entry.selectionRef,
        quantity: 1,
        note: "",
        presentedAmountMinor: entry.amountMinor,
        currency: "XOF",
      })),
    );
  expect(lines).toHaveLength(12);
  const r = await S.submit(cap, { clientRequestId: fixtureId(1900), lines });
  if (r.state !== "CONFIRMED") throw Error(r.state);
  expect(
    (await S.review(scope, actor, r.request.requestId, "approve")).request
      .state,
  ).toBe("ACCEPTED");
  const tx = m.transactions.at(-1)!;
  expect(tx.TransactItems!.length).toBeLessThanOrEqual(95);
  expect(tx.TransactItems).toHaveLength(93);
  expect(
    tx.TransactItems!.some(
      (op) => op.Put?.Item?.entityType?.S === "RESTAURANT_GUEST_ORDER_REQUEST",
    ),
  ).toBe(true);
  expect(
    tx.TransactItems!.filter(
      (op) => op.Put?.Item?.entityType?.S === "RESTAURANT_ORDER",
    ),
  ).toHaveLength(1);
});
test("policy disable/re-enable cannot resurrect a pending request", async () => {
  const r = await S.submit(cap, await body());
  if (r.state !== "CONFIRMED") throw Error();
  patch(K.restaurantSK(), { guestOrderingPolicy: "DISABLED", version: 2 });
  expect(
    (await S.review(scope, "owner", r.request.requestId, "approve")).request
      .state,
  ).toBe("EXPIRED");
  patch(K.restaurantSK(), {
    guestOrderingPolicy: "STAFF_APPROVAL",
    version: 3,
  });
  expect(
    (await S.review(scope, "owner", r.request.requestId, "approve")).request
      .state,
  ).toBe("EXPIRED");
  expect(all().some((row) => row.entityType === "RESTAURANT_ORDER")).toBe(
    false,
  );
});
