import crypto = require("crypto");
import { GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { RestaurantsService as service } from "@/lambda/domains/restaurants/restaurant-service";
import { RestaurantsRepository } from "@/lambda/domains/restaurants/restaurant-repository";
import { acceptanceFixture } from "./acceptance-fixture";
import { fixtureId, memoryDynamo } from "./memory-dynamo";

let memory: ReturnType<typeof memoryDynamo>;
const org = "org-resto";
const command = (number: number, name: string) => ({
  clientRequestId: fixtureId(number),
  name,
});
const status = (statusCode: number) => ({ statusCode });
beforeEach(() => {
  memory = memoryDynamo();
  jest.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  memory.db.restore();
  jest.restoreAllMocks();
});

describe("RESTO-1A application/persistence acceptance", () => {
  test("Héritage Bistro fixture is readable through every supported access pattern", async () => {
    const f = await acceptanceFixture();
    const context = { outletId: f.outlet.id };
    expect((await service.get(org, "restaurant", {})).guestOrderingPolicy).toBe(
      "STAFF_APPROVAL",
    );
    expect((await service.list(org, "outlet", {}, {})).items).toEqual([
      f.outlet,
    ]);
    expect(await service.get(org, "outlet", {}, f.outlet.id)).toEqual(f.outlet);
    expect(
      (await service.list(org, "serviceArea", context, {})).items,
    ).toHaveLength(2);
    expect(
      (await service.list(org, "station", context, {})).items,
    ).toHaveLength(2);
    expect(await service.get(org, "menu", context)).toEqual(f.menu);
    expect(
      (await service.list(org, "category", context, {})).items,
    ).toHaveLength(3);
    for (const area of f.areas) {
      expect(await service.get(org, "serviceArea", context, area.id)).toEqual(
        area,
      );
      expect(
        (
          await service.list(
            org,
            "table",
            { ...context, serviceAreaId: area.id },
            {},
          )
        ).items,
      ).toHaveLength(2);
    }
    for (const station of f.stations)
      expect(await service.get(org, "station", context, station.id)).toEqual(
        station,
      );
    for (const category of f.categories)
      expect(await service.get(org, "category", context, category.id)).toEqual(
        category,
      );
    for (const item of f.items)
      expect(
        await service.get(
          org,
          "item",
          { ...context, categoryId: item.categoryId },
          item.id,
        ),
      ).toEqual(item);
    expect(
      (
        await service.list(
          org,
          "item",
          { ...context, categoryId: f.categories[1].id },
          {},
        )
      ).items.map((item) => item.guestReorderEnabled),
    ).toEqual([true, true]);
    const tokens = [];
    for (const table of f.tables) {
      const parents = { ...context, serviceAreaId: table.serviceAreaId };
      expect(await service.get(org, "table", parents, table.id)).toEqual(table);
      const qr = await service.getTableQr(org, parents, table.id);
      tokens.push(qr.token);
      expect(qr.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(qr.token, "base64url")).toHaveLength(32);
      for (const internal of [org, f.restaurant.id, f.outlet.id, table.id])
        expect(qr.token).not.toContain(internal);
      memory.db.resetHistory();
      expect(await service.resolveTableQr(qr.token)).toEqual({
        orgId: org,
        restaurantId: f.restaurant.id,
        table,
      });
      expect(memory.db.commandCalls(QueryCommand)).toHaveLength(0);
      expect(memory.db.commandCalls(GetItemCommand)).toHaveLength(5);
    }
    expect(new Set(tokens).size).toBe(4);
    expect(
      [...memory.rows.values()].map((item) => unmarshall(item).entityType),
    ).toEqual(
      expect.arrayContaining(["RESTAURANT_TABLE_QR", "RESTAURANT_TABLE_CODE"]),
    );
    expect(
      memory.transactions.every((tx) => (tx.TransactItems?.length ?? 0) <= 8),
    ).toBe(true);
  });

  test("Restaurant/menu singleton and retry identities are enforced", async () => {
    const root = await service.create(
      org,
      "owner",
      "restaurant",
      {},
      command(1, "Bistro"),
    );
    expect(
      await service.create(
        org,
        "owner",
        "restaurant",
        {},
        command(1, "Bistro"),
      ),
    ).toEqual(root);
    await expect(
      service.create(org, "owner", "restaurant", {}, command(2, "Other")),
    ).rejects.toMatchObject(status(409));
    await expect(
      service.create(
        org,
        "owner",
        "restaurant",
        {},
        command(1, "Changed intent"),
      ),
    ).rejects.toMatchObject(status(409));
    const outlet = await service.create(
      org,
      "owner",
      "outlet",
      {},
      command(3, "Agla"),
    );
    const menu = await service.create(
      org,
      "owner",
      "menu",
      { outletId: outlet.id },
      { ...command(4, "Menu"), currency: "XOF" },
    );
    expect(
      await service.create(
        org,
        "owner",
        "menu",
        { outletId: outlet.id },
        { ...command(4, "Menu"), currency: "XOF" },
      ),
    ).toEqual(menu);
    await expect(
      service.create(
        org,
        "owner",
        "menu",
        { outletId: outlet.id },
        { ...command(5, "Second Menu"), currency: "XOF" },
      ),
    ).rejects.toMatchObject(status(409));
  });

  test("table codes are unique across areas in an outlet; deactivation preserves identity and reservation", async () => {
    const f = await acceptanceFixture();
    const context = { outletId: f.outlet.id, serviceAreaId: f.areas[1].id };
    await expect(
      service.create(org, "owner", "table", context, {
        ...command(50, "Duplicate"),
        code: " t01 ",
      }),
    ).rejects.toMatchObject(status(409));
    const table = f.tables[0];
    const parent = {
      outletId: f.outlet.id,
      serviceAreaId: table.serviceAreaId,
    };
    const token = await service.getTableQr(org, parent, table.id);
    const inactive = await service.update(
      org,
      "owner",
      "table",
      parent,
      table.id,
      { expectedVersion: 1 },
      "deactivate",
    );
    expect(inactive.isActive).toBe(false);
    expect(await service.get(org, "table", parent, table.id)).toEqual(inactive);
    expect(await service.getTableQr(org, parent, table.id)).toEqual(token);
    await expect(service.resolveTableQr(token.token)).rejects.toMatchObject(
      status(404),
    );
    await expect(
      service.create(org, "owner", "table", context, {
        ...command(51, "Replacement"),
        code: "T01",
      }),
    ).rejects.toMatchObject(status(409));
  });

  test("table rename reserves new code and conditionally releases only its old code", async () => {
    const f = await acceptanceFixture();
    const table = f.tables[0];
    const parent = {
      outletId: f.outlet.id,
      serviceAreaId: table.serviceAreaId,
    };
    const token = await service.getTableQr(org, parent, table.id);
    await expect(
      service.update(org, "owner", "table", parent, table.id, {
        expectedVersion: 1,
        code: "T02",
      }),
    ).rejects.toMatchObject(status(409));
    expect((await service.get(org, "table", parent, table.id)).version).toBe(1);
    const renamed = await service.update(
      org,
      "owner",
      "table",
      parent,
      table.id,
      { expectedVersion: 1, code: "T05", capacity: null },
    );
    expect(renamed.code).toBe("T05");
    expect(renamed.capacity).toBeUndefined();
    expect(await service.getTableQr(org, parent, table.id)).toEqual(token);
    const tx = memory.transactions.at(-1)!;
    expect(
      tx.TransactItems?.some((op) =>
        op.Delete?.ConditionExpression?.includes("tableId = :id"),
      ),
    ).toBe(true);
  });

  test("table retry creates exactly one table/mapping/reservation with the same token", async () => {
    const f = await acceptanceFixture();
    const parent = { outletId: f.outlet.id, serviceAreaId: f.areas[0].id };
    const input = { ...command(55, "T05"), code: "T05" };
    const first = await service.create(org, "owner", "table", parent, input);
    const before = memory.rows.size;
    const token = await service.getTableQr(org, parent, first.id);
    expect(await service.create(org, "owner", "table", parent, input)).toEqual(
      first,
    );
    expect(memory.rows.size).toBe(before);
    expect(await service.getTableQr(org, parent, first.id)).toEqual(token);
    await expect(
      service.create(org, "owner", "table", parent, {
        ...input,
        name: "Changed",
      }),
    ).rejects.toMatchObject(status(409));
  });

  test("QR collision rolls back table and code reservation without taking over a mapping", async () => {
    const f = await acceptanceFixture();
    const parent = {
      outletId: f.outlet.id,
      serviceAreaId: f.tables[0].serviceAreaId,
    };
    const token = await service.getTableQr(org, parent, f.tables[0].id);
    const count = memory.rows.size;
    jest
      .spyOn(crypto, "randomBytes")
      .mockImplementation(((size: number) =>
        Buffer.from(token.token, "base64url")) as typeof crypto.randomBytes);
    await expect(
      service.create(org, "owner", "table", parent, {
        ...command(56, "Collision"),
        code: "T06",
      }),
    ).rejects.toMatchObject(status(409));
    expect(memory.rows.size).toBe(count);
    expect((await service.resolveTableQr(token.token)).table.id).toBe(
      f.tables[0].id,
    );
    expect(
      memory.transactions.at(-1)?.TransactItems?.filter((op) => op.Put),
    ).toHaveLength(3);
    expect(
      memory.transactions
        .at(-1)
        ?.TransactItems?.filter((op) => op.ConditionCheck),
    ).toHaveLength(3);
  });

  test("ownership is checked for every child, tenant and station assignment", async () => {
    const f = await acceptanceFixture();
    const other = await acceptanceFixture("org-other");
    const context = { outletId: f.outlet.id };
    await expect(
      service.get("org-other", "outlet", {}, f.outlet.id),
    ).rejects.toMatchObject(status(404));
    const second = await service.create(
      org,
      "owner",
      "outlet",
      {},
      command(80, "Other site"),
    );
    for (const [kind, id] of [
      ["serviceArea", f.areas[0].id],
      ["station", f.stations[0].id],
      ["category", f.categories[0].id],
    ] as const) {
      await expect(
        service.get(org, kind, { outletId: second.id }, id),
      ).rejects.toMatchObject(status(404));
    }
    await expect(
      service.get(
        org,
        "table",
        { ...context, serviceAreaId: f.areas[1].id },
        f.tables[0].id,
      ),
    ).rejects.toMatchObject(status(404));
    await expect(
      service.get(
        org,
        "item",
        { ...context, categoryId: f.categories[1].id },
        f.items[0].id,
      ),
    ).rejects.toMatchObject(status(404));
    await expect(
      service.create(
        org,
        "owner",
        "serviceArea",
        { outletId: other.outlet.id },
        command(81, "Forged"),
      ),
    ).rejects.toMatchObject(status(404));
    await expect(
      service.create(
        org,
        "owner",
        "table",
        { ...context, serviceAreaId: other.areas[0].id },
        { ...command(82, "Forged"), code: "T07" },
      ),
    ).rejects.toMatchObject(status(404));
    await expect(
      service.create(
        org,
        "owner",
        "item",
        { ...context, categoryId: other.categories[0].id },
        {
          ...command(83, "Forged"),
          price: { amountMinor: 500, currency: "XOF" },
        },
      ),
    ).rejects.toMatchObject(status(404));
    for (const stationId of [other.stations[0].id, fixtureId(999)]) {
      await expect(
        service.create(
          org,
          "owner",
          "item",
          { ...context, categoryId: f.categories[0].id },
          {
            ...command(84, "Invalid station"),
            price: { amountMinor: 500, currency: "XOF" },
            preparationStationId: stationId,
          },
        ),
      ).rejects.toMatchObject(status(404));
    }
    const secondStation = await service.create(
      org,
      "owner",
      "station",
      { outletId: second.id },
      command(85, "Other kitchen"),
    );
    await expect(
      service.create(
        org,
        "owner",
        "item",
        { ...context, categoryId: f.categories[0].id },
        {
          ...command(86, "Cross outlet"),
          price: { amountMinor: 500, currency: "XOF" },
          preparationStationId: secondStation.id,
        },
      ),
    ).rejects.toMatchObject(status(404));
  });

  test("inactive parents cannot receive new children, and version races fail atomically", async () => {
    const f = await acceptanceFixture();
    const context = { outletId: f.outlet.id };
    await service.update(
      org,
      "owner",
      "outlet",
      {},
      f.outlet.id,
      { expectedVersion: 1 },
      "deactivate",
    );
    await expect(
      service.create(org, "owner", "serviceArea", context, command(90, "New")),
    ).rejects.toMatchObject(status(409));
    await expect(
      service.update(org, "owner", "outlet", {}, f.outlet.id, {
        expectedVersion: 1,
        name: "Stale",
      }),
    ).rejects.toMatchObject(status(409));
    const parent = await RestaurantsRepository.get(org, "restaurant", {});
    const outlet = await RestaurantsRepository.get(
      org,
      "outlet",
      {},
      f.outlet.id,
    );
    expect(parent).toBeDefined();
    expect(outlet).toBeDefined();
    const stale = { ...outlet!, data: { ...outlet!.data, version: 3 } };
    const before = memory.rows.size;
    await expect(
      RestaurantsRepository.save(
        org,
        stale,
        [
          {
            snapshot: { ...parent!, data: { ...parent!.data, version: 999 } },
            requireActive: true,
          },
        ],
        outlet,
      ),
    ).rejects.toMatchObject(status(409));
    expect(memory.rows.size).toBe(before);
    expect((await service.get(org, "outlet", {}, f.outlet.id)).version).toBe(2);
  });

  test("price, availability, reorder and station unlink preserve lifecycle/history", async () => {
    const f = await acceptanceFixture();
    const item = f.items[0];
    const parents = { outletId: f.outlet.id, categoryId: item.categoryId };
    await expect(
      service.create(org, "owner", "item", parents, {
        ...command(95, "Currency"),
        price: { amountMinor: 500, currency: "USD" },
      }),
    ).rejects.toMatchObject(status(400));
    await expect(
      service.create(org, "owner", "item", parents, {
        ...command(96, "Negative"),
        price: { amountMinor: -1, currency: "XOF" },
      }),
    ).rejects.toHaveProperty("name", "ZodError");
    const unavailable = await service.update(
      org,
      "owner",
      "item",
      parents,
      item.id,
      { expectedVersion: 1, availability: "UNAVAILABLE" },
      "availability",
    );
    expect(unavailable).toMatchObject({
      isActive: true,
      availability: "UNAVAILABLE",
      price: item.price,
    });
    const updated = await service.update(
      org,
      "owner",
      "item",
      parents,
      item.id,
      {
        expectedVersion: 2,
        guestReorderEnabled: true,
        preparationStationId: null,
      },
    );
    expect(updated.preparationStationId).toBeUndefined();
    expect(updated.guestReorderEnabled).toBe(true);
    const inactive = await service.update(
      org,
      "owner",
      "item",
      parents,
      item.id,
      { expectedVersion: 3 },
      "deactivate",
    );
    expect(inactive.isActive).toBe(false);
    expect(await service.get(org, "item", parents, item.id)).toEqual(inactive);
  });

  test("QR resolution rejects unknown and corrupted locators without exposing tokens in audit logs", async () => {
    const f = await acceptanceFixture();
    const table = f.tables[0];
    const context = {
      outletId: f.outlet.id,
      serviceAreaId: table.serviceAreaId,
    };
    const { token } = await service.getTableQr(org, context, table.id);
    await expect(service.resolveTableQr("x".repeat(43))).rejects.toMatchObject(
      status(404),
    );
    const entry = [...memory.rows.entries()].find(
      ([, row]) =>
        unmarshall(row).entityType === "RESTAURANT_TABLE_QR" &&
        unmarshall(row).tableId === table.id,
    )!;
    const locator = unmarshall(entry[1]);
    memory.rows.set(
      entry[0],
      marshall({ ...locator, tableId: f.tables[2].id }),
    );
    await expect(service.resolveTableQr(token)).rejects.toMatchObject(
      status(404),
    );
    await expect(
      service.getTableQr(org, context, table.id),
    ).rejects.toMatchObject(status(404));
    const logs = JSON.stringify(jest.mocked(console.info).mock.calls);
    for (const secret of [token, table.id, f.outlet.id, org])
      expect(logs).not.toContain(secret);
  });

  test("transaction rejects a parent that became inactive after service validation", async () => {
    const f = await acceptanceFixture();
    const root = (await RestaurantsRepository.get(org, "restaurant", {}))!;
    const outlet = (await RestaurantsRepository.get(
      org,
      "outlet",
      {},
      f.outlet.id,
    ))!;
    const entry = [...memory.rows.entries()].find(
      ([, row]) => unmarshall(row).entityType === "RESTAURANT",
    )!;
    const persisted = unmarshall(entry[1]);
    memory.rows.set(
      entry[0],
      marshall({ ...persisted, data: { ...root.data, isActive: false } }),
    );
    // Keep the version equal to isolate the active-condition check itself.
    await expect(
      RestaurantsRepository.save(
        org,
        { ...outlet, data: { ...outlet.data, name: "Race", version: 2 } },
        [{ snapshot: root, requireActive: true }],
        outlet,
      ),
    ).rejects.toMatchObject(status(409));
    expect(
      (await RestaurantsRepository.get(org, "outlet", {}, f.outlet.id))?.data,
    ).toEqual(outlet.data);
  });

  test("pagination cursor is logical and cannot cross tenant or parent collections", async () => {
    const f = await acceptanceFixture();
    const context = { outletId: f.outlet.id };
    const first = await service.list(org, "serviceArea", context, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeDefined();
    const cursor = JSON.parse(
      Buffer.from(first.nextCursor!, "base64url").toString("utf8"),
    );
    expect(Object.keys(cursor)).toEqual(["id", "scope"]);
    expect(JSON.stringify(cursor)).not.toContain("ORG#");
    const next = await service.list(org, "serviceArea", context, {
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(next.items).toHaveLength(1);
    expect(next.items[0].id).not.toBe(first.items[0].id);
    await expect(
      RestaurantsRepository.list("another-org", "serviceArea", context, {
        limit: 1,
        cursor: first.nextCursor,
      }),
    ).rejects.toMatchObject(status(400));
    await expect(
      RestaurantsRepository.list(org, "station", context, {
        limit: 1,
        cursor: first.nextCursor,
      }),
    ).rejects.toMatchObject(status(400));
  });
});
