import {
  BatchGetItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  ProductCode,
  CreateInitialWorkspaceRequestSchema,
} from "@liass-ohada/shared";
import { OnboardingService } from "@/lambda/shared/services/onboarding-service";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import { OrganizationService } from "@/lambda/shared/services/organization-service";
import { EffectiveOrganizationAccessService } from "@/lambda/shared/services/effective-organization-access-service";
import { DomainAuthorizationService } from "@/lambda/shared/services/domain-authorization-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";
import { SalesSettingsService } from "@/lambda/domains/sales/settings/sales-settings-service";
import { randomUUID } from "crypto";
import { RestaurantsService } from "@/lambda/domains/restaurants/restaurant-service";
import { ProductAccessRepository } from "@/lambda/shared/repositories/product-access-repository";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { config } from "@/lambda/shared/dynamo-client";
import { fixtureId, memoryDynamo } from "../restaurants/memory-dynamo";
import { restaurantsHandler } from "@/lambda/domains/restaurants/restaurant-handler";
import { RESTAURANTS_ROUTES } from "@/lambda/domains/restaurants/restaurant-routes";

jest.mock("crypto", () => ({
  ...jest.requireActual("crypto"),
  randomUUID: jest.fn(),
}));

const combinations: ProductCode[][] = [
  ["ACCOUNTING"],
  ["SALES"],
  ["RESTAURANTS"],
  ["ACCOUNTING", "SALES"],
  ["ACCOUNTING", "RESTAURANTS"],
  ["SALES", "RESTAURANTS"],
  ["ACCOUNTING", "SALES", "RESTAURANTS"],
];
const request = (products: ProductCode[]) => ({
  workspaceType: "COMPANY" as const,
  organizationName:
    products.length === 3
      ? "Full Company"
      : products[0] === "RESTAURANTS"
        ? "Héritage Bistro"
        : products[0] === "SALES"
          ? "Demo Sales"
          : "Demo Accounting",
  country: "BJ" as const,
  products,
  ...(products.includes("ACCOUNTING")
    ? { accountingFramework: "SYSCOHADA_REVISED" as const }
    : {}),
});

let memory: ReturnType<typeof memoryDynamo>;
beforeEach(() => {
  let sequence = 0;
  jest
    .mocked(randomUUID)
    .mockImplementation(
      () => fixtureId(++sequence) as ReturnType<typeof randomUUID>,
    );
  memory = memoryDynamo();
  memory.db.on(QueryCommand).callsFake(async (input) => {
    if (input.IndexName !== config.GSI6)
      throw new Error("Unexpected onboarding query");
    const pk = input.ExpressionAttributeValues[":pk"].S;
    const prefix = input.ExpressionAttributeValues[":skPrefix"].S;
    return {
      Items: [...memory.rows.values()].filter(
        (row) => row.GSI6PK?.S === pk && row.GSI6SK?.S?.startsWith(prefix),
      ),
    };
  });
  memory.db.on(BatchGetItemCommand).callsFake(async (input) => ({
    Responses: {
      [config.TABLE_NAME]: input.RequestItems[config.TABLE_NAME].Keys.flatMap(
        (key: Record<string, { S: string }>) => {
          const row = memory.rows.get(JSON.stringify([key.PK.S, key.SK.S]));
          return row ? [row] : [];
        },
      ),
    },
  }));
  jest.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  memory.db.restore();
  jest.restoreAllMocks();
});

test.each(combinations.map((products) => [products] as const))(
  "creates exactly selected products %j and discovers the workspace",
  async (products) => {
    const result = await OnboardingService.createInitialWorkspace(
      "creator",
      request(products),
    );
    expect(result.productAccess?.map((access) => access.productCode)).toEqual(
      products,
    );
    const rows = [...memory.rows.values()].map((row) => unmarshall(row));
    expect(
      rows
        .filter((row) => row.entityType === "PRODUCT_ACCESS")
        .map((row) => row.productCode),
    ).toEqual(products);
    expect(
      rows.filter((row) => row.entityType === "USER_ORG_ACCESS"),
    ).toHaveLength(1);
    expect(
      rows.filter((row) => row.entityType === "ACCOUNTING_SETTINGS"),
    ).toHaveLength(products.includes("ACCOUNTING") ? 1 : 0);
    expect(
      rows.filter((row) => row.entityType === "SALES_SETTINGS"),
    ).toHaveLength(products.includes("SALES") ? 1 : 0);
    expect(
      rows.some(
        (row) =>
          row.entityType === "CABINET" || row.entityType === "FISCAL_SETTINGS",
      ),
    ).toBe(false);
    if (!products.includes("ACCOUNTING"))
      expect(rows.every((row) => row.accountingFramework === undefined)).toBe(
        true,
      );
    const discovered = await TenantAccessService.getUserWorkspaces("creator");
    expect(discovered).toEqual([result.workspace]);
    expect(
      await OrganizationService.getOrganization(result.activeOrgId),
    ).toEqual(result.organization);
    const context = await EffectiveOrganizationAccessService.resolveAccess({
      orgId: result.activeOrgId,
      userId: "creator",
    });
    for (const productCode of ["ACCOUNTING", "SALES", "RESTAURANTS"] as const) {
      const access = await ProductAccessService.getProductAccess(
        result.activeOrgId,
        productCode,
      );
      expect(access?.status ?? null).toBe(
        products.includes(productCode) ? "ACTIVE" : null,
      );
    }
    if (products.includes("ACCOUNTING")) {
      expect(result.organization.accountingFramework).toBe("SYSCOHADA_REVISED");
      expect(() =>
        DomainAuthorizationService.assertPermission(
          context,
          "ACCOUNTING_WRITE",
        ),
      ).not.toThrow();
    }
    if (products.includes("SALES")) {
      expect(() =>
        DomainAuthorizationService.assertPermission(context, "SALES_WRITE"),
      ).not.toThrow();
      expect(
        await SalesSettingsService.getSalesSettings(result.activeOrgId),
      ).toMatchObject({ defaultCurrency: "XOF", version: 1 });
    }
    if (products.includes("RESTAURANTS")) {
      expect(discovered[0].productRoles).toEqual({ RESTAURANTS: "OWNER" });
      expect(() =>
        DomainAuthorizationService.assertPermission(
          context,
          "RESTAURANTS_SETUP_MANAGE",
        ),
      ).not.toThrow();
      expect(() =>
        DomainAuthorizationService.assertPermission(
          context,
          "RESTAURANTS_MENU_MANAGE",
        ),
      ).not.toThrow();
    } else expect(discovered[0].productRoles).toBeUndefined();
    expect(memory.transactions).toHaveLength(1);
    expect(memory.transactions[0].TransactItems).toHaveLength(
      3 +
        products.length +
        Number(products.includes("ACCOUNTING")) +
        Number(products.includes("SALES")),
    );
    expect(memory.db.commandCalls(ScanCommand)).toHaveLength(0);
    expect(memory.db.commandCalls(TransactWriteItemsCommand)).toHaveLength(1);
    const snapshot = [...memory.rows.entries()];
    await expect(
      OnboardingService.createInitialWorkspace("creator", request(products)),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect([...memory.rows.entries()]).toEqual(snapshot);
    expect(memory.transactions).toHaveLength(1);
  },
);

test("Héritage Bistro creator can create RESTO-1 setup through the protected handler", async () => {
  const result = await OnboardingService.createInitialWorkspace(
    "creator",
    request(["RESTAURANTS"]),
  );
  const route = RESTAURANTS_ROUTES.find(
    (route) => route.kind === "restaurant" && route.operation === "create",
  )!;
  const response = await restaurantsHandler(route.name)({
    headers: { "x-org-id": result.activeOrgId, "accept-language": "en" },
    body: JSON.stringify({
      name: "Héritage Bistro",
      clientRequestId: fixtureId(100),
    }),
    requestContext: { authorizer: { jwt: { claims: { sub: "creator" } } } },
  });
  expect(response.statusCode).toBe(200);
  const outlet = await RestaurantsService.create(
    result.activeOrgId,
    "creator",
    "outlet",
    {},
    { name: "Agla", clientRequestId: fixtureId(101) },
  );
  const menuRoute = RESTAURANTS_ROUTES.find(
    (route) => route.kind === "menu" && route.operation === "create",
  )!;
  const menuResponse = await restaurantsHandler(menuRoute.name)({
    headers: { "x-org-id": result.activeOrgId, "accept-language": "en" },
    pathParameters: { outletId: outlet.id },
    body: JSON.stringify({
      name: "Agla Menu",
      currency: "XOF",
      clientRequestId: fixtureId(102),
    }),
    requestContext: { authorizer: { jwt: { claims: { sub: "creator" } } } },
  });
  expect(menuResponse.statusCode).toBe(200);
});

test("Accounting Firm retains its eight-row cabinet/dossier/bootstrap transaction", async () => {
  const result = await OnboardingService.createInitialWorkspace("creator", {
    workspaceType: "ACCOUNTING_FIRM",
    organizationName: "Cabinet Demo",
    country: "BJ",
    accountingFramework: "SYSCOHADA_REVISED",
  });
  expect(result.workspace.cabinetRole).toBe("CABINET_ADMIN");
  expect(result.workspace.productRoles).toBeUndefined();
  expect(result.productAccess?.map((access) => access.productCode)).toEqual([
    "ACCOUNTING",
  ]);
  expect(memory.transactions[0].TransactItems).toHaveLength(8);
  expect(await TenantAccessService.getUserWorkspaces("creator")).toEqual([
    result.workspace,
  ]);
});

test("stale discovery retry hits the existing lock without partial rows or conflicting roles", async () => {
  await OnboardingService.createInitialWorkspace(
    "creator",
    request(["RESTAURANTS"]),
  );
  const snapshot = [...memory.rows.entries()];
  memory.db.on(QueryCommand).resolves({ Items: [] });
  await expect(
    OnboardingService.createInitialWorkspace("creator", request(["SALES"])),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect([...memory.rows.entries()]).toEqual(snapshot);
});

test.each(["PRODUCT_ACCESS", "ACCOUNTING_SETTINGS", "SALES_SETTINGS"])(
  "conflicting %s fails the entire all-three transaction",
  async (entityType) => {
    // Simulate a concurrent conditional-write conflict after discovery and before commit.
    memory.db.on(QueryCommand).callsFake(async () => {
      jest
        .spyOn(ProductAccessService, "buildActivationWrite")
        .mockImplementationOnce((input) => {
          const write = ProductAccessRepository.buildPutIfAbsentTransaction(
            ProductAccessRepository.buildItem({ ...input, status: "ACTIVE" }),
          );
          const sk =
            entityType === "PRODUCT_ACCESS"
              ? KeyFactory.productAccessSK("ACCOUNTING")
              : entityType === "ACCOUNTING_SETTINGS"
                ? KeyFactory.accountingSettingsSK()
                : KeyFactory.salesSettingsSK();
          const item = marshall({
            PK: KeyFactory.orgKey(input.orgId),
            SK: sk,
            entityType,
          });
          memory.rows.set(JSON.stringify([item.PK.S, item.SK.S]), item);
          return write;
        });
      return { Items: [] };
    });
    await expect(
      OnboardingService.createInitialWorkspace(
        "creator",
        request(["ACCOUNTING", "SALES", "RESTAURANTS"]),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(memory.rows.size).toBe(1);
    expect(
      [...memory.rows.values()].map((row) => unmarshall(row).entityType),
    ).toEqual([entityType]);
  },
);

describe("strict COMPANY and ACCOUNTING_FIRM contracts", () => {
  test.each(combinations.map((products) => [products] as const))(
    "accepts %j",
    (products) => {
      expect(
        CreateInitialWorkspaceRequestSchema.parse(request(products)),
      ).toEqual(request(products));
    },
  );
  test.each([
    { products: undefined },
    { products: [] },
    { products: ["SALES", "SALES"] },
    { products: ["EMECEF"] },
    { products: ["FISCAL_COMPLIANCE"] },
    { products: ["UNKNOWN"] },
    { products: ["ACCOUNTING"] },
    { products: ["RESTAURANTS"], accountingFramework: "SYSCOHADA_REVISED" },
    { orgId: "forged" },
    { userId: "forged" },
    { productRoles: { RESTAURANTS: "OWNER" } },
  ])("rejects invalid company input %j", (override) => {
    expect(
      CreateInitialWorkspaceRequestSchema.safeParse({
        ...request(["SALES"]),
        ...override,
      }).success,
    ).toBe(false);
  });
  test("preserves strict firm framework requirements and rejects product selection", () => {
    const firm = {
      workspaceType: "ACCOUNTING_FIRM",
      organizationName: "Cabinet Demo",
      country: "BJ",
      accountingFramework: "SYCEBNL",
    };
    expect(CreateInitialWorkspaceRequestSchema.safeParse(firm).success).toBe(
      true,
    );
    expect(
      CreateInitialWorkspaceRequestSchema.safeParse({
        ...firm,
        accountingFramework: undefined,
      }).success,
    ).toBe(false);
    expect(
      CreateInitialWorkspaceRequestSchema.safeParse({
        ...firm,
        products: ["RESTAURANTS"],
      }).success,
    ).toBe(false);
  });
});
