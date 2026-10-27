import { randomUUID } from "crypto";
import { InventoryTrackingService as T } from "@/lambda/domains/restaurants/inventory-tracking-service";
import { RestaurantInventoryService as I } from "@/lambda/domains/restaurants/inventory-service";
import { RestaurantsService as M } from "@/lambda/domains/restaurants/restaurant-service";
import { InventoryRepository as R } from "@/lambda/domains/restaurants/inventory-repository";
import { handler } from "@/lambda/domains/restaurants/get-outlet";
import { TRACKING_PATH } from "@/lambda/domains/restaurants/inventory-routes";
import { memoryDynamo } from "./memory-dynamo";
import { acceptanceFixture } from "./acceptance-fixture";
let memory: ReturnType<typeof memoryDynamo>;
let fixture: Awaited<ReturnType<typeof acceptanceFixture>>;
const orgId = "org-resto",
  actor = "owner";
const scope = () => ({ orgId, outletId: fixture.outlet.id });
const menu = () => fixture.items[4]; // The fixture's no-station item.
const create = (expectedVersion = 0, unit = "BOTTLE") => ({
  categoryId: menu().categoryId,
  expectedVersion,
  clientRequestId: randomUUID(),
  mode: "CREATE",
  unit,
});
const stock = (unit = "BOTTLE") =>
  I.create(scope(), { id: randomUUID(), name: "Independent stock", unit });
beforeEach(async () => {
  memory = memoryDynamo();
  fixture = await acceptanceFixture();
});
afterEach(() => {
  memory.db.restore();
  jest.restoreAllMocks();
});
test("atomic automatic creation starts at zero and concurrent/repeated retries create one item", async () => {
  const input = create();
  const [a, b] = await Promise.all([
    T.save(scope(), menu().id, actor, input),
    T.save(scope(), menu().id, actor, input),
  ]);
  expect(a).toEqual(b);
  expect(a.stockItem).toMatchObject({
    name: menu().name,
    unit: "BOTTLE",
    balanceMilli: 0,
    isActive: true,
  });
  expect((await I.list(scope())).items).toHaveLength(1);
  expect(await T.read(scope(), menu().categoryId, menu().id)).toEqual(a);
  const tx = memory.transactions.find((t) =>
    t.TransactItems?.some(
      (x) =>
        x.Put?.Item?.entityType?.S === "RESTAURANT_INVENTORY_TRACKING_COMMAND",
    ),
  );
  expect(tx?.TransactItems).toHaveLength(4);
  expect((await I.history(scope(), a.stockItem!.id)).items).toEqual([]);
  await expect(
    T.save(scope(), menu().id, actor, { ...input, unit: "CAN" }),
  ).rejects.toMatchObject({ statusCode: 409 });
});
test.each(["UNIT", "CAN", "PACK"])(
  "automatic creation supports discrete %s",
  async (unit) => {
    const result = await T.save(scope(), menu().id, actor, create(0, unit));
    expect(result.stockItem).toMatchObject({ unit, balanceMilli: 0 });
  },
);
test.each(["KG", "G", "L", "ML"])(
  "continuous %s rejected for create and existing link",
  async (unit) => {
    await expect(
      T.save(scope(), menu().id, actor, create(0, unit)),
    ).rejects.toThrow();
    const target = await stock(unit);
    await expect(
      T.save(scope(), menu().id, actor, link(target.id)),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(
      (await T.read(scope(), menu().categoryId, menu().id)).stockItem,
    ).toBeNull();
  },
);
const link = (
  stockItemId: string,
  expectedVersion = 0,
  categoryId = menu().categoryId,
) => ({
  categoryId,
  expectedVersion,
  clientRequestId: randomUUID(),
  mode: "LINK",
  stockItemId,
});
test("replace/remove preserve independent stock, balance/history and tombstone concurrency", async () => {
  const a = await stock(),
    b = await stock("CAN");
  await I.applyMovement(scope(), {
    stockItemId: a.id,
    type: "RECEIPT",
    quantityMilli: 2000,
    actorId: actor,
    source: "MANUAL",
  });
  const before = await I.get(scope(), a.id),
    history = await I.history(scope(), a.id);
  await T.save(scope(), menu().id, actor, link(a.id));
  await T.save(scope(), menu().id, actor, link(b.id, 1));
  await expect(
    T.save(scope(), menu().id, actor, link(a.id, 1)),
  ).rejects.toMatchObject({ statusCode: 409 });
  const removal = {
    categoryId: menu().categoryId,
    expectedVersion: 2,
    clientRequestId: randomUUID(),
  };
  expect(
    (await T.save(scope(), menu().id, actor, removal, true)).stockItem,
  ).toBeNull();
  expect(await I.resolveMapping(scope(), menu().id)).toBeUndefined();
  await expect(
    T.save(scope(), menu().id, actor, link(a.id, 0)),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(await I.get(scope(), a.id)).toEqual(before);
  expect(await I.history(scope(), a.id)).toEqual(history);
  expect((await I.get(scope(), b.id)).isActive).toBe(true);
});
test("many MenuItems may share one stock item; names and lifecycle stay independent", async () => {
  const target = await stock();
  await T.save(scope(), menu().id, actor, link(target.id));
  const second = await M.create(
    orgId,
    actor,
    "item",
    { outletId: fixture.outlet.id, categoryId: menu().categoryId },
    {
      name: "Second",
      clientRequestId: randomUUID(),
      price: menu().price,
      guestReorderEnabled: false,
    },
  );
  await T.save(scope(), second.id, actor, link(target.id));
  const renamed = await M.update(
    orgId,
    actor,
    "item",
    { outletId: fixture.outlet.id, categoryId: menu().categoryId },
    menu().id,
    { expectedVersion: menu().version, name: "Renamed menu item" },
  );
  expect((await I.get(scope(), target.id)).name).toBe(target.name);
  await M.update(
    orgId,
    actor,
    "item",
    { outletId: fixture.outlet.id, categoryId: menu().categoryId },
    menu().id,
    { expectedVersion: renamed.version },
    "deactivate",
  );
  expect((await I.get(scope(), target.id)).isActive).toBe(true);
  await I.update(scope(), target.id, {
    expectedVersion: 1,
    name: "Renamed stock",
    isActive: false,
  });
  expect(
    (await T.read(scope(), menu().categoryId, menu().id)).stockItem,
  ).toMatchObject({ isActive: false, name: "Renamed stock" });
  expect(
    (
      await M.get(
        orgId,
        "item",
        { outletId: fixture.outlet.id, categoryId: menu().categoryId },
        menu().id,
      )
    ).name,
  ).toBe(renamed.name);
  expect((await I.get(scope(), target.id)).isActive).toBe(false);
  expect((await I.resolveMapping(scope(), second.id))?.stockItemId).toBe(
    target.id,
  );
});
test("inactive/foreign targets and station-backed items cannot be newly linked", async () => {
  const target = await stock();
  await I.update(scope(), target.id, { expectedVersion: 1, isActive: false });
  await expect(
    T.save(scope(), menu().id, actor, link(target.id)),
  ).rejects.toMatchObject({ statusCode: 400 });
  await expect(
    T.save({ ...scope(), outletId: randomUUID() }, menu().id, actor, create()),
  ).rejects.toThrow();
  await expect(
    T.save({ ...scope(), orgId: "foreign" }, menu().id, actor, create()),
  ).rejects.toThrow();
  await expect(
    T.save(scope(), menu().id, actor, link(randomUUID())),
  ).rejects.toMatchObject({ statusCode: 404 });
  await expect(
    T.save(scope(), fixture.items[0].id, actor, {
      ...create(),
      categoryId: fixture.items[0].categoryId,
    }),
  ).rejects.toMatchObject({ statusCode: 400 });
});
test("failed transaction cannot leave an orphan automatic stock item", async () => {
  jest.spyOn(R, "commit").mockRejectedValueOnce(
    Object.assign(new Error("Conflict"), {
      name: "TransactionCanceledException",
    }),
  );
  await expect(
    T.save(scope(), menu().id, actor, create()),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect((await I.list(scope())).items).toEqual([]);
  expect(
    (await T.read(scope(), menu().categoryId, menu().id)).stockItem,
  ).toBeNull();
});
test("legacy unversioned links can be read and safely replaced", async () => {
  const a = await stock(),
    b = await stock("CAN");
  await T.save(scope(), menu().id, actor, link(a.id));
  const raw = [...memory.rows.values()].find(
    (row) => row.entityType?.S === "RESTAURANT_STOCK_MAPPING",
  )!;
  delete raw.data.M!.version;
  delete raw.data.M!.removed;
  expect((await T.read(scope(), menu().categoryId, menu().id)).version).toBe(1);
  const changed = await T.save(scope(), menu().id, actor, link(b.id, 1));
  expect(changed.version).toBe(2);
  expect(changed.stockItem?.id).toBe(b.id);
});
test("a linked item cannot concurrently acquire a preparation station", async () => {
  const target = await stock();
  await T.save(scope(), menu().id, actor, link(target.id));
  await expect(
    M.update(
      orgId,
      actor,
      "item",
      { outletId: fixture.outlet.id, categoryId: menu().categoryId },
      menu().id,
      { expectedVersion: 1, preparationStationId: fixture.stations[0].id },
    ),
  ).rejects.toThrow();
});
test.each(["OWNER", "MANAGER", "WAITER", "CASHIER", "KITCHEN"])(
  "tracking API enforces %s management permission",
  async (role) => {
    memory.seedAccess(orgId, actor, role as "OWNER");
    const event = {
      routeKey: `GET ${TRACKING_PATH}`,
      headers: { "x-org-id": orgId },
      queryStringParameters: { categoryId: menu().categoryId },
      pathParameters: { outletId: fixture.outlet.id, menuItemId: menu().id },
      requestContext: { authorizer: { jwt: { claims: { sub: actor } } } },
    };
    const response = await handler(event as never);
    expect(response.statusCode).toBe(
      ["OWNER", "MANAGER"].includes(role) ? 200 : 403,
    );
    expect(response.body).not.toMatch(/"PK"|"SK"/);
    const put = await handler({
      ...event,
      routeKey: `PUT ${TRACKING_PATH}`,
      queryStringParameters: undefined,
      body: JSON.stringify(create()),
    } as never);
    expect(put.statusCode).toBe(
      ["OWNER", "MANAGER"].includes(role) ? 200 : 403,
    );
    const remove = await handler({
      ...event,
      routeKey: `DELETE ${TRACKING_PATH}`,
      queryStringParameters: undefined,
      body: JSON.stringify({
        categoryId: menu().categoryId,
        expectedVersion: 1,
        clientRequestId: randomUUID(),
      }),
    } as never);
    expect(remove.statusCode).toBe(
      ["OWNER", "MANAGER"].includes(role) ? 200 : 403,
    );
  },
);
test("cross-outlet and cross-organization stock references fail even when IDs exist", async () => {
  const target = await stock();
  const otherOrg = await acceptanceFixture("other-org");
  const otherOutlet = await M.create(
    orgId,
    actor,
    "outlet",
    {},
    { name: "Another outlet", clientRequestId: randomUUID() },
  );
  const localOther = await I.create(
    { orgId, outletId: otherOutlet.id },
    { id: randomUUID(), name: "Other outlet stock", unit: "UNIT" },
  );
  const foreign = await I.create(
    { orgId: "other-org", outletId: otherOrg.outlet.id },
    { id: randomUUID(), name: "Foreign stock", unit: "UNIT" },
  );
  for (const id of [localOther.id, foreign.id])
    await expect(
      T.save(scope(), menu().id, actor, link(id)),
    ).rejects.toMatchObject({ statusCode: 404 });
  expect((await I.get(scope(), target.id)).balanceMilli).toBe(0);
});
test.each(["GET", "PUT", "DELETE"])(
  "tracking %s rejects disabled ProductAccess and malformed input",
  async (method) => {
    const event = {
      routeKey: `${method} ${TRACKING_PATH}`,
      headers: { "x-org-id": orgId },
      ...(method === "GET"
        ? { queryStringParameters: { categoryId: menu().categoryId } }
        : { body: JSON.stringify(create()) }),
      pathParameters: { outletId: fixture.outlet.id, menuItemId: menu().id },
      requestContext: { authorizer: { jwt: { claims: { sub: actor } } } },
    };
    memory.seedAccess(orgId, actor, "OWNER", false);
    expect((await handler(event as never)).statusCode).toBe(403);
    memory.seedAccess(orgId, actor, "OWNER");
    expect(
      (await handler({ ...event, body: "{invalid" } as never)).statusCode,
    ).toBe(400);
  },
);
