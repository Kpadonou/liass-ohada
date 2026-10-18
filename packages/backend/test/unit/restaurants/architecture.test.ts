import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { RESTAURANTS_ROUTES } from "@/lambda/domains/restaurants/restaurant-routes";

const root = path.join(__dirname, "../../..");
const domain = path.join(root, "lambda/domains/restaurants");
const source = readdirSync(domain)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => readFileSync(path.join(domain, file), "utf8"))
  .join("\n");
describe("RESTAURANTS domain architecture", () => {
  test("keeps product/domain boundaries without Scan, business integrations or platform duplication", () => {
    for (const forbidden of [
      "ScanCommand",
      "domains/sales",
      "domains/accounting",
      "domains/fiscal",
      "domains/treasury",
      "domains/projects",
      "ProductAccessRepository",
      "new DynamoDBClient",
      "new Cognito",
    ])
      expect(source).not.toContain(forbidden);
    expect(source).not.toMatch(/\bany\b/);
  });
  test("registers every reviewed route in the domain stack, with no public QR or DELETE", () => {
    expect(RESTAURANTS_ROUTES).toHaveLength(39);
    expect(
      new Set(
        RESTAURANTS_ROUTES.map((route) => `${route.method} ${route.path}`),
      ).size,
    ).toBe(39);
    for (const route of RESTAURANTS_ROUTES) {
      expect(
        readFileSync(path.join(domain, `${route.name}.ts`), "utf8"),
      ).toContain(`restaurantsHandler("${route.name}")`);
      expect(route.path.startsWith("/restaurants/")).toBe(true);
      expect(route.permission.startsWith("RESTAURANTS_")).toBe(true);
    }
    const construct = readFileSync(
      path.join(root, "lib/constructs/domains/restaurants-endpoints.ts"),
      "utf8",
    );
    expect(construct).toContain("routeInDomainStack: true");
    expect(construct).toContain("RESTAURANTS_ROUTES");
    expect(
      RESTAURANTS_ROUTES.filter((route) => route.operation === "qr"),
    ).toHaveLength(1);
    expect(
      RESTAURANTS_ROUTES.find((route) => route.operation === "qr")?.permission,
    ).toBe("RESTAURANTS_SETUP_MANAGE");
    expect(
      RESTAURANTS_ROUTES.every((route) =>
        ["GET", "POST", "PATCH"].includes(route.method),
      ),
    ).toBe(true);
  });
  test("defines all physical keys and entity-specific bounded collections centrally", () => {
    expect(KeyFactory.restaurantSK()).toBe("ROOT");
    expect(KeyFactory.restaurantOutletPrefix()).toBe("OUT#");
    expect(KeyFactory.restaurantOutletSK("o")).toBe("OUT#o");
    expect(KeyFactory.restaurantServiceAreaPrefix("o")).toBe("AREA#o#");
    expect(KeyFactory.restaurantServiceAreaSK("o", "a")).toBe("AREA#o#a");
    expect(KeyFactory.restaurantTablePrefix("o", "a")).toBe("TBL#o#a#");
    expect(KeyFactory.restaurantTableSK("o", "a", "t")).toBe("TBL#o#a#t");
    expect(KeyFactory.restaurantTableCodeSK("o", "T01")).toBe("TC#o#T01");
    expect(KeyFactory.restaurantStationPrefix("o")).toBe("STN#o#");
    expect(KeyFactory.restaurantStationSK("o", "s")).toBe("STN#o#s");
    expect(KeyFactory.restaurantMenuSK("o")).toBe("MENU#o");
    expect(KeyFactory.restaurantCategoryPrefix("o")).toBe("CAT#o#");
    expect(KeyFactory.restaurantCategorySK("o", "c")).toBe("CAT#o#c");
    expect(KeyFactory.restaurantMenuItemPrefix("o", "c")).toBe("ITEM#o#c#");
    expect(KeyFactory.restaurantMenuItemSK("o", "c", "i")).toBe("ITEM#o#c#i");
    expect(KeyFactory.restaurantQrPK("hash")).toBe("QR#hash");
    expect(KeyFactory.restaurantQrSK()).toBe("LOOKUP");
  });
});
