import { handler as getReceivableHandler } from "@/lambda/domains/sales/invoices/get-sales-invoice-receivable";
import { handler as listPaymentsHandler } from "@/lambda/domains/sales/invoices/list-sales-invoice-payments";
import { handler as recordPaymentHandler } from "@/lambda/domains/sales/invoices/record-sales-invoice-payment";
import { SalesPaymentService } from "@/lambda/domains/sales/invoices/sales-payment-service";
import { EffectiveOrganizationAccessService } from "@/lambda/shared/services/effective-organization-access-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";

jest.mock("@/lambda/domains/sales/invoices/sales-payment-service", () => ({
  SalesPaymentService: {
    getReceivable: jest.fn(), listPayments: jest.fn(), record: jest.fn(),
  },
}));

const timestamp = "2026-09-10T10:00:00.000Z";
const receivable = {
  invoiceId: "SINV-1", currency: "XOF", invoiceAmount: "100000",
  amountPaid: "0", balanceDue: "100000", status: "UNPAID" as const,
  paymentCount: 0, version: 0, updatedAt: timestamp,
};
const event = (
  routeKey: string,
  options: { body?: Record<string, unknown>; query?: Record<string, string> } = {},
) => ({
  version: "2.0", routeKey, rawPath: routeKey.replace(/^[A-Z]+ /, ""), rawQueryString: "",
  headers: { "accept-language": "en", "x-org-id": "org-123" },
  requestContext: { authorizer: { jwt: { claims: { sub: "user-123" }, scopes: [] } } },
  body: options.body ? JSON.stringify(options.body) : undefined,
  pathParameters: { invoiceId: "SINV-1" },
  queryStringParameters: options.query,
  isBase64Encoded: false,
});

describe("SALES Payment route authorization", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockResolvedValue({
      accessMode: "READ_WRITE", accessSource: "DIRECT", orgId: "org-123",
      permissions: ["SALES_READ", "SALES_WRITE"], workspaceOrgId: "org-123",
    });
    jest.spyOn(ProductAccessService, "requireActiveProductAccess").mockResolvedValue({
      orgId: "org-123", productCode: "SALES", status: "ACTIVE",
      createdAt: timestamp, updatedAt: timestamp,
    });
    jest.mocked(SalesPaymentService.getReceivable).mockResolvedValue(receivable);
    jest.mocked(SalesPaymentService.listPayments).mockResolvedValue({ items: [] });
    jest.mocked(SalesPaymentService.record).mockResolvedValue({
      payment: {
        id: "SPAY-1", invoiceId: "SINV-1", amount: "10", currency: "XOF",
        paymentDate: "2026-09-10", method: "CASH", createdAt: timestamp,
      },
      receivable: { ...receivable, amountPaid: "10", balanceDue: "99990", status: "PARTIALLY_PAID", paymentCount: 1, version: 1, createdAt: timestamp },
    });
  });

  test("SALES_READ gets Receivable and cursor-paginated Payments in effectiveOrgId", async () => {
    const responses = await Promise.all([
      getReceivableHandler(event("GET /sales/invoices/{invoiceId}/receivable") as any),
      listPaymentsHandler(event("GET /sales/invoices/{invoiceId}/payments", { query: { limit: "25" } }) as any),
    ]);
    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(SalesPaymentService.getReceivable).toHaveBeenCalledWith("org-123", "SINV-1");
    expect(SalesPaymentService.listPayments).toHaveBeenCalledWith("org-123", "SINV-1", { limit: 25 });
  });

  test("SALES_WRITE records with server-derived actor and no client tenant/currency fields", async () => {
    const body = {
      expectedVersion: 0,
      clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
      amount: "10", paymentDate: "2026-09-10", method: "CASH",
    };
    const response = await recordPaymentHandler(event(
      "POST /sales/invoices/{invoiceId}/payments", { body },
    ) as any);
    expect(response.statusCode).toBe(200);
    expect(SalesPaymentService.record).toHaveBeenCalledWith(
      "org-123", "user-123", "SINV-1", body,
    );
    expect(ProductAccessService.requireActiveProductAccess).toHaveBeenCalledWith({
      action: "POST /sales/invoices/{invoiceId}/payments",
      orgId: "org-123", productCode: "SALES",
    });
  });

  test("SALES_READ without SALES_WRITE cannot record", async () => {
    jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockResolvedValue({
      accessMode: "READ_ONLY", accessSource: "DIRECT", orgId: "org-123",
      permissions: ["SALES_READ"], workspaceOrgId: "org-123",
    });
    const response = await recordPaymentHandler(event(
      "POST /sales/invoices/{invoiceId}/payments",
      { body: {
        expectedVersion: 0,
        clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
        amount: "10", paymentDate: "2026-09-10", method: "CASH",
      } },
    ) as any);
    expect(response.statusCode).toBe(403);
    expect(SalesPaymentService.record).not.toHaveBeenCalled();
  });

  test("strict request rejects client-owned settlement and persistence fields", async () => {
    const base = {
      expectedVersion: 0,
      clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
      amount: "10", paymentDate: "2026-09-10", method: "CASH",
    };
    for (const field of ["currency", "paymentId", "recordedByUserId", "status"]) {
      const response = await recordPaymentHandler(event(
        "POST /sales/invoices/{invoiceId}/payments", { body: { ...base, [field]: "forbidden" } },
      ) as any);
      expect(response.statusCode).toBe(400);
    }
    expect(SalesPaymentService.record).not.toHaveBeenCalled();
  });

  test("tenant body spoofing is stripped and effectiveOrgId remains authoritative", async () => {
    const response = await recordPaymentHandler(event(
      "POST /sales/invoices/{invoiceId}/payments",
      { body: {
        expectedVersion: 0,
        clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
        amount: "10", paymentDate: "2026-09-10", method: "CASH",
        orgId: "org-attacker",
      } },
    ) as any);
    expect(response.statusCode).toBe(200);
    expect(SalesPaymentService.record).toHaveBeenCalledWith(
      "org-123", "user-123", "SINV-1", expect.not.objectContaining({ orgId: expect.anything() }),
    );
  });
});
