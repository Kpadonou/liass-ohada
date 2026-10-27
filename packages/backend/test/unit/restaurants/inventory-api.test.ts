import { randomUUID } from "crypto";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import * as C from "@liass-ohada/shared/restaurants";
import { handler } from "@/lambda/domains/restaurants/get-outlet";
import { quantityToMilli } from "@/lambda/domains/restaurants/inventory-handler";
import { INVENTORY_ROUTES } from "@/lambda/domains/restaurants/inventory-routes";
import { RestaurantInventoryService as Inventory } from "@/lambda/domains/restaurants/inventory-service";
import { RestaurantsService } from "@/lambda/domains/restaurants/restaurant-service";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { acceptanceFixture } from "./acceptance-fixture";
import { memoryDynamo } from "./memory-dynamo";

const org = "org-resto",
  user = "inventory-owner";
let memory: ReturnType<typeof memoryDynamo>;
let outletId: string;
beforeEach(async () => {
  memory = memoryDynamo();
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  outletId = (await acceptanceFixture()).outlet.id;
  memory.seedAccess(org, user, "OWNER");
});
afterEach(() => {
  memory.db.restore();
  jest.restoreAllMocks();
});
type Operation = (typeof INVENTORY_ROUTES)[number]["operation"];
const event = (
  operation: Operation,
  body?: unknown,
  id?: string,
  query?: Record<string, string>,
  outlet = outletId,
  tenant = org,
) => {
  const route = INVENTORY_ROUTES.find((r) => r.operation === operation)!;
  return {
    routeKey: `${route.method} ${route.path}`,
    headers: { "accept-language": "en", "x-org-id": tenant },
    body: body === undefined ? undefined : JSON.stringify(body),
    queryStringParameters: query,
    pathParameters: { outletId: outlet, ...(id ? { stockItemId: id } : {}) },
    requestContext: { authorizer: { jwt: { claims: { sub: user } } } },
  };
};
const item = async (unit = "UNIT") =>
  Inventory.create(
    { orgId: org, outletId },
    { id: randomUUID(), name: "Water", unit },
  );
const movement = (
  type = "RECEIPT",
  quantity = "1",
  clientRequestId = randomUUID(),
) => ({ type, quantity, clientRequestId });
const read = (response: { statusCode: number; body: string }, status = 200) => {
  expect(response.statusCode).toBe(status);
  return JSON.parse(response.body);
};

test.each(["OWNER", "MANAGER"])(
  "%s can execute every Inventory operation",
  async (role) => {
    memory.seedAccess(org, user, role);
    const created = read(
      await handler(event("create", { name: "Bottle", unit: "BOTTLE" })),
    ).data;
    expect(created.balanceMilli).toBe(0);
    expect(created.isNegativeStock).toBe(false);
    expect(C.StockItemResponseSchema.safeParse({ data: created }).success).toBe(
      true,
    );
    expect(
      read(await handler(event("get", undefined, created.id))).data,
    ).toEqual(created);
    expect(read(await handler(event("list"))).items).toEqual([created]);
    const updated = read(
      await handler(
        event(
          "update",
          { expectedVersion: 1, name: "Sparkling water", isActive: false },
          created.id,
        ),
      ),
    ).data;
    expect(updated).toMatchObject({
      name: "Sparkling water",
      isActive: false,
      version: 2,
      unit: "BOTTLE",
    });
    const received = read(
      await handler(event("movement", movement(), created.id)),
    ).data;
    expect(received).toMatchObject({
      deltaMilli: 1000,
      resultingBalanceMilli: 1000,
      actorId: user,
      source: "MANUAL",
    });
    expect(
      read(await handler(event("history", undefined, created.id))).items,
    ).toEqual([received]);
  },
);
test.each(["WAITER", "CASHIER", "KITCHEN"])(
  "%s is denied on every Inventory route",
  async (role) => {
    const stock = await item();
    memory.seedAccess(org, user, role);
    for (const operation of [
      "list",
      "create",
      "get",
      "update",
      "movement",
      "history",
    ] as const) {
      const body =
        operation === "create"
          ? { name: "Item", unit: "UNIT" }
          : operation === "update"
            ? { expectedVersion: 1, name: "Other" }
            : operation === "movement"
              ? movement()
              : undefined;
      read(
        await handler(
          event(
            operation,
            body,
            operation === "list" || operation === "create"
              ? undefined
              : stock.id,
          ),
        ),
        403,
      );
    }
    expect(
      (await Inventory.get({ orgId: org, outletId }, stock.id)).balanceMilli,
    ).toBe(0);
  },
);
test("membership and active Restaurants entitlement are required", async () => {
  const stock = await item();
  read(
    await handler(
      event("get", undefined, stock.id, undefined, outletId, "foreign-org"),
    ),
    403,
  );
  const access = {
    PK: K.orgKey(org),
    SK: K.productAccessSK("RESTAURANTS"),
    entityType: "PRODUCT_ACCESS",
    orgId: org,
    productCode: "RESTAURANTS",
    status: "INACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  memory.rows.set(JSON.stringify([access.PK, access.SK]), marshall(access));
  for (const operation of [
    "list",
    "create",
    "get",
    "update",
    "movement",
    "history",
  ] as const) {
    const body =
      operation === "create"
        ? { name: "Item", unit: "UNIT" }
        : operation === "update"
          ? { expectedVersion: 1, name: "Other" }
          : operation === "movement"
            ? movement()
            : undefined;
    read(
      await handler(
        event(
          operation,
          body,
          operation === "list" || operation === "create" ? undefined : stock.id,
        ),
      ),
      403,
    );
  }
});
test("canonical organization/outlet checks apply even to empty collections", async () => {
  const stock = await item();
  const second = await RestaurantsService.create(
    org,
    user,
    "outlet",
    {},
    { name: "Other", clientRequestId: randomUUID() },
  );
  for (const operation of ["get", "update", "movement", "history"] as const) {
    const body =
      operation === "update"
        ? { expectedVersion: 1, name: "Invalid" }
        : operation === "movement"
          ? movement()
          : undefined;
    read(
      await handler(event(operation, body, stock.id, undefined, second.id)),
      404,
    );
  }
  read(
    await handler(event("list", undefined, undefined, undefined, randomUUID())),
    404,
  );
  memory.seedAccess("other-org", user, "OWNER");
  read(
    await handler(
      event("get", undefined, stock.id, undefined, outletId, "other-org"),
    ),
    404,
  );
});
test.each([
  "unit",
  "balanceMilli",
  "balance",
  "id",
  "outletId",
  "orgId",
  "userId",
])("PATCH rejects immutable %s", async (field) => {
  const stock = await item();
  const body = {
    expectedVersion: 1,
    [field]:
      field === "unit"
        ? "KG"
        : field.startsWith("balance")
          ? 1000
          : randomUUID(),
  };
  read(await handler(event("update", body, stock.id)), 400);
});
test("stale updates return a safe conflict", async () => {
  const stock = await item();
  read(
    await handler(
      event("update", { expectedVersion: 1, name: "Changed" }, stock.id),
    ),
  );
  const result = read(
    await handler(
      event("update", { expectedVersion: 1, name: "Stale" }, stock.id),
    ),
    409,
  );
  expect(result.error.code).toBe("RESTAURANTS_INVENTORY_CONFLICT");
});
test.each([
  ["RECEIPT", "-2", 2000],
  ["LOSS", "3", -3000],
  ["ADJUSTMENT", "+4", 4000],
  ["ADJUSTMENT", "-4", -4000],
])(
  "manual %s %s controls sign and allows negative stock",
  async (type, quantity, expected) => {
    const stock = await item("BOTTLE");
    const result = read(
      await handler(
        event("movement", movement(String(type), String(quantity)), stock.id),
      ),
    ).data;
    expect(result.deltaMilli).toBe(expected);
    expect(result.resultingBalanceMilli).toBe(expected);
    expect(result.isNegativeStock).toBe(Number(expected) < 0);
    expect(
      C.StockMovementResponseSchema.safeParse({ data: result }).success,
    ).toBe(true);
  },
);
test.each(["SALE", "SALE_REVERSAL", "INVALID"])(
  "manual API rejects %s",
  async (type) => {
    const stock = await item();
    read(await handler(event("movement", movement(type), stock.id)), 400);
    expect(
      (await Inventory.get({ orgId: org, outletId }, stock.id)).balanceMilli,
    ).toBe(0);
  },
);
test("discrete quantities are whole and continuous quantities retain milli precision", async () => {
  const discrete = await item();
  read(
    await handler(event("movement", movement("RECEIPT", "1.5"), discrete.id)),
    400,
  );
  const kg = await item("KG");
  expect(
    read(await handler(event("movement", movement("RECEIPT", "1.251"), kg.id)))
      .data.resultingBalanceMilli,
  ).toBe(1251);
  expect(read(await handler(event("get", undefined, kg.id))).data.unit).toBe(
    "KG",
  );
});
test("manual retries have one durable balance effect and reject changed intent", async () => {
  const stock = await item();
  const request = movement("LOSS", "3");
  const first = read(await handler(event("movement", request, stock.id))).data;
  expect(
    read(await handler(event("movement", request, stock.id))).data,
  ).toEqual(first);
  read(
    await handler(event("movement", { ...request, quantity: "4" }, stock.id)),
    409,
  );
  expect(
    read(await handler(event("get", undefined, stock.id))).data.balanceMilli,
  ).toBe(-3000);
});
test("history is immutable, newest first, bounded and cursor-scoped", async () => {
  const stock = await item();
  const accepted = [];
  for (const type of ["RECEIPT", "LOSS", "ADJUSTMENT"])
    accepted.push(
      read(await handler(event("movement", movement(type), stock.id))).data,
    );
  const first = read(
    await handler(event("history", undefined, stock.id, { limit: "2" })),
  );
  const second = read(
    await handler(
      event("history", undefined, stock.id, {
        limit: "2",
        cursor: first.nextCursor,
      }),
    ),
  );
  const all = [...first.items, ...second.items];
  expect(first.items).toHaveLength(2);
  expect(second.items).toHaveLength(1);
  expect(all).toEqual(
    [...accepted].sort((a, b) =>
      `${b.createdAt}#${b.id}`.localeCompare(`${a.createdAt}#${a.id}`),
    ),
  );
  read(
    await handler(event("history", undefined, stock.id, { limit: "101" })),
    400,
  );
  read(
    await handler(event("history", undefined, stock.id, { cursor: "invalid" })),
    400,
  );
  const other = await item();
  read(
    await handler(
      event("history", undefined, other.id, { cursor: first.nextCursor }),
    ),
    400,
  );
  for (const call of memory.db.commandCalls(QueryCommand)) {
    expect(call.args[0].input.IndexName).toBeUndefined();
    expect(call.args[0].input.Limit).toBeLessThanOrEqual(100);
  }
  expect(C.StockMovementsResponseSchema.safeParse(first).success).toBe(true);
  expect(JSON.stringify(all)).not.toMatch(
    /"(?:PK|SK|GSI\w*|orgId|outletId|entityType)"/,
  );
});
test("strict shared contracts reject malformed input and initial balance", async () => {
  for (const body of [
    { name: "Water", unit: "CASE" },
    { name: "Water", unit: "UNIT", balanceMilli: 1000 },
    { name: "" },
    { name: "Water", unit: "UNIT", id: randomUUID() },
  ])
    read(await handler(event("create", body)), 400);
  const stock = await item();
  for (const quantity of [1.5, "0", "1.0001", "1e3", "9007199254741.999"])
    read(
      await handler(event("movement", { ...movement(), quantity }, stock.id)),
      400,
    );
  read(await handler({ ...event("create"), body: "{invalid" }), 400);
  expect(quantityToMilli("0.001")).toBe(1);
  expect(quantityToMilli("-1.251")).toBe(-1251);
});
test.each(["WAITER", "CASHIER", "KITCHEN"])(
  "consolidated Outlet routes preserve %s read/write permissions",
  async (role) => {
    memory.seedAccess(org, user, role);
    const base = event("list");
    read(
      await handler({
        ...base,
        routeKey: "GET /restaurants/outlets/{outletId}",
      }),
    );
    read(
      await handler({
        ...base,
        routeKey: "PATCH /restaurants/outlets/{outletId}",
        body: JSON.stringify({ expectedVersion: 1, name: "Forbidden" }),
      }),
      403,
    );
    read(
      await handler({
        ...base,
        routeKey: "GET /restaurants/outlets",
        pathParameters: {},
      }),
    );
  },
);
test("unknown methods/routes fail closed", async () => {
  read(
    await handler({
      ...event("list"),
      routeKey: "DELETE /restaurants/outlets/{outletId}/inventory/items",
    }),
    404,
  );
});

test.each(["OWNER", "MANAGER"])(
  "consolidated Outlet management preserves %s create/update/deactivate behavior",
  async (role) => {
    memory.seedAccess(org, user, role);
    const invoke = (routeKey: string, body?: object, id?: string) =>
      handler({
        ...event("list"),
        routeKey,
        pathParameters: id ? { outletId: id } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    const created = read(
      await invoke("POST /restaurants/outlets", {
        name: "New outlet",
        clientRequestId: randomUUID(),
      }),
    ).data;
    expect(
      read(
        await invoke(
          "GET /restaurants/outlets/{outletId}",
          undefined,
          created.id,
        ),
      ).data.id,
    ).toBe(created.id);
    const updated = read(
      await invoke(
        "PATCH /restaurants/outlets/{outletId}",
        { expectedVersion: created.version, name: "Renamed outlet" },
        created.id,
      ),
    ).data;
    expect(updated.name).toBe("Renamed outlet");
    expect(
      read(
        await invoke(
          "POST /restaurants/outlets/{outletId}/deactivate",
          { expectedVersion: updated.version },
          created.id,
        ),
      ).data.isActive,
    ).toBe(false);
  },
);
