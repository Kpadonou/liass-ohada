import {
  BatchGetItemCommand,
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  MenuItemsBrowseRequestSchema,
  MenuItemsBrowseResponseSchema,
  normalizeMenuItemSearch,
  matchesMenuItemSearch,
} from "@liass-ohada/shared/restaurants";
import { RestaurantsService as service } from "@/lambda/domains/restaurants/restaurant-service";
import { RestaurantsRepository as repo } from "@/lambda/domains/restaurants/restaurant-repository";
import { restaurantsHandler } from "@/lambda/domains/restaurants/restaurant-handler";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { acceptanceFixture } from "./acceptance-fixture";
import { fixtureId, memoryDynamo } from "./memory-dynamo";
const org = "org-resto";
let memory: ReturnType<typeof memoryDynamo>;
beforeEach(() => {
  memory = memoryDynamo();
  jest.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  memory.db.restore();
  jest.restoreAllMocks();
});
const event = (outletId: string, q?: string, tenant = org) => ({
  headers: { "x-org-id": tenant },
  pathParameters: { outletId },
  queryStringParameters: q ? { q } : {},
  requestContext: { authorizer: { jwt: { claims: { sub: "reader" } } } },
});
const handler = restaurantsHandler("browse-menu-items");

test("unified page spans categories, hydrates metadata in one batch, uses only bounded base-table reads", async () => {
  const f = await acceptanceFixture();
  memory.db.resetHistory();
  const result = await service.browseMenuItems(org, f.outlet.id, {});
  expect(result.items).toHaveLength(5);
  expect(new Set(result.items.map((i) => i.categoryId)).size).toBe(3);
  for (const item of result.items) {
    expect(item.categoryName).toBe(
      f.categories.find((c) => c.id === item.categoryId)!.name,
    );
    expect(item.version).toBe(1);
    expect(item.price.currency).toBe("XOF");
    expect(item).not.toHaveProperty("PK");
    expect(item).not.toHaveProperty("entityType");
  }
  expect(MenuItemsBrowseResponseSchema.parse(result)).toEqual(result);
  expect(memory.db.commandCalls(GetItemCommand)).toHaveLength(3);
  const query = memory.db.commandCalls(QueryCommand);
  expect(query).toHaveLength(1);
  expect(unmarshall(query[0].args[0].input.ExpressionAttributeValues!)).toEqual(
    {
      ":pk": K.orgKey(org),
      ":prefix": K.restaurantOutletMenuItemPrefix(f.outlet.id),
    },
  );
  expect(query[0].args[0].input).toMatchObject({
    Limit: 50,
    ConsistentRead: true,
    ScanIndexForward: true,
  });
  expect(query[0].args[0].input.IndexName).toBeUndefined();
  expect(query[0].args[0].input.FilterExpression).toBeUndefined();
  expect(memory.db.commandCalls(BatchGetItemCommand)).toHaveLength(1);
  expect(memory.db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});
test("stable key-order pagination crosses categories without missing or duplicating items", async () => {
  const f = await acceptanceFixture();
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 3; page++) {
    const result = await service.browseMenuItems(org, f.outlet.id, {
      limit: 2,
      cursor,
    });
    ids.push(...result.items.map((i) => i.id));
    cursor = result.nextCursor;
    if (page < 2) expect(cursor).toBeTruthy();
  }
  expect(cursor).toBeUndefined();
  expect(new Set(ids).size).toBe(5);
  expect(ids.slice().sort()).toEqual(f.items.map((i) => i.id).sort());
  const expected = f.items
    .slice()
    .sort((a, b) =>
      K.restaurantMenuItemSK(f.outlet.id, a.categoryId, a.id).localeCompare(
        K.restaurantMenuItemSK(f.outlet.id, b.categoryId, b.id),
      ),
    )
    .map((i) => i.id);
  expect(ids).toEqual(expected);
});
test("inactive categories/items are excluded, unavailable active items remain canonical disabled choices", async () => {
  const f = await acceptanceFixture();
  const item = f.items[0],
    other = f.items[2];
  await service.update(
    org,
    "owner",
    "item",
    { outletId: f.outlet.id, categoryId: item.categoryId },
    item.id,
    { expectedVersion: 1 },
    "deactivate",
  );
  await service.update(
    org,
    "owner",
    "item",
    { outletId: f.outlet.id, categoryId: other.categoryId },
    other.id,
    { expectedVersion: 1, availability: "UNAVAILABLE" },
    "availability",
  );
  await service.update(
    org,
    "owner",
    "category",
    { outletId: f.outlet.id },
    f.categories[2].id,
    { expectedVersion: 1 },
    "deactivate",
  );
  const result = await service.browseMenuItems(org, f.outlet.id, {});
  expect(result.items.map((i) => i.id)).not.toContain(item.id);
  expect(result.items.some((i) => i.categoryId === f.categories[2].id)).toBe(
    false,
  );
  expect(result.items.find((i) => i.id === other.id)).toMatchObject({
    availability: "UNAVAILABLE",
    version: 2,
  });
});
test("normalization is shared, accent/case insensitive, AND token-prefix rather than substring/fuzzy", () => {
  expect(normalizeMenuItemSearch("  CAFÉ d’Ananas! ")).toBe("cafe d ananas");
  for (const q of ["pou", "BRA", "pou bra"])
    expect(matchesMenuItemSearch("Poulet braisé", q)).toBe(true);
  expect(matchesMenuItemSearch("Jus d’ananas frais", "ana")).toBe(true);
  expect(matchesMenuItemSearch("Café", "cafe")).toBe(true);
  expect(matchesMenuItemSearch("Poulet braisé", "oulet")).toBe(false);
  expect(matchesMenuItemSearch("Poulet braisé", "poule brax")).toBe(false);
});
test("search covers category boundaries with preserved physical-page continuation, including empty pages", async () => {
  const f = await acceptanceFixture();
  for (const item of [f.items[0], f.items[2]])
    await service.update(
      org,
      "owner",
      "item",
      { outletId: f.outlet.id, categoryId: item.categoryId },
      item.id,
      { expectedVersion: 1, name: "Café ananas" },
      "update",
    );
  const browse = await service.browseMenuItems(org, f.outlet.id, { limit: 1 });
  expect(browse.nextCursor).toBeTruthy();
  const empty = await service.browseMenuItems(org, f.outlet.id, {
    q: "zzzz",
    limit: 1,
  });
  expect(empty.items).toEqual([]);
  expect(empty.nextCursor).toBeTruthy();
  const results: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const result = await service.browseMenuItems(org, f.outlet.id, {
      q: "CAFÉ ANA",
      limit: 1,
      cursor,
    });
    results.push(...result.items.map((i) => i.id));
    cursor = result.nextCursor;
  }
  expect(cursor).toBeUndefined();
  expect(results.sort()).toEqual([f.items[0].id, f.items[2].id].sort());
  expect(
    (await service.browseMenuItems(org, f.outlet.id, { q: "  " })).items,
  ).toHaveLength(5);
  expect(MenuItemsBrowseRequestSchema.safeParse({ q: "p" }).success).toBe(
    false,
  );
  expect(MenuItemsBrowseRequestSchema.safeParse({ limit: 101 }).success).toBe(
    false,
  );
});
test("cursor binds organization, outlet, Menu, normalized q and collection semantics", async () => {
  const f = await acceptanceFixture();
  const page = await service.browseMenuItems(org, f.outlet.id, {
    q: "beer",
    limit: 1,
  });
  const input = { q: "beer", limit: 1, cursor: page.nextCursor };
  for (const [o, outlet, menu, q] of [
    ["foreign", f.outlet.id, f.menu.id, "beer"],
    [org, fixtureId(999), f.menu.id, "beer"],
    [org, f.outlet.id, fixtureId(998), "beer"],
    [org, f.outlet.id, f.menu.id, "water"],
  ]) {
    await expect(
      repo.menuItemsPage(o, outlet, menu, { ...input, q }),
    ).rejects.toMatchObject({ statusCode: 400 });
  }
  await expect(
    service.browseMenuItems(org, f.outlet.id, { cursor: "invalid" }),
  ).rejects.toMatchObject({ statusCode: 400 });
  await expect(
    service.browseMenuItems(org, f.outlet.id, {
      q: "BEER",
      limit: 1,
      cursor: page.nextCursor,
    }),
  ).resolves.toBeDefined();
});
test("missing Menu is not fabricated as an empty collection; inactive Menu remains unavailable", async () => {
  const f = await acceptanceFixture();
  const outlet = await service.create(
    org,
    "owner",
    "outlet",
    {},
    { clientRequestId: fixtureId(900), name: "No menu" },
  );
  await expect(
    service.browseMenuItems(org, outlet.id, {}),
  ).rejects.toMatchObject({ statusCode: 404 });
  await expect(
    service.browseMenuItems("foreign", f.outlet.id, {}),
  ).rejects.toMatchObject({ statusCode: 404 });
  // No Menu deactivation command exists; verify an existing inactive persisted parent safely fails.
  const key = JSON.stringify([K.orgKey(org), K.restaurantMenuSK(f.outlet.id)]);
  const stored = unmarshall(memory.rows.get(key)!);
  stored.data.isActive = false;
  memory.rows.set(key, marshall(stored));
  await expect(
    service.browseMenuItems(org, f.outlet.id, {}),
  ).rejects.toMatchObject({ statusCode: 409 });
});
test.each(["OWNER", "MANAGER", "WAITER", "CASHIER", "KITCHEN"])(
  "%s retains existing independent Menu-read authority",
  async (role) => {
    const f = await acceptanceFixture();
    memory.seedAccess(org, "reader", role);
    const response = await handler(event(f.outlet.id));
    expect(response.statusCode).toBe(200);
    expect(
      MenuItemsBrowseResponseSchema.parse(JSON.parse(response.body)).items,
    ).toHaveLength(5);
  },
);
test("missing role, membership/ProductAccess revocation and foreign tenant fail before Menu queries", async () => {
  const f = await acceptanceFixture();
  for (const role of ["ACCOUNTANT", ""]) {
    memory.seedAccess(org, "reader", role);
    memory.db.resetHistory();
    expect((await handler(event(f.outlet.id))).statusCode).toBe(403);
    expect(memory.db.commandCalls(QueryCommand)).toHaveLength(0);
  }
  memory.rows.delete(
    JSON.stringify([K.orgKey(org), K.productAccessSK("RESTAURANTS")]),
  );
  memory.seedAccess(org, "reader", "WAITER", false);
  expect((await handler(event(f.outlet.id))).statusCode).toBe(403);
  memory.seedAccess(org, "reader", "WAITER");
  expect(
    (await handler(event(f.outlet.id, undefined, "foreign"))).statusCode,
  ).toBe(403);
});
test("strict route contract refuses category and unknown search controls", async () => {
  const f = await acceptanceFixture();
  memory.seedAccess(org, "reader", "WAITER");
  expect(
    (
      await handler({
        ...event(f.outlet.id),
        queryStringParameters: { categoryId: f.categories[0].id },
      })
    ).statusCode,
  ).toBe(400);
  expect((await handler(event(f.outlet.id, "a"))).statusCode).toBe(400);
});
test("foreign physical rows and missing category metadata fail closed", async () => {
  const f = await acceptanceFixture();
  memory.db.on(QueryCommand).resolves({
    Items: [
      marshall({
        PK: K.orgKey("foreign"),
        SK: K.restaurantMenuItemSK(
          f.outlet.id,
          f.items[0].categoryId,
          f.items[0].id,
        ),
      }),
    ],
  });
  await expect(
    service.browseMenuItems(org, f.outlet.id, {}),
  ).rejects.toMatchObject({ statusCode: 409 });
});

test("missing or unresolved category hydration is never presented as exhaustive no results", async () => {
  const f = await acceptanceFixture();
  memory.db.on(BatchGetItemCommand).resolves({ Responses: {} });
  await expect(
    service.browseMenuItems(org, f.outlet.id, {}),
  ).rejects.toMatchObject({ statusCode: 409 });
});
test("unprocessed hydration keys are retried at most three times, then fail as temporary unavailability", async () => {
  const f = await acceptanceFixture();
  memory.db
    .on(BatchGetItemCommand)
    .callsFake(async (input) => ({ UnprocessedKeys: input.RequestItems }));
  await expect(
    service.browseMenuItems(org, f.outlet.id, {}),
  ).rejects.toMatchObject({ statusCode: 503 });
  expect(memory.db.commandCalls(BatchGetItemCommand)).toHaveLength(3);
});
test("a current membership revocation prevents subsequent unified reads", async () => {
  const f = await acceptanceFixture();
  memory.seedAccess(org, "reader", "WAITER");
  expect((await handler(event(f.outlet.id))).statusCode).toBe(200);
  for (const [key, raw] of memory.rows) {
    const value = unmarshall(raw);
    if (value.entityType === "USER_ORG_ACCESS") {
      value.status = "INACTIVE";
      memory.rows.set(key, marshall(value));
    }
  }
  memory.db.resetHistory();
  expect((await handler(event(f.outlet.id))).statusCode).toBe(403);
  expect(memory.db.commandCalls(QueryCommand)).toHaveLength(0);
});
