import { handler as createHandler } from "@/lambda/domains/sales/invoices/create-sales-credit-note";
import { handler as issueHandler } from "@/lambda/domains/sales/invoices/issue-sales-credit-note";
import { handler as listHandler } from "@/lambda/domains/sales/invoices/list-sales-credit-notes";
import { SalesCreditNoteService } from "@/lambda/domains/sales/invoices/sales-credit-note-service";
import { EffectiveOrganizationAccessService } from "@/lambda/shared/services/effective-organization-access-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";

jest.mock("@/lambda/domains/sales/invoices/sales-credit-note-service", () => ({
  SalesCreditNoteService: { create: jest.fn(), list: jest.fn(), issue: jest.fn() },
}));

const timestamp = "2026-09-10T10:00:00.000Z";
const draft = { id: "SCN-1", originalInvoiceId: "SINV-1", originalInvoiceNumber: "00000001",
  status: "DRAFT" as const, currency: "XOF", reason: "Return", lines: [], subtotal: "0",
  taxTotal: "0", total: "0", lineCount: 0, version: 1, createdAt: timestamp, updatedAt: timestamp };
const event = (routeKey: string, body?: Record<string, unknown>) => ({
  version: "2.0", routeKey, rawPath: "/sales/invoices/SINV-1/credit-notes", rawQueryString: "",
  headers: { "accept-language": "en", "x-org-id": "org-client" },
  requestContext: { authorizer: { jwt: { claims: { sub: "cabinet-user" }, scopes: [] } } },
  body: body ? JSON.stringify(body) : undefined,
  pathParameters: {
    invoiceId: "SINV-1",
    ...(routeKey.includes("{creditNoteId}") ? { creditNoteId: "SCN-1" } : {}),
  }, isBase64Encoded: false,
});

describe("SALES Credit Note route authorization", () => {
  beforeEach(() => {
    jest.restoreAllMocks(); jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockResolvedValue({
      accessMode: "READ_WRITE", accessSource: "CABINET", orgId: "org-client",
      permissions: ["SALES_READ", "SALES_WRITE"], workspaceOrgId: "org-cabinet",
    });
    jest.spyOn(ProductAccessService, "requireActiveProductAccess").mockResolvedValue({
      orgId: "org-client", productCode: "SALES", status: "ACTIVE", createdAt: timestamp, updatedAt: timestamp,
    });
    jest.mocked(SalesCreditNoteService.list).mockResolvedValue({ items: [] });
    jest.mocked(SalesCreditNoteService.create).mockResolvedValue(draft);
  });

  test("SALES_READ lists in effectiveOrgId", async () => {
    const response = await listHandler(event("GET /sales/invoices/{invoiceId}/credit-notes") as any);
    expect(response.statusCode).toBe(200);
    expect(SalesCreditNoteService.list).toHaveBeenCalledWith("org-client", "SINV-1", { limit: 50 });
  });

  test("SALES_WRITE creates with server-derived actor and rejects strict server fields", async () => {
    expect((await createHandler(event("POST /sales/invoices/{invoiceId}/credit-notes", { reason: "Return" }) as any)).statusCode).toBe(200);
    expect(SalesCreditNoteService.create).toHaveBeenCalledWith("org-client", "cabinet-user", "SINV-1", { reason: "Return" });
    expect((await createHandler(event("POST /sales/invoices/{invoiceId}/credit-notes", { currency: "XOF" }) as any)).statusCode).toBe(400);
  });

  test("read-only Cabinet assignment cannot mutate and ACCOUNTING alone does not authorize", async () => {
    jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockResolvedValue({
      accessMode: "READ_ONLY", accessSource: "CABINET", orgId: "org-client",
      permissions: ["ACCOUNTING_READ"], workspaceOrgId: "org-cabinet",
    });
    const response = await issueHandler(event("POST /sales/invoices/{invoiceId}/credit-notes/{creditNoteId}/issue", {
      expectedCreditNoteVersion: 2, expectedReceivableVersion: 0,
      clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da", issueDate: "2026-09-10",
    }) as any);
    expect(response.statusCode).toBe(403);
    expect(SalesCreditNoteService.issue).not.toHaveBeenCalled();
  });
});
