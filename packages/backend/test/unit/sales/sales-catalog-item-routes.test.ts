import { handler as createHandler } from "@/lambda/domains/sales/catalog/create-sales-catalog-item";
import { handler as listHandler } from "@/lambda/domains/sales/catalog/list-sales-catalog-items";
import { handler as getHandler } from "@/lambda/domains/sales/catalog/get-sales-catalog-item";
import { handler as updateHandler } from "@/lambda/domains/sales/catalog/update-sales-catalog-item";
import { handler as activateHandler } from "@/lambda/domains/sales/catalog/activate-sales-catalog-item";
import { handler as deactivateHandler } from "@/lambda/domains/sales/catalog/deactivate-sales-catalog-item";
import { SalesCatalogItemService } from "@/lambda/domains/sales/catalog/sales-catalog-item-service";
import { AppError } from "@/lambda/shared/app-error";
import { EffectiveOrganizationAccessService } from "@/lambda/shared/services/effective-organization-access-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";

jest.mock("@/lambda/domains/sales/catalog/sales-catalog-item-service", () => ({
  SalesCatalogItemService: {
    activate: jest.fn(),
    create: jest.fn(),
    deactivate: jest.fn(),
    get: jest.fn(),
    list: jest.fn(),
    update: jest.fn(),
  },
}));

const timestamp = "2026-08-28T10:00:00.000Z";
const catalogItem = {
  id: "SI-1",
  itemType: "PRODUCT" as const,
  name: "Ordinateur",
  isActive: true,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const event = (
  routeKey: string,
  options: {
    body?: Record<string, unknown>;
    pathParameters?: Record<string, string>;
    queryStringParameters?: Record<string, string>;
  } = {},
) => ({
  version: "2.0",
  routeKey,
  rawPath: routeKey.replace(/^[A-Z]+ /, ""),
  rawQueryString: "",
  headers: { "accept-language": "en", "x-org-id": "org-123" },
  requestContext: {
    authorizer: { jwt: { claims: { sub: "user-123" }, scopes: [] } },
  },
  body: options.body ? JSON.stringify(options.body) : undefined,
  pathParameters: options.pathParameters,
  queryStringParameters: options.queryStringParameters,
  isBase64Encoded: false,
});

describe("SALES Catalog Item route authorization", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockResolvedValue({
      accessMode: "READ_WRITE",
      accessSource: "DIRECT",
      orgId: "org-123",
      permissions: ["SALES_READ", "SALES_WRITE"],
      workspaceOrgId: "org-123",
    });
    jest.spyOn(ProductAccessService, "requireActiveProductAccess").mockResolvedValue({
      orgId: "org-123",
      productCode: "SALES",
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    jest.mocked(SalesCatalogItemService.create).mockResolvedValue(catalogItem);
    jest.mocked(SalesCatalogItemService.list).mockResolvedValue({ items: [catalogItem] });
    jest.mocked(SalesCatalogItemService.get).mockResolvedValue(catalogItem);
    jest.mocked(SalesCatalogItemService.update).mockResolvedValue(catalogItem);
    jest.mocked(SalesCatalogItemService.activate).mockResolvedValue(catalogItem);
    jest.mocked(SalesCatalogItemService.deactivate).mockResolvedValue(catalogItem);
  });

  test("uses effective org, SALES entitlement, and SALES_READ for list/get", async () => {
    const product = jest.spyOn(ProductAccessService, "requireActiveProductAccess");
    const listResponse = await listHandler(
      event("GET /sales/items", { queryStringParameters: { limit: "25" } }) as any,
    );
    const getResponse = await getHandler(
      event("GET /sales/items/{itemId}", { pathParameters: { itemId: "SI-1" } }) as any,
    );
    expect(listResponse.statusCode).toBe(200);
    expect(getResponse.statusCode).toBe(200);
    expect(product).toHaveBeenCalledWith({
      action: "GET /sales/items",
      orgId: "org-123",
      productCode: "SALES",
    });
    expect(SalesCatalogItemService.list).toHaveBeenCalledWith("org-123", { limit: 25 });
    expect(SalesCatalogItemService.get).toHaveBeenCalledWith("org-123", "SI-1");
  });

  test("uses SALES_WRITE for creation without Accounting or Customer coupling", async () => {
    const response = await createHandler(
      event("POST /sales/items", {
        body: { itemType: "SERVICE", name: "Conseil" },
      }) as any,
    );
    expect(response.statusCode).toBe(200);
    expect(SalesCatalogItemService.create).toHaveBeenCalledWith(
      "org-123",
      "user-123",
      { itemType: "SERVICE", name: "Conseil" },
    );
  });

  test("denies writes when effective access has SALES_READ only", async () => {
    jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockResolvedValue({
      accessMode: "READ_ONLY",
      accessSource: "DIRECT",
      orgId: "org-123",
      permissions: ["SALES_READ"],
      workspaceOrgId: "org-123",
    });
    const response = await createHandler(
      event("POST /sales/items", {
        body: { itemType: "SERVICE", name: "Conseil" },
      }) as any,
    );
    expect(response.statusCode).toBe(403);
    expect(SalesCatalogItemService.create).not.toHaveBeenCalled();
  });

  test("denies unavailable SALES before catalog logic", async () => {
    jest
      .spyOn(ProductAccessService, "requireActiveProductAccess")
      .mockRejectedValue(new AppError(403, "PRODUCT_ACCESS_REQUIRED"));
    const response = await listHandler(event("GET /sales/items") as any);
    expect(response.statusCode).toBe(403);
    expect(SalesCatalogItemService.list).not.toHaveBeenCalled();
  });

  test("denies inactive SALES before catalog logic", async () => {
    jest
      .spyOn(ProductAccessService, "requireActiveProductAccess")
      .mockRejectedValue(new AppError(403, "PRODUCT_ACCESS_INACTIVE"));
    const response = await listHandler(event("GET /sales/items") as any);
    expect(response.statusCode).toBe(403);
    expect(SalesCatalogItemService.list).not.toHaveBeenCalled();
  });

  test("ACCOUNTING-only Cabinet access does not grant SALES", async () => {
    jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockResolvedValue({
      accessMode: "READ_WRITE",
      accessSource: "CABINET",
      orgId: "org-123",
      permissions: ["ACCOUNTING_READ", "ACCOUNTING_WRITE"],
      workspaceOrgId: "cabinet-1",
    });
    const response = await listHandler(event("GET /sales/items") as any);
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe("DOMAIN_PERMISSION_REQUIRED");
  });

  test("validates strict inputs and invokes update/lifecycle routes", async () => {
    const invalid = await updateHandler(
      event("PATCH /sales/items/{itemId}", {
        body: { expectedVersion: 1 },
        pathParameters: { itemId: "SI-1" },
      }) as any,
    );
    const excluded = await createHandler(
      event("POST /sales/items", {
        body: { itemType: "PRODUCT", name: "Article", price: 1000 },
      }) as any,
    );
    expect(invalid.statusCode).toBe(400);
    expect(excluded.statusCode).toBe(400);
    const invalidPagination = await listHandler(
      event("GET /sales/items", { queryStringParameters: { limit: "101" } }) as any,
    );
    expect(invalidPagination.statusCode).toBe(400);

    await expect(
      Promise.all([
        updateHandler(event("PATCH /sales/items/{itemId}", { body: { expectedVersion: 1, name: "Changed" }, pathParameters: { itemId: "SI-1" } }) as any),
        activateHandler(event("POST /sales/items/{itemId}/activate", { body: { expectedVersion: 1 }, pathParameters: { itemId: "SI-1" } }) as any),
        deactivateHandler(event("POST /sales/items/{itemId}/deactivate", { body: { expectedVersion: 1 }, pathParameters: { itemId: "SI-1" } }) as any),
      ]),
    ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ statusCode: 200 })]));
    expect(SalesCatalogItemService.update).toHaveBeenCalledWith(
      "org-123",
      "user-123",
      "SI-1",
      { expectedVersion: 1, name: "Changed" },
    );
    expect(SalesCatalogItemService.activate).toHaveBeenCalled();
    expect(SalesCatalogItemService.deactivate).toHaveBeenCalled();
  });
});
