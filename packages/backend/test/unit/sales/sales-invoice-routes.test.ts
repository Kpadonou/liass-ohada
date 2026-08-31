import { handler as createHandler } from "@/lambda/domains/sales/invoices/create-sales-invoice";
import { handler as listHandler } from "@/lambda/domains/sales/invoices/list-sales-invoices";
import { handler as getHandler } from "@/lambda/domains/sales/invoices/get-sales-invoice";
import { handler as updateHandler } from "@/lambda/domains/sales/invoices/update-sales-invoice";
import { handler as addLineHandler } from "@/lambda/domains/sales/invoices/add-sales-invoice-line";
import { handler as updateLineHandler } from "@/lambda/domains/sales/invoices/update-sales-invoice-line";
import { handler as removeLineHandler } from "@/lambda/domains/sales/invoices/remove-sales-invoice-line";
import { SalesInvoiceService } from "@/lambda/domains/sales/invoices/sales-invoice-service";
import { AppError } from "@/lambda/shared/app-error";
import { EffectiveOrganizationAccessService } from "@/lambda/shared/services/effective-organization-access-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";

jest.mock("@/lambda/domains/sales/invoices/sales-invoice-service", () => ({
  SalesInvoiceService: {
    addLine: jest.fn(),
    create: jest.fn(),
    get: jest.fn(),
    list: jest.fn(),
    removeLine: jest.fn(),
    update: jest.fn(),
    updateLine: jest.fn(),
  },
}));

const timestamp = "2026-08-28T10:00:00.000Z";
const draft = {
  id: "SINV-1",
  status: "DRAFT" as const,
  currency: "XOF",
  lines: [],
  subtotal: "0",
  taxTotal: "0",
  total: "0",
  lineCount: 0,
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

describe("SALES Draft Invoice route authorization", () => {
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
    jest.mocked(SalesInvoiceService.create).mockResolvedValue(draft);
    jest.mocked(SalesInvoiceService.list).mockResolvedValue({ items: [draft] });
    jest.mocked(SalesInvoiceService.get).mockResolvedValue(draft);
    jest.mocked(SalesInvoiceService.update).mockResolvedValue(draft);
    jest.mocked(SalesInvoiceService.addLine).mockResolvedValue(draft);
    jest.mocked(SalesInvoiceService.updateLine).mockResolvedValue(draft);
    jest.mocked(SalesInvoiceService.removeLine).mockResolvedValue(draft);
  });

  test("SALES_READ lists and gets drafts in effectiveOrgId", async () => {
    const list = await listHandler(
      event("GET /sales/invoices", { queryStringParameters: { limit: "25" } }) as any,
    );
    const detail = await getHandler(
      event("GET /sales/invoices/{invoiceId}", {
        pathParameters: { invoiceId: "SINV-1" },
      }) as any,
    );
    expect(list.statusCode).toBe(200);
    expect(detail.statusCode).toBe(200);
    expect(SalesInvoiceService.list).toHaveBeenCalledWith("org-123", { limit: 25 });
    expect(SalesInvoiceService.get).toHaveBeenCalledWith("org-123", "SINV-1");
    expect(ProductAccessService.requireActiveProductAccess).toHaveBeenCalledWith({
      action: "GET /sales/invoices",
      orgId: "org-123",
      productCode: "SALES",
    });
  });

  test("SALES_WRITE invokes all five draft mutations including DELETE query version", async () => {
    const responses = await Promise.all([
      createHandler(event("POST /sales/invoices", { body: { currency: "EUR" } }) as any),
      updateHandler(event("PATCH /sales/invoices/{invoiceId}", {
        body: { expectedVersion: 1, customerId: null },
        pathParameters: { invoiceId: "SINV-1" },
      }) as any),
      addLineHandler(event("POST /sales/invoices/{invoiceId}/lines", {
        body: { expectedVersion: 1, description: "Service", quantity: "1", unitPrice: "10" },
        pathParameters: { invoiceId: "SINV-1" },
      }) as any),
      updateLineHandler(event("PATCH /sales/invoices/{invoiceId}/lines/{lineId}", {
        body: { expectedVersion: 2, quantity: "2" },
        pathParameters: { invoiceId: "SINV-1", lineId: "SIL-1" },
      }) as any),
      removeLineHandler(event("DELETE /sales/invoices/{invoiceId}/lines/{lineId}", {
        pathParameters: { invoiceId: "SINV-1", lineId: "SIL-1" },
        queryStringParameters: { expectedVersion: "3" },
      }) as any),
    ]);
    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(SalesInvoiceService.create).toHaveBeenCalledWith("org-123", "user-123", { currency: "EUR" });
    expect(SalesInvoiceService.removeLine).toHaveBeenCalledWith(
      "org-123", "user-123", "SINV-1", "SIL-1", 3,
    );
  });

  test("SALES_READ without SALES_WRITE cannot mutate", async () => {
    jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockResolvedValue({
      accessMode: "READ_ONLY",
      accessSource: "DIRECT",
      orgId: "org-123",
      permissions: ["SALES_READ"],
      workspaceOrgId: "org-123",
    });
    const response = await createHandler(event("POST /sales/invoices") as any);
    expect(response.statusCode).toBe(403);
    expect(SalesInvoiceService.create).not.toHaveBeenCalled();
  });

  test.each(["PRODUCT_ACCESS_REQUIRED", "PRODUCT_ACCESS_INACTIVE"])(
    "denies SALES %s before invoice logic",
    async (code) => {
      jest.spyOn(ProductAccessService, "requireActiveProductAccess").mockRejectedValue(
        new AppError(403, code),
      );
      const response = await listHandler(event("GET /sales/invoices") as any);
      expect(response.statusCode).toBe(403);
      expect(SalesInvoiceService.list).not.toHaveBeenCalled();
    },
  );

  test("ACCOUNTING alone and Cabinet access without SALES permission do not authorize", async () => {
    jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockResolvedValue({
      accessMode: "READ_WRITE",
      accessSource: "CABINET",
      orgId: "org-123",
      permissions: ["ACCOUNTING_READ", "ACCOUNTING_WRITE"],
      workspaceOrgId: "cabinet-1",
    });
    const response = await getHandler(
      event("GET /sales/invoices/{invoiceId}", {
        pathParameters: { invoiceId: "SINV-1" },
      }) as any,
    );
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe("DOMAIN_PERMISSION_REQUIRED");
  });

  test("strict validation rejects decimals and client-owned calculated fields", async () => {
    const invalidDecimal = await addLineHandler(
      event("POST /sales/invoices/{invoiceId}/lines", {
        body: { expectedVersion: 1, description: "Service", quantity: "1e2", unitPrice: "10" },
        pathParameters: { invoiceId: "SINV-1" },
      }) as any,
    );
    const calculated = await addLineHandler(
      event("POST /sales/invoices/{invoiceId}/lines", {
        body: { expectedVersion: 1, description: "Service", quantity: "1", unitPrice: "10", total: "10" },
        pathParameters: { invoiceId: "SINV-1" },
      }) as any,
    );
    const official = await createHandler(
      event("POST /sales/invoices", { body: { invoiceNumber: "F-1" } }) as any,
    );
    expect([invalidDecimal, calculated, official].map((response) => response.statusCode)).toEqual([400, 400, 400]);
  });
});
