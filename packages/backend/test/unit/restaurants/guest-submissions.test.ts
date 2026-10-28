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
import { InventoryTrackingService } from "@/lambda/domains/restaurants/inventory-tracking-service";
import { RestaurantInventoryService as Inventory } from "@/lambda/domains/restaurants/inventory-service";
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
async function trackedGuestBody() {
  const item = f.items[4];
  const tracking = await InventoryTrackingService.save(
    { orgId: org, outletId: f.outlet.id },
    item.id,
    "owner",
    {
      categoryId: item.categoryId,
      expectedVersion: 0,
      clientRequestId: fixtureId(5000),
      mode: "CREATE",
      unit: "BOTTLE",
    },
  );
  const r = await GuestCarteService.read(cap);
  if (r.body.state !== "READY") throw Error();
  const entry = r.body.categories
    .flatMap((cat) => cat.items)
    .find((i) => i.name === item.name)!;
  return {
    stockItemId: tracking.stockItem!.id,
    input: c.GuestSubmissionRequestSchema.parse({
      clientRequestId: fixtureId(5001),
      lines: [
        {
          reference: entry.reference,
          selectionRef: entry.selectionRef,
          quantity: 2,
          note: "",
          presentedAmountMinor: entry.amountMinor,
          currency: r.body.currency,
        },
      ],
    }),
  };
}
const inventorySales = () =>
  all().filter((r) => r.entityType === "RESTAURANT_STOCK_MOVEMENT");
test.each(["DIRECT", "STAFF_APPROVAL"] as const)(
  "%s accepted replay resumes the same deterministic Inventory sale",
  async (policy) => {
    patch(K.restaurantSK(), { guestOrderingPolicy: policy });
    const { stockItemId, input } = await trackedGuestBody();
    expect(inventorySales()).toHaveLength(0);
    const failure = jest
      .spyOn(Inventory, "applyMovement")
      .mockRejectedValue(new Error("Unavailable"));
    const result = await S.submit(cap, input);
    if (result.state !== "CONFIRMED") throw Error();
    if (policy === "STAFF_APPROVAL") {
      expect(result.request.state).toBe("PENDING_APPROVAL");
      expect(inventorySales()).toHaveLength(0);
      await S.review(scope, "owner", result.request.requestId, "approve");
    }
    expect(
      all().filter((r) => r.entityType === "RESTAURANT_ORDER"),
    ).toHaveLength(1);
    failure.mockRestore();
    if (policy === "DIRECT") await S.submit(cap, input);
    else await S.review(scope, "owner", result.request.requestId, "approve");
    if (policy === "DIRECT") await S.submit(cap, input);
    else await S.review(scope, "owner", result.request.requestId, "approve");
    expect(inventorySales()).toHaveLength(1);
    expect(inventorySales()[0].data).toMatchObject({
      type: "SALE",
      deltaMilli: -2000,
    });
    expect(
      (await Inventory.get({ orgId: org, outletId: f.outlet.id }, stockItemId))
        .balanceMilli,
    ).toBe(-2000);
  },
);
test.each(["DIRECT", "STAFF_APPROVAL"] as const)(
  "pre-service %s has no Inventory until canonical acceptance",
  async (policy) => {
    await freeTable(policy);
    const { input } = await trackedGuestBody();
    const result = await S.submit(cap, input);
    expect(result).toMatchObject({
      state: "CONFIRMED",
      request: { state: "PENDING_SERVICE" },
    });
    expect(inventorySales()).toHaveLength(0);
    const opened = c.GuestSessionSchema.parse((await openFreeTable()).data);
    const openedScope = { ...scope, sessionId: opened.guestSessionId };
    if (result.state !== "CONFIRMED") throw Error();
    if (policy === "STAFF_APPROVAL") {
      expect(inventorySales()).toHaveLength(0);
      await S.review(openedScope, "owner", result.request.requestId, "approve");
    }
    expect(inventorySales()).toHaveLength(1);
    await openFreeTable();
    expect(inventorySales()).toHaveLength(1);
  },
);
test.each(["reject", "expire"] as const)(
  "%s pending tracked Guest request has no SALE or reversal",
  async (outcome) => {
    const { input } = await trackedGuestBody();
    const result = await S.submit(cap, input);
    if (result.state !== "CONFIRMED") throw Error();
    if (outcome === "expire")
      jest.spyOn(Date, "now").mockReturnValue(Date.now() + 900001);
    await S.review(
      scope,
      "owner",
      result.request.requestId,
      outcome === "reject" ? "reject" : "approve",
      "Unavailable",
    );
    expect(inventorySales()).toHaveLength(0);
  },
);
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
test.each(["DISABLED"])("%s cannot submit", async (policy) => {
  patch(K.restaurantSK(), { guestOrderingPolicy: policy });
  expect((await S.submit(cap, await body())).state).toBe("NOT_ALLOWED");
});
test("FREE rejects a previous service selection and creates no session", async () => {
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
  expect((await S.submit(cap, input)).state).toBe("REVIEW_REQUIRED");
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
async function directBody(name?: string, n = 2200) {
  patch(K.restaurantSK(), { guestOrderingPolicy: "DIRECT" });
  const carte = await GuestCarteService.read(cap);
  if (carte.body.state !== "READY") throw Error();
  const entry = name
    ? carte.body.categories
        .flatMap((cat) => cat.items)
        .find((item) => item.name === name)!
    : carte.body.categories[0].items[0];
  return c.GuestSubmissionRequestSchema.parse({
    clientRequestId: fixtureId(n),
    lines: [
      {
        reference: entry.reference,
        selectionRef: entry.selectionRef,
        quantity: 2,
        note: "Sans piment",
        presentedAmountMinor: entry.amountMinor,
        currency: carte.body.currency,
      },
    ],
  });
}
test("DIRECT accepts canonical no-station order once, without staff approval or fake preparation", async () => {
  const input = await directBody("Chocolate Cake");
  const a = await S.submit(cap, input);
  expect(a.state).toBe("CONFIRMED");
  if (a.state !== "CONFIRMED") throw Error();
  expect(a.request.state).toBe("ACCEPTED");
  expect(a.request.orderStatus).toBe("CONFIRMED");
  expect(a.request.lines[0].fulfillment).toBe("CONFIRMED");
  expect(all().filter((r) => r.entityType === "RESTAURANT_ORDER")).toHaveLength(
    1,
  );
  expect(
    all().filter((r) => r.entityType === "RESTAURANT_ORDER_ITEM"),
  ).toHaveLength(1);
  expect(
    all().filter((r) => r.entityType === "RESTAURANT_PREPARATION"),
  ).toHaveLength(0);
  expect((await E.session(scope, scope.sessionId)).data.dueMinor).toBe(4000);
  expect(await S.submit(cap, input)).toEqual(a);
  expect((await S.list(scope, "owner")).requests).toHaveLength(0);
  await expect(
    S.review(scope, "owner", a.request.requestId, "approve"),
  ).rejects.toBeDefined();
});
test("concurrent DIRECT duplicates converge on one canonical Order and effects", async () => {
  const input = await directBody("Grilled Chicken");
  const results = await Promise.all([
    S.submit(cap, input),
    S.submit(cap, input),
  ]);
  expect(results[0]).toEqual(results[1]);
  if (results[0].state !== "CONFIRMED") throw Error();
  expect(results[0].request.orderStatus).toBe("PREPARING");
  expect(all().filter((r) => r.entityType === "RESTAURANT_ORDER")).toHaveLength(
    1,
  );
  expect(
    all().filter((r) => r.entityType === "RESTAURANT_PREPARATION"),
  ).toHaveLength(1);
  expect((await E.session(scope, scope.sessionId)).data.dueMinor).toBe(10000);
  const rows = all().filter((r) => r.entityType === "RESTAURANT_ORDER_ITEM");
  expect(rows[0].data.quantity).toBe(2);
  expect(rows[0].data.notes).toBe("Sans piment");
  expect(rows[0].data.snapshot.unitPriceMinor).toBe(5000);
});
test("DIRECT staging has no business effects, survives uncertainty, then resumes exactly once", async () => {
  const input = await directBody("Grilled Chicken");
  const original = E.mutate.bind(E);
  const spy = jest
    .spyOn(E, "mutate")
    .mockRejectedValueOnce(new Error("transport"));
  await expect(S.submit(cap, input)).rejects.toThrow();
  expect(all().filter((r) => r.entityType === "RESTAURANT_ORDER")).toHaveLength(
    0,
  );
  expect(
    all().filter((r) => r.entityType === "RESTAURANT_PREPARATION"),
  ).toHaveLength(0);
  expect((await E.session(scope, scope.sessionId)).data.dueMinor).toBe(0);
  const staged = all().find(
    (r) => r.entityType === "RESTAURANT_GUEST_ORDER_REQUEST",
  )!;
  expect(staged.data.state).toBe("PROCESSING");
  expect(staged.directStage.order.status).toBe("DRAFT");
  expect(staged.directStage.order.dueMinor).toBe(0);
  spy.mockImplementation(original);
  const result = await S.submit(cap, input);
  expect(result.state).toBe("CONFIRMED");
  expect(all().filter((r) => r.entityType === "RESTAURANT_ORDER")).toHaveLength(
    1,
  );
});
test("DIRECT canonical pricing and availability reject stale client snapshots", async () => {
  const input = await directBody("Grilled Chicken");
  expect(
    (
      await S.submit(cap, {
        ...input,
        lines: [{ ...input.lines[0], presentedAmountMinor: 1 }],
      })
    ).state,
  ).toBe("REVIEW_REQUIRED");
  const entry = f.items[0];
  patch(K.restaurantMenuItemSK(f.outlet.id, entry.categoryId, entry.id), {
    availability: "UNAVAILABLE",
    version: 2,
  });
  expect((await S.submit(cap, input)).state).toBe("REVIEW_REQUIRED");
  expect(all().filter((r) => r.entityType === "RESTAURANT_ORDER")).toHaveLength(
    0,
  );
});
test("DIRECT invalid/expired selection cannot create effects", async () => {
  const input = await directBody();
  expect(
    (
      await S.submit(cap, {
        ...input,
        lines: [{ ...input.lines[0], selectionRef: "x".repeat(200) }],
      })
    ).state,
  ).toBe("REVIEW_REQUIRED");
  jest.useFakeTimers({ now: Date.now() + 900001 });
  expect((await S.submit(cap, input)).state).toBe("REVIEW_REQUIRED");
  expect(all().filter((r) => r.entityType === "RESTAURANT_ORDER")).toHaveLength(
    0,
  );
});
test("DIRECT own-state never exposes another Guest or internal order references", async () => {
  const input = await directBody();
  await S.submit(cap, input);
  const own = await S.own(cap);
  expect(own.state).toBe("READY");
  const other = await S.own(await resolve());
  if (other.state !== "READY") throw Error();
  expect(other.requests).toHaveLength(0);
  for (const field of [
    "orgId",
    "outletId",
    "tableId",
    "guestSessionId",
    "orderId",
    "itemId",
    "PK",
    "SK",
    "actorId",
  ])
    expect(JSON.stringify(own)).not.toContain('"' + field + '"');
});
test("DIRECT requires exact OPEN visit; never closes the table", async () => {
  const input = await directBody();
  await S.submit(cap, input);
  const session = await E.session(scope, scope.sessionId);
  expect(session.data.status).toBe("OPEN");
  const second = await directBody(undefined, 2300);
  await E.mutate(
    { ...scope, actorId: "owner" },
    "CLOSE_SESSION",
    { clientRequestId: fixtureId(2301), expectedVersion: session.data.version },
    { sessionId: scope.sessionId },
  ).catch(() => undefined); // Accepted sale correctly prevents unpaid closure.
  const principal =
    await import("@/lambda/domains/restaurants/guest-capability");
  const old = await principal.openGuest(cap);
  const wrong = await principal.sealGuest({
    ...old,
    sessionId: fixtureId(2399),
  });
  expect((await S.submit(wrong, second)).state).not.toBe("CONFIRMED");
  expect(all().filter((r) => r.entityType === "RESTAURANT_ORDER")).toHaveLength(
    1,
  );
});

test("DIRECT twelve distinct categories/stations stay within ninety operations", async () => {
  patch(K.restaurantSK(), { guestOrderingPolicy: "DIRECT" });
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
  expect(r.request.state).toBe("ACCEPTED");
  const tx = m.transactions.at(-1)!;
  expect(tx.TransactItems!.length).toBeLessThanOrEqual(90);
  expect(tx.TransactItems).toHaveLength(90);
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
test("DIRECT status follows canonical preparation and no-station lines never become served", async () => {
  const input = await directBody("Grilled Chicken");
  const cake = (await directBody("Chocolate Cake")).lines[0];
  input.lines.push(cake);
  const result = await S.submit(cap, input);
  if (result.state !== "CONFIRMED") throw Error();
  const { RestaurantPreparationService: P } =
    await import("@/lambda/domains/restaurants/preparation-service");
  let task = all().find(
    (row) => row.entityType === "RESTAURANT_PREPARATION",
  )!.data;
  const ids = {
    orderId: task.orderId,
    itemId: task.itemId,
    fireId: task.fireId,
  };
  await P.transition(
    scope,
    "owner",
    "READY",
    { clientRequestId: fixtureId(2500), expectedVersion: task.version },
    ids,
  );
  let state = await S.own(cap);
  if (state.state !== "READY") throw Error();
  expect(state.requests[0].orderStatus).toBe("READY");
  task = all().find((row) => row.entityType === "RESTAURANT_PREPARATION")!.data;
  await P.transition(
    scope,
    "owner",
    "SERVE",
    { clientRequestId: fixtureId(2501), expectedVersion: task.version },
    ids,
  );
  state = await S.own(cap);
  if (state.state !== "READY") throw Error();
  expect(state.requests[0].lines.map((line) => line.fulfillment)).toEqual([
    "SERVED",
    "CONFIRMED",
  ]);
  expect(state.requests[0].orderStatus).not.toBe("SERVED");
});
test("DIRECT ended/replaced service selections cannot submit", async () => {
  const input = await directBody();
  const before = await E.session(scope, scope.sessionId);
  await E.mutate(
    { ...scope, actorId: "owner" },
    "CLOSE_SESSION",
    { clientRequestId: fixtureId(2600), expectedVersion: before.data.version },
    { sessionId: scope.sessionId },
  );
  expect((await S.submit(cap, input)).state).toBe("VISIT_ENDED");
  const free = await resolve();
  expect((await S.submit(free, input)).state).toBe("REVIEW_REQUIRED");
  await E.mutate({ ...scope, actorId: "owner" }, "OPEN_SESSION", {
    clientRequestId: fixtureId(2601),
    tableId: f.tables[0].id,
    areaId: f.areas[0].id,
  });
  expect((await S.submit(cap, input)).state).toBe("VISIT_ENDED");
  expect(all().filter((r) => r.entityType === "RESTAURANT_ORDER")).toHaveLength(
    0,
  );
});
test("DIRECT preserves twenty-submission lifetime limit and table throttling", async () => {
  const input = await directBody();
  let now = Date.now();
  jest.spyOn(Date, "now").mockImplementation(() => now);
  for (let n = 0; n < 20; n++) {
    const r = await S.submit(cap, {
      ...input,
      clientRequestId: fixtureId(2700 + n),
    });
    expect(r.state).toBe("CONFIRMED");
    if (n === 0)
      expect(
        (await S.submit(cap, { ...input, clientRequestId: fixtureId(2799) }))
          .state,
      ).toBe("RATE_LIMITED");
    now += 5001;
  }
  expect(
    (await S.submit(cap, { ...input, clientRequestId: fixtureId(2800) })).state,
  ).toBe("LIMIT_REACHED");
  expect(all().filter((r) => r.entityType === "RESTAURANT_ORDER")).toHaveLength(
    20,
  );
});
test("DIRECT canonical change after staging demands review without sale effects", async () => {
  const input = await directBody("Grilled Chicken");
  const original = E.mutate.bind(E);
  const spy = jest
    .spyOn(E, "mutate")
    .mockRejectedValueOnce(new Error("transport"));
  await expect(S.submit(cap, input)).rejects.toBeDefined();
  patch(
    K.restaurantMenuItemSK(f.outlet.id, f.items[0].categoryId, f.items[0].id),
    { version: 2, availability: "UNAVAILABLE" },
  );
  spy.mockImplementation(original);
  expect((await S.submit(cap, input)).state).toBe("REVIEW_REQUIRED");
  expect(all().filter((r) => r.entityType === "RESTAURANT_ORDER")).toHaveLength(
    0,
  );
  expect(
    all().filter((r) => r.entityType === "RESTAURANT_GUEST_ORDER_REQUEST")[0]
      .data.state,
  ).toBe("EXPIRED");
  const retry = await S.submit(cap, input);
  if (retry.state !== "CONFIRMED") throw Error();
  expect(retry.request.state).toBe("EXPIRED");
});
test("DIRECT accepted retry remains reconciliation when sending is subsequently disabled", async () => {
  const input = await directBody();
  const original = await S.submit(cap, input);
  patch(K.restaurantSK(), { guestOrderingPolicy: "DISABLED", version: 2 });
  expect(await S.submit(cap, input)).toEqual(original);
  expect(all().filter((r) => r.entityType === "RESTAURANT_ORDER")).toHaveLength(
    1,
  );
});
test("DIRECT unaccepted staged intent cannot outlive selection authority", async () => {
  const input = await directBody();
  const original = E.mutate.bind(E);
  const spy = jest
    .spyOn(E, "mutate")
    .mockRejectedValueOnce(new Error("transport"));
  await expect(S.submit(cap, input)).rejects.toBeDefined();
  spy.mockImplementation(original);
  jest.useFakeTimers({ now: Date.now() + 900001 });
  const result = await S.submit(cap, input);
  expect(result.state).toBe("CONFIRMED");
  if (result.state !== "CONFIRMED") throw Error();
  expect(result.request.state).toBe("EXPIRED");
  expect(
    all().filter((row) => row.entityType === "RESTAURANT_ORDER"),
  ).toHaveLength(0);
});
test("DIRECT canonical order is discoverable by existing Table Workspace reads", async () => {
  await S.submit(cap, await directBody());
  const { RestaurantTransactionQueries: Q } =
    await import("@/lambda/domains/restaurants/transaction-queries");
  const orders = await Q.run(
    scope,
    "SESSION_ORDERS",
    { limit: 50 },
    { sessionId: scope.sessionId },
    true,
  );
  expect(orders.items).toHaveLength(1);
  expect((orders.items[0] as c.RestaurantOrder).orderType).toBe("DINE_IN");
  expect((orders.items[0] as c.RestaurantOrder).status).toBe("SUBMITTED");
});

async function freeTable(policy: "DIRECT" | "STAFF_APPROVAL" | "DISABLED") {
  const session = await E.session(scope, scope.sessionId);
  await E.mutate(
    { ...scope, actorId: "owner" },
    "CLOSE_SESSION",
    { clientRequestId: fixtureId(3000), expectedVersion: session.data.version },
    { sessionId: scope.sessionId },
  );
  patch(K.restaurantSK(), { guestOrderingPolicy: policy });
  cap = await resolve();
}
async function openFreeTable(commandId = 3001) {
  return E.mutate({ ...scope, actorId: "owner" }, "OPEN_SESSION", {
    clientRequestId: fixtureId(commandId),
    tableId: f.tables[0].id,
    areaId: f.areas[0].id,
  });
}
test.each(["DIRECT", "STAFF_APPROVAL"] as const)(
  "FREE %s persists one isolated pre-service intent without commercial effects",
  async (policy) => {
    await freeTable(policy);
    const input = await body(3002);
    const before = all().filter((r) =>
      /GUEST_SESSION|ORDER$|ORDER_ITEM|PREPARATION|PAYMENT/.test(r.entityType),
    );
    const [a, b] = await Promise.all([
      S.submit(cap, input),
      S.submit(cap, input),
    ]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      state: "CONFIRMED",
      request: { state: "PENDING_SERVICE" },
    });
    expect(
      all().filter((r) =>
        /GUEST_SESSION|ORDER$|ORDER_ITEM|PREPARATION|PAYMENT/.test(
          r.entityType,
        ),
      ),
    ).toEqual(before);
    const requests = all().filter(
      (r) => r.entityType === "RESTAURANT_GUEST_ORDER_REQUEST",
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].sessionId).toBeUndefined();
    expect(requests[0].directStage).toBeUndefined();
    expect(await S.own(await resolve())).toMatchObject({
      state: "READY",
      requests: [],
    });
    const { WaiterCalls } =
      await import("@/lambda/domains/restaurants/waiter-call");
    expect(await WaiterCalls.activity(scope, "owner")).toMatchObject({
      items: [],
      preServiceRequests: [{ tableId: f.tables[0].id }],
    });
  },
);
test("FREE DISABLED blocks new requests without effects", async () => {
  await freeTable("DISABLED");
  expect((await S.submit(cap, await body(3002))).state).toBe("NOT_ALLOWED");
  expect(
    all().filter((r) => r.entityType === "RESTAURANT_GUEST_ORDER_REQUEST"),
  ).toHaveLength(0);
});
test.each(["DIRECT", "STAFF_APPROVAL"] as const)(
  "opening binds %s to exactly one canonical service, replay is idempotent",
  async (policy) => {
    await freeTable(policy);
    const oldCap = cap;
    const input = await body(3002);
    const submitted = await S.submit(cap, input);
    if (submitted.state !== "CONFIRMED") throw Error();
    const guestSecret = process.env.RESTAURANTS_GUEST_SECRET_ARN;
    delete process.env.RESTAURANTS_GUEST_SECRET_ARN;
    let opened: c.GuestSession;
    try {
      opened = c.GuestSessionSchema.parse((await openFreeTable()).data);
    } finally {
      process.env.RESTAURANTS_GUEST_SECRET_ARN = guestSecret;
    }
    const openedScope = { ...scope, sessionId: opened.guestSessionId };
    const row = await S.row(openedScope, submitted.request.requestId);
    expect(row?.sessionId).toBe(opened.guestSessionId);
    expect(row?.data.state).toBe(
      policy === "DIRECT" ? "ACCEPTED" : "PENDING_APPROVAL",
    );
    expect(
      all().filter(
        (r) =>
          r.entityType === "RESTAURANT_GUEST_SESSION" &&
          r.data.status === "OPEN",
      ),
    ).toHaveLength(1);
    expect(
      all().filter((r) => r.entityType === "RESTAURANT_ORDER"),
    ).toHaveLength(policy === "DIRECT" ? 1 : 0);
    expect(
      c.GuestSessionSchema.parse((await openFreeTable()).data).guestSessionId,
    ).toBe(opened.guestSessionId);
    const recovered = await GuestService.resolve({
      token,
      previousCapability: oldCap,
    });
    if (recovered.state !== "OCCUPIED") throw Error();
    expect((await S.submit(recovered.capability, input)).state).toBe(
      "CONFIRMED",
    );
    expect(await S.own(recovered.capability)).toMatchObject({
      state: "READY",
      requests: [
        {
          requestId: submitted.request.requestId,
          state: policy === "DIRECT" ? "ACCEPTED" : "PENDING_APPROVAL",
        },
      ],
    });
    if (policy === "STAFF_APPROVAL")
      await S.review(
        openedScope,
        "owner",
        submitted.request.requestId,
        "approve",
      );
    expect(
      all().filter((r) => r.entityType === "RESTAURANT_ORDER"),
    ).toHaveLength(1);
  },
);
test("public FREE DIRECT request reaches a canonical order when staff opening has no Guest secret", async () => {
  await freeTable("DIRECT");
  const input = await body(3300);
  const carte = await GuestCarteService.read(cap);
  if (carte.body.state !== "READY") throw Error();
  const chicken = carte.body.categories
    .flatMap((category) => category.items)
    .find((entry) => entry.name === "Grilled Chicken");
  if (!chicken) throw Error();
  input.lines.push({
    reference: chicken.reference,
    selectionRef: chicken.selectionRef,
    quantity: 2,
    note: "",
    presentedAmountMinor: chicken.amountMinor,
    currency: carte.body.currency,
  });
  expect(c.GuestSubmissionRequestSchema.safeParse(input)).toMatchObject({
    success: true,
  });
  const originalCapability = cap;
  const { handler } = await import("@/lambda/domains/restaurants/guest-public");
  const response = await handler({
    routeKey: "POST /public/restaurants/guest/submissions",
    body: JSON.stringify(input),
    headers: { authorization: "Bearer " + cap },
    requestContext: { requestId: "free-direct-opening" },
  } as never);
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body)).toMatchObject({
    state: "CONFIRMED",
    request: { state: "PENDING_SERVICE" },
  });
  expect(
    all().filter((row) => row.entityType === "RESTAURANT_ORDER"),
  ).toHaveLength(0);
  const guestSecret = process.env.RESTAURANTS_GUEST_SECRET_ARN;
  delete process.env.RESTAURANTS_GUEST_SECRET_ARN;
  let opened: c.GuestSession;
  try {
    opened = c.GuestSessionSchema.parse((await openFreeTable()).data);
  } finally {
    process.env.RESTAURANTS_GUEST_SECRET_ARN = guestSecret;
  }
  const orders = all().filter((row) => row.entityType === "RESTAURANT_ORDER");
  expect(orders).toHaveLength(1);
  expect(orders[0].data.guestSessionId).toBe(opened.guestSessionId);
  expect(orders[0].data.orderType).toBe("DINE_IN");
  expect(orders[0].data.status).toBe("SUBMITTED");
  expect(orders[0].data.dueMinor).toBe(14000);
  const lines = all().filter(
    (row) => row.entityType === "RESTAURANT_ORDER_ITEM",
  );
  expect(lines).toHaveLength(2);
  expect(
    lines
      .map((line) => line.data.snapshot?.lineTotalMinor)
      .sort((a, b) => a - b),
  ).toEqual([4000, 10000]);
  expect((await E.session(scope, opened.guestSessionId)).data).toMatchObject({
    status: "OPEN",
    dueMinor: 14000,
    orderCount: 1,
    openOrderCount: 1,
  });
  const preparation = all().filter(
    (row) => row.entityType === "RESTAURANT_PREPARATION",
  );
  expect(preparation).toHaveLength(1);
  expect(preparation[0].data.state).toBe("IN_PROGRESS");
  expect(
    lines.find((line) => line.data.snapshot?.name === "Chocolate Cake")?.data
      .latestFireId,
  ).toBeUndefined();
  const recovered = await GuestService.resolve({
    token,
    previousCapability: originalCapability,
  });
  if (recovered.state !== "OCCUPIED") throw Error();
  expect(await S.own(recovered.capability)).toMatchObject({
    state: "READY",
    requests: [{ state: "ACCEPTED", mode: "DIRECT", orderStatus: "PREPARING" }],
  });
  const { RestaurantTransactionQueries: Q } =
    await import("@/lambda/domains/restaurants/transaction-queries");
  expect(
    (
      await Q.run(
        { orgId: org, outletId: f.outlet.id },
        "SESSION_ORDERS",
        { limit: 50 },
        { sessionId: opened.guestSessionId },
        true,
      )
    ).items,
  ).toHaveLength(1);
  const replay = c.GuestSessionSchema.parse((await openFreeTable()).data);
  expect(replay.guestSessionId).toBe(opened.guestSessionId);
  expect(
    all().filter((row) => row.entityType === "RESTAURANT_ORDER"),
  ).toHaveLength(1);
});
test("changed pre-service DIRECT price remains durable and visible without sale effects", async () => {
  await freeTable("DIRECT");
  const originalCapability = cap;
  const submitted = await S.submit(cap, await body(3301));
  if (submitted.state !== "CONFIRMED") throw Error();
  for (const entry of f.items)
    patch(K.restaurantMenuItemSK(f.outlet.id, entry.categoryId, entry.id), {
      version: entry.version + 1,
      price: { ...entry.price, amountMinor: entry.price.amountMinor + 100 },
    });
  const guestSecret = process.env.RESTAURANTS_GUEST_SECRET_ARN;
  delete process.env.RESTAURANTS_GUEST_SECRET_ARN;
  let opened: c.GuestSession;
  try {
    opened = c.GuestSessionSchema.parse((await openFreeTable()).data);
  } finally {
    process.env.RESTAURANTS_GUEST_SECRET_ARN = guestSecret;
  }
  const sessionScope = { ...scope, sessionId: opened.guestSessionId };
  expect(
    (await S.row(sessionScope, submitted.request.requestId))?.data.state,
  ).toBe("EXPIRED");
  expect(
    all().filter((row) => row.entityType === "RESTAURANT_ORDER"),
  ).toHaveLength(0);
  expect(
    all().filter((row) => row.entityType === "RESTAURANT_ORDER_ITEM"),
  ).toHaveLength(0);
  expect(
    all().filter((row) => row.entityType === "RESTAURANT_PREPARATION"),
  ).toHaveLength(0);
  expect((await E.session(scope, opened.guestSessionId)).data.dueMinor).toBe(0);
  const recovered = await GuestService.resolve({
    token,
    previousCapability: originalCapability,
  });
  if (recovered.state !== "OCCUPIED") throw Error();
  expect(await S.own(recovered.capability)).toMatchObject({
    state: "READY",
    requests: [{ requestId: submitted.request.requestId, state: "EXPIRED" }],
  });
  expect((await S.list(sessionScope, "owner")).requests).toMatchObject([
    { requestId: submitted.request.requestId, state: "EXPIRED" },
  ]);
});
test("multiple phones bind independently to one service and keep private results", async () => {
  await freeTable("DIRECT");
  const firstCap = cap;
  const a = await S.submit(cap, await body(3002));
  cap = await resolve();
  const secondCap = cap;
  jest.spyOn(Date, "now").mockReturnValue(Date.now() + 6000);
  const b = await S.submit(cap, await body(3003));
  expect(a.state).toBe("CONFIRMED");
  expect(b.state).toBe("CONFIRMED");
  const guestSecret = process.env.RESTAURANTS_GUEST_SECRET_ARN;
  delete process.env.RESTAURANTS_GUEST_SECRET_ARN;
  try {
    await openFreeTable();
  } finally {
    process.env.RESTAURANTS_GUEST_SECRET_ARN = guestSecret;
  }
  for (const phone of [firstCap, secondCap]) {
    const context = await GuestService.resolve({
      token,
      previousCapability: phone,
    });
    if (!("capability" in context)) throw Error();
    const state = await S.own(context.capability);
    if (state.state !== "READY") throw Error();
    expect(state.requests).toHaveLength(1);
  }
  expect(all().filter((r) => r.entityType === "RESTAURANT_ORDER")).toHaveLength(
    2,
  );
  expect(
    all().filter(
      (r) =>
        r.entityType === "RESTAURANT_GUEST_SESSION" && r.data.status === "OPEN",
    ),
  ).toHaveLength(1);
});
test("expired pending intent cannot bind or migrate into a later service", async () => {
  await freeTable("STAFF_APPROVAL");
  const submitted = await S.submit(cap, await body(3002));
  if (submitted.state !== "CONFIRMED") throw Error();
  jest.spyOn(Date, "now").mockReturnValue(Date.now() + 900001);
  const first = c.GuestSessionSchema.parse((await openFreeTable()).data);
  expect(
    (await S.rows({ ...scope, sessionId: first.guestSessionId })).rows,
  ).toHaveLength(0);
  const row = await S.row(
    { orgId: org, outletId: f.outlet.id, tableId: f.tables[0].id },
    submitted.request.requestId,
  );
  expect(row?.data.state).toBe("EXPIRED");
  expect(row?.sessionId).toBeUndefined();
  await E.mutate(
    { ...scope, actorId: "owner" },
    "CLOSE_SESSION",
    { clientRequestId: fixtureId(3004), expectedVersion: first.version },
    { sessionId: first.guestSessionId },
  );
  const later = c.GuestSessionSchema.parse((await openFreeTable(3005)).data);
  expect(
    (await S.rows({ ...scope, sessionId: later.guestSessionId })).rows,
  ).toHaveLength(0);
});
test.each(["price", "availability", "policy"])(
  "opening revalidates %s and never silently substitutes Guest intent",
  async (change) => {
    await freeTable("DIRECT");
    const input = await body(3002);
    await S.submit(cap, input);
    if (change === "policy")
      patch(K.restaurantSK(), {
        guestOrderingPolicy: "STAFF_APPROVAL",
        version: f.restaurant.version + 1,
      });
    else
      for (const entry of f.items)
        patch(K.restaurantMenuItemSK(f.outlet.id, entry.categoryId, entry.id), {
          version: entry.version + 1,
          ...(change === "price"
            ? {
                price: {
                  ...entry.price,
                  amountMinor: entry.price.amountMinor + 100,
                },
              }
            : { availability: "UNAVAILABLE" }),
        });
    await openFreeTable();
    expect(
      all().filter((r) => r.entityType === "RESTAURANT_ORDER"),
    ).toHaveLength(0);
    expect(
      all().filter((r) => r.entityType === "RESTAURANT_PREPARATION"),
    ).toHaveLength(0);
  },
);

test("a first submission racing an initially empty opening snapshot binds in the retried canonical opening", async () => {
  await freeTable("DIRECT");
  const input = await body(3100);
  const original = S.bindOpening.bind(S);
  jest.spyOn(S, "bindOpening").mockImplementationOnce(async (session) => {
    const guards = await original(session);
    expect((await S.submit(cap, input)).state).toBe("CONFIRMED");
    return guards;
  });
  const session = c.GuestSessionSchema.parse((await openFreeTable()).data);
  const rows = (await S.rows({ ...scope, sessionId: session.guestSessionId }))
    .rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].data.state).toBe("ACCEPTED");
  expect(
    all().filter(
      (r) =>
        r.entityType === "RESTAURANT_GUEST_SESSION" && r.data.status === "OPEN",
    ),
  ).toHaveLength(1);
  expect(all().filter((r) => r.entityType === "RESTAURANT_ORDER")).toHaveLength(
    1,
  );
});
test("revoking QR before opening invalidates its pending pre-service intent", async () => {
  await freeTable("STAFF_APPROVAL");
  await S.submit(cap, await body(3100));
  const key = JSON.stringify([
    K.orgKey(org),
    K.restaurantTableSK(f.outlet.id, f.areas[0].id, f.tables[0].id),
  ]);
  m.rows.set(
    key,
    marshall({ ...unmarshall(m.rows.get(key)!), qrRevoked: true }),
  );
  const opened = c.GuestSessionSchema.parse((await openFreeTable()).data);
  expect(
    (await S.rows({ ...scope, sessionId: opened.guestSessionId })).rows,
  ).toHaveLength(0);
  expect(all().filter((r) => r.entityType === "RESTAURANT_ORDER")).toHaveLength(
    0,
  );
});

test("lost opening acknowledgement still continues its bound DIRECT intent exactly once", async () => {
  await freeTable("DIRECT");
  await S.submit(cap, await body(3200));
  const { RestaurantTransactionsRepository: Repository } =
    await import("@/lambda/domains/restaurants/transaction-repository");
  const original = Repository.commit.bind(Repository);
  jest
    .spyOn(Repository, "commit")
    .mockImplementationOnce(async (actions, limit) => {
      await original(actions, limit);
      throw new Error("Lost acknowledgement");
    });
  await openFreeTable();
  await openFreeTable();
  expect(all().filter((r) => r.entityType === "RESTAURANT_ORDER")).toHaveLength(
    1,
  );
});
