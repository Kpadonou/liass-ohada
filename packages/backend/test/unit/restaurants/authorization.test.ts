import {
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { restaurantsHandler } from "@/lambda/domains/restaurants/restaurant-handler";
import { RESTAURANTS_ROUTES } from "@/lambda/domains/restaurants/restaurant-routes";
import { RestaurantsService } from "@/lambda/domains/restaurants/restaurant-service";
import { KeyFactory } from "@/lambda/shared/key-builder";
import {
  isWritePermission,
  RESTAURANTS_PERMISSIONS,
} from "@/lambda/shared/authorization/domain-permission";
import { DomainAuthorizationService } from "@/lambda/shared/services/domain-authorization-service";
import {
  RESTAURANTS_CHECKOUT_PERMISSIONS,
  RESTAURANTS_TRANSACTION_PERMISSIONS,
  RESTAURANTS_PREPARATION_PERMISSIONS,
  RESTAURANTS_STAFF_SELF_PERMISSIONS,
  RESTAURANTS_SERVICE_PERMISSIONS,
} from "@liass-ohada/shared/shared";
import {
  RestaurantResponseSchema,
  RestaurantTableQrResponseSchema,
} from "@liass-ohada/shared/restaurants";
import { acceptanceFixture } from "./acceptance-fixture";
import { fixtureId, memoryDynamo } from "./memory-dynamo";

const org = "org-resto",
  user = "user-resto";
let memory: ReturnType<typeof memoryDynamo>;
beforeEach(() => {
  memory = memoryDynamo();
  jest.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  memory.db.restore();
  jest.restoreAllMocks();
});
const event = (
  body?: object,
  pathParameters: Record<string, string> = {},
  headers = { "accept-language": "en", "x-org-id": org },
) => ({
  headers,
  pathParameters,
  ...(body ? { body: JSON.stringify(body) } : {}),
  requestContext: { authorizer: { jwt: { claims: { sub: user } } } },
});
function routeEvent(route: (typeof RESTAURANTS_ROUTES)[number]) {
  const pathParameters: Record<string, string> = {};
  for (const match of route.path.matchAll(/\{(\w+)\}/g))
    pathParameters[match[1]] = fixtureId(1);
  const body =
    route.operation === "create"
      ? {
          clientRequestId: fixtureId(2),
          name: "Configuration",
          ...(route.kind === "table" ? { code: "T01" } : {}),
          ...(route.kind === "menu" ? { currency: "XOF" } : {}),
          ...(route.kind === "item"
            ? { price: { amountMinor: 500, currency: "XOF" } }
            : {}),
        }
      : route.operation === "update"
        ? { expectedVersion: 1, name: "Updated" }
        : route.operation === "deactivate"
          ? { expectedVersion: 1 }
          : route.operation === "availability"
            ? { expectedVersion: 1, availability: "UNAVAILABLE" }
            : undefined;
  return event(body, pathParameters);
}

describe("RESTO-1B authoritative authorization", () => {
  test.each(RESTAURANTS_ROUTES)(
    "$name denies missing ProductAccess before domain work",
    async (route) => {
      memory.seedAccess(org, user, "OWNER", false);
      const result = await restaurantsHandler(route.name)(routeEvent(route));
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).error.code).toBe(
        "PRODUCT_ACCESS_REQUIRED",
      );
      expect(memory.db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
      expect(memory.db.commandCalls(GetItemCommand)).toHaveLength(2);
    },
  );
  test.each(RESTAURANTS_ROUTES)(
    "$name denies missing scoped role and forged workspace",
    async (route) => {
      memory.seedAccess(org, user, "ACCOUNTANT");
      let result = await restaurantsHandler(route.name)(routeEvent(route));
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).error.code).toBe(
        "DOMAIN_PERMISSION_REQUIRED",
      );
      const request = routeEvent(route);
      result = await restaurantsHandler(route.name)({
        ...request,
        headers: { ...request.headers, "x-org-id": "org-other" },
      });
      expect(result.statusCode).toBe(403);
      expect(memory.db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
    },
  );
  test.each(
    RESTAURANTS_ROUTES.filter((route) => route.permission.endsWith("_MANAGE")),
  )("$name requires management permissions", async (route) => {
    for (const role of ["WAITER", "CASHIER", "KITCHEN"]) {
      memory.seedAccess(org, user, role);
      const result = await restaurantsHandler(route.name)(routeEvent(route));
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).error.code).toBe(
        "DOMAIN_PERMISSION_REQUIRED",
      );
    }
    expect(memory.db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  });
  test.each(["OWNER", "MANAGER"])(
    "%s can operate real setup/menu API through the shared wrapper",
    async (role) => {
      memory.seedAccess(org, user, role);
      const root = await restaurantsHandler("create-restaurant")(
        event({ clientRequestId: fixtureId(1), name: "Héritage Bistro" }),
      );
      expect(root.statusCode).toBe(200);
      const rootData = RestaurantResponseSchema.parse(
        JSON.parse(root.body),
      ).data;
      expect(rootData.guestOrderingPolicy).toBe("STAFF_APPROVAL");
      const outletResult = await restaurantsHandler("create-outlet")(
        event({ clientRequestId: fixtureId(2), name: "Agla" }),
      );
      expect(outletResult.statusCode).toBe(200);
      const outletId = JSON.parse(outletResult.body).data.id as string;
      const menuResult = await restaurantsHandler("create-menu")(
        event(
          { clientRequestId: fixtureId(3), name: "Menu", currency: "XOF" },
          { outletId },
        ),
      );
      expect(menuResult.statusCode).toBe(200);
      const categoryResult = await restaurantsHandler("create-menu-category")(
        event({ clientRequestId: fixtureId(4), name: "Drinks" }, { outletId }),
      );
      expect(categoryResult.statusCode).toBe(200);
      const categoryId = JSON.parse(categoryResult.body).data.id as string;
      const itemResult = await restaurantsHandler("create-menu-item")(
        event(
          {
            clientRequestId: fixtureId(5),
            name: "Beer",
            price: { amountMinor: 1000, currency: "XOF" },
            guestReorderEnabled: true,
          },
          { outletId, categoryId },
        ),
      );
      expect(itemResult.statusCode).toBe(200);
      const itemId = JSON.parse(itemResult.body).data.id as string;
      const availability = await restaurantsHandler("availability-menu-item")(
        event(
          { expectedVersion: 1, availability: "UNAVAILABLE" },
          { outletId, categoryId, itemId },
        ),
      );
      expect(availability.statusCode).toBe(200);
      expect(JSON.parse(availability.body).data).toMatchObject({
        availability: "UNAVAILABLE",
        isActive: true,
        guestReorderEnabled: true,
        version: 2,
      });
      expect(
        (await restaurantsHandler("get-restaurant")(event())).statusCode,
      ).toBe(200);
      expect(
        (
          await restaurantsHandler("list-menu-item")(
            event(undefined, { outletId, categoryId }),
          )
        ).statusCode,
      ).toBe(200);
    },
  );
  test("authenticated read roles can read configuration, but QR retrieval is management only", async () => {
    const f = await acceptanceFixture();
    for (const role of ["WAITER", "CASHIER", "KITCHEN"]) {
      memory.seedAccess(org, user, role);
      expect(
        (await restaurantsHandler("get-restaurant")(event())).statusCode,
      ).toBe(200);
      expect(
        (
          await restaurantsHandler("get-menu")(
            event(undefined, { outletId: f.outlet.id }),
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await restaurantsHandler("qr-table")(
            event(undefined, {
              outletId: f.outlet.id,
              serviceAreaId: f.tables[0].serviceAreaId,
              tableId: f.tables[0].id,
            }),
          )
        ).statusCode,
      ).toBe(403);
    }
    memory.seedAccess(org, user, "MANAGER");
    const qr = await restaurantsHandler("qr-table")(
      event(undefined, {
        outletId: f.outlet.id,
        serviceAreaId: f.tables[0].serviceAreaId,
        tableId: f.tables[0].id,
      }),
    );
    expect(qr.statusCode).toBe(200);
    RestaurantTableQrResponseSchema.parse(JSON.parse(qr.body));
    // Opaque random tokens may contain strings such as PK; validate exposed fields.
    expect(Object.keys(JSON.parse(qr.body))).toEqual(["token"]);
  });
  test("API fails closed for malformed paths, invalid children, absent auth and forged tenant input", async () => {
    const f = await acceptanceFixture();
    memory.seedAccess(org, user, "OWNER");
    expect(
      (
        await restaurantsHandler("get-outlet")(
          event(undefined, { outletId: "invalid" }),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await restaurantsHandler("get-table")(
          event(undefined, {
            outletId: f.outlet.id,
            serviceAreaId: f.areas[1].id,
            tableId: f.tables[0].id,
          }),
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await restaurantsHandler("get-restaurant")({
          ...event(),
          requestContext: {},
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await restaurantsHandler("update-restaurant")(
          event({ expectedVersion: 1 }),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await restaurantsHandler("update-restaurant")(
          event({
            expectedVersion: 1,
            name: "Safe",
            orgId: "other",
            userId: "other",
          }),
        )
      ).statusCode,
    ).toBe(200);
    expect((await RestaurantsService.get(org, "restaurant", {})).name).toBe(
      "Safe",
    );
    expect(
      await RestaurantsService.get("other", "restaurant", {}).catch(
        (error) => error.statusCode,
      ),
    ).toBe(404);
  });
  test("permission projection is explicit and product independent", () => {
    for (const role of ["OWNER", "MANAGER"])
      expect(
        DomainAuthorizationService.permissionsForRestaurantsRole(role),
      ).toEqual([
        ...RESTAURANTS_PERMISSIONS,
        ...RESTAURANTS_TRANSACTION_PERMISSIONS,
        ...RESTAURANTS_CHECKOUT_PERMISSIONS,
        "RESTAURANTS_PAYMENT_CAPTURE_MANAGE",
        "RESTAURANTS_CHECKOUT_CLOSE_MANAGE",
        "RESTAURANTS_RECEIPT_READ",
        "RESTAURANTS_RECEIPT_MANAGE",
        ...RESTAURANTS_SERVICE_PERMISSIONS,
        ...RESTAURANTS_PREPARATION_PERMISSIONS,
        ...RESTAURANTS_STAFF_SELF_PERMISSIONS,
      ]);
    for (const role of ["WAITER", "CASHIER", "KITCHEN"])
      expect(
        DomainAuthorizationService.permissionsForRestaurantsRole(role),
      ).toEqual([
        "RESTAURANTS_READ",
        "RESTAURANTS_MENU_READ",
        ...(role === "CASHIER"
          ? [
              ...RESTAURANTS_CHECKOUT_PERMISSIONS,
              "RESTAURANTS_PAYMENT_CAPTURE_MANAGE",
              "RESTAURANTS_CHECKOUT_CLOSE_MANAGE",
              "RESTAURANTS_RECEIPT_READ",
              "RESTAURANTS_RECEIPT_MANAGE",
            ]
          : []),
        ...(role === "WAITER" ? RESTAURANTS_SERVICE_PERMISSIONS : []),
        ...(role === "WAITER"
          ? ["RESTAURANTS_PREPARATION_SERVE_MANAGE"]
          : role === "KITCHEN"
            ? [
                "RESTAURANTS_PREPARATION_READ",
                "RESTAURANTS_PREPARATION_START_MANAGE",
                "RESTAURANTS_PREPARATION_READY_MANAGE",
              ]
            : []),
        ...(role === "WAITER" || role === "KITCHEN" || role === "CASHIER"
          ? RESTAURANTS_STAFF_SELF_PERMISSIONS
          : []),
      ]);
    for (const permission of RESTAURANTS_PERMISSIONS)
      expect(isWritePermission(permission)).toBe(
        permission.endsWith("_MANAGE"),
      );
    expect(
      DomainAuthorizationService.permissionsForRestaurantsRole("SALES_OWNER"),
    ).toEqual([]);
    expect(
      DomainAuthorizationService.permissionsForDirectOrganizationRole("OWNER"),
    ).not.toContain("RESTAURANTS_SETUP_MANAGE");
  });
  test("inactive entitlement denies reads and writes", async () => {
    memory.seedAccess(org, user, "MANAGER");
    const access = {
      PK: KeyFactory.orgKey(org),
      SK: KeyFactory.productAccessSK("RESTAURANTS"),
      entityType: "PRODUCT_ACCESS",
      orgId: org,
      productCode: "RESTAURANTS",
      status: "INACTIVE",
      createdAt: "2026-10-10T00:00:00.000Z",
      updatedAt: "2026-10-10T00:00:00.000Z",
    };
    memory.rows.set(JSON.stringify([access.PK, access.SK]), marshall(access));
    expect(
      (await restaurantsHandler("get-restaurant")(event())).statusCode,
    ).toBe(403);
    expect(
      (
        await restaurantsHandler("create-restaurant")(
          event({ clientRequestId: fixtureId(1), name: "Root" }),
        )
      ).statusCode,
    ).toBe(403);
  });
});

test.each(["OWNER", "MANAGER"])(
  "%s persists all Guest ordering policies using existing restaurant settings",
  async (role) => {
    await acceptanceFixture();
    memory.seedAccess(org, user, role);
    for (const policy of ["DISABLED", "DIRECT", "STAFF_APPROVAL"]) {
      const before = JSON.parse(
        (await restaurantsHandler("get-restaurant")(event())).body,
      ).data;
      const result = await restaurantsHandler("update-restaurant")(
        event({ expectedVersion: before.version, guestOrderingPolicy: policy }),
      );
      expect(result.statusCode).toBe(200);
      expect(
        JSON.parse((await restaurantsHandler("get-restaurant")(event())).body)
          .data.guestOrderingPolicy,
      ).toBe(policy);
    }
  },
);
test("unrelated settings updates preserve existing DISABLED policy", async () => {
  await acceptanceFixture();
  memory.seedAccess(org, user, "OWNER");
  const before = JSON.parse(
    (await restaurantsHandler("get-restaurant")(event())).body,
  ).data;
  await restaurantsHandler("update-restaurant")(
    event({ expectedVersion: before.version, guestOrderingPolicy: "DISABLED" }),
  );
  const disabled = JSON.parse(
    (await restaurantsHandler("get-restaurant")(event())).body,
  ).data;
  const updated = await restaurantsHandler("update-restaurant")(
    event({ expectedVersion: disabled.version, name: "Updated name" }),
  );
  expect(updated.statusCode).toBe(200);
  expect(JSON.parse(updated.body).data.guestOrderingPolicy).toBe("DISABLED");
});
