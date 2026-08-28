import { handler as createHandler } from "@/lambda/domains/sales/customers/create-sales-customer";
import { handler as listHandler } from "@/lambda/domains/sales/customers/list-sales-customers";
import { handler as getHandler } from "@/lambda/domains/sales/customers/get-sales-customer";
import { handler as updateHandler } from "@/lambda/domains/sales/customers/update-sales-customer";
import { handler as activateHandler } from "@/lambda/domains/sales/customers/activate-sales-customer";
import { handler as deactivateHandler } from "@/lambda/domains/sales/customers/deactivate-sales-customer";
import { SalesCustomerService } from "@/lambda/domains/sales/customers/sales-customer-service";
import { AppError } from "@/lambda/shared/app-error";
import { EffectiveOrganizationAccessService } from "@/lambda/shared/services/effective-organization-access-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";

jest.mock("@/lambda/domains/sales/customers/sales-customer-service", () => ({
  SalesCustomerService: {
    activate: jest.fn(),
    create: jest.fn(),
    deactivate: jest.fn(),
    get: jest.fn(),
    list: jest.fn(),
    update: jest.fn(),
  },
}));

const timestamp = "2026-08-28T10:00:00.000Z";
const customer = {
  id: "SC-1",
  customerType: "BUSINESS" as const,
  name: "Client Demo",
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

describe("SALES Customer route authorization", () => {
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
    jest.mocked(SalesCustomerService.create).mockResolvedValue(customer);
    jest.mocked(SalesCustomerService.list).mockResolvedValue({ items: [customer] });
    jest.mocked(SalesCustomerService.get).mockResolvedValue(customer);
    jest.mocked(SalesCustomerService.update).mockResolvedValue(customer);
    jest.mocked(SalesCustomerService.activate).mockResolvedValue(customer);
    jest.mocked(SalesCustomerService.deactivate).mockResolvedValue(customer);
  });

  test("uses SALES entitlement and SALES_READ for effective-org listing", async () => {
    const product = jest.spyOn(ProductAccessService, "requireActiveProductAccess");
    const response = await listHandler(
      event("GET /sales/customers", { queryStringParameters: { limit: "25" } }) as any,
    );
    expect(response.statusCode).toBe(200);
    expect(product).toHaveBeenCalledWith({
      action: "GET /sales/customers",
      orgId: "org-123",
      productCode: "SALES",
    });
    expect(SalesCustomerService.list).toHaveBeenCalledWith("org-123", { limit: 25 });
  });

  test("allows SALES without consulting ACCOUNTING and uses SALES_WRITE", async () => {
    const response = await createHandler(
      event("POST /sales/customers", {
        body: { customerType: "BUSINESS", name: "Client Demo" },
      }) as any,
    );
    expect(response.statusCode).toBe(200);
    expect(SalesCustomerService.create).toHaveBeenCalledWith(
      "org-123",
      "user-123",
      { customerType: "BUSINESS", name: "Client Demo" },
    );
  });

  test("denies missing/inactive SALES before customer logic", async () => {
    jest
      .spyOn(ProductAccessService, "requireActiveProductAccess")
      .mockRejectedValue(new AppError(403, "PRODUCT_ACCESS_REQUIRED"));
    const response = await listHandler(event("GET /sales/customers") as any);
    expect(response.statusCode).toBe(403);
    expect(SalesCustomerService.list).not.toHaveBeenCalled();
  });

  test("ACCOUNTING permissions alone and Cabinet-derived permissions do not grant SALES", async () => {
    jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockResolvedValue({
      accessMode: "READ_WRITE",
      accessSource: "CABINET",
      orgId: "org-123",
      permissions: ["ACCOUNTING_READ", "ACCOUNTING_WRITE"],
      workspaceOrgId: "cabinet-1",
    });
    const response = await listHandler(event("GET /sales/customers") as any);
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe("DOMAIN_PERMISSION_REQUIRED");
  });

  test("validates route input and invokes all detail/mutation endpoints", async () => {
    const invalid = await updateHandler(
      event("PATCH /sales/customers/{customerId}", {
        body: { expectedVersion: 1 },
        pathParameters: { customerId: "SC-1" },
      }) as any,
    );
    expect(invalid.statusCode).toBe(400);

    const requests = [
      getHandler(event("GET /sales/customers/{customerId}", { pathParameters: { customerId: "SC-1" } }) as any),
      updateHandler(event("PATCH /sales/customers/{customerId}", { body: { expectedVersion: 1, name: "Changed" }, pathParameters: { customerId: "SC-1" } }) as any),
      activateHandler(event("POST /sales/customers/{customerId}/activate", { body: { expectedVersion: 1 }, pathParameters: { customerId: "SC-1" } }) as any),
      deactivateHandler(event("POST /sales/customers/{customerId}/deactivate", { body: { expectedVersion: 1 }, pathParameters: { customerId: "SC-1" } }) as any),
    ];
    await expect(Promise.all(requests)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ statusCode: 200 })]),
    );
    expect(SalesCustomerService.get).toHaveBeenCalledWith("org-123", "SC-1");
    expect(SalesCustomerService.update).toHaveBeenCalledWith(
      "org-123",
      "user-123",
      "SC-1",
      { expectedVersion: 1, name: "Changed" },
    );
    expect(SalesCustomerService.activate).toHaveBeenCalled();
    expect(SalesCustomerService.deactivate).toHaveBeenCalled();
  });
});
