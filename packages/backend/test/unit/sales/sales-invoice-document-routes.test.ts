import { handler as generateHandler } from "@/lambda/domains/sales/invoices/generate-sales-invoice-pdf";
import { handler as metadataHandler } from "@/lambda/domains/sales/invoices/get-sales-invoice-pdf";
import { handler as downloadHandler } from "@/lambda/domains/sales/invoices/create-sales-invoice-pdf-download-url";
import { SalesInvoiceDocumentService } from "@/lambda/domains/sales/invoices/sales-invoice-document-service";
import { AppError } from "@/lambda/shared/app-error";
import { EffectiveOrganizationAccessService } from "@/lambda/shared/services/effective-organization-access-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";

jest.mock("@/lambda/domains/sales/invoices/sales-invoice-document-service", () => ({
  SalesInvoiceDocumentService: {
    generate: jest.fn(),
    getMetadata: jest.fn(),
    createDownloadUrl: jest.fn(),
  },
}));

const timestamp = "2026-09-10T10:00:00.000Z";
const document = {
  status: "AVAILABLE" as const,
  invoiceId: "SINV-1",
  documentType: "INVOICE_PDF" as const,
  renderingVersion: "1",
  contentHash: "a".repeat(64),
  contentType: "application/pdf" as const,
  sizeBytes: 2048,
  generatedAt: timestamp,
};

const event = (method: string, orgId = "org-1") => ({
  version: "2.0",
  routeKey: method,
  rawPath: "/sales/invoices/SINV-1/documents/pdf",
  rawQueryString: "",
  headers: { "accept-language": "en", "x-org-id": orgId },
  requestContext: {
    authorizer: { jwt: { claims: { sub: "user-1" }, scopes: [] } },
  },
  pathParameters: { invoiceId: "SINV-1" },
  isBase64Encoded: false,
});

describe("SALES Invoice document routes", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockResolvedValue({
      accessMode: "READ_WRITE",
      accessSource: "DIRECT",
      orgId: "org-1",
      permissions: ["SALES_READ", "SALES_WRITE"],
      workspaceOrgId: "org-1",
    });
    jest.spyOn(ProductAccessService, "requireActiveProductAccess").mockResolvedValue({
      orgId: "org-1",
      productCode: "SALES",
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    jest.mocked(SalesInvoiceDocumentService.generate).mockResolvedValue(document);
    jest.mocked(SalesInvoiceDocumentService.getMetadata).mockResolvedValue(document);
    jest.mocked(SalesInvoiceDocumentService.createDownloadUrl).mockResolvedValue({
      url: "https://example.test/private.pdf?signature=temporary",
      expiresAt: "2026-09-10T10:05:00.000Z",
    });
  });

  test("SALES_WRITE generates in effectiveOrgId with authenticated actor", async () => {
    const response = await generateHandler(event("POST") as any);
    expect(response.statusCode).toBe(200);
    expect(SalesInvoiceDocumentService.generate).toHaveBeenCalledWith(
      "org-1",
      "user-1",
      "SINV-1",
    );
  });

  test("SALES_READ can read metadata and request a secure URL", async () => {
    jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockResolvedValue({
      accessMode: "READ_ONLY",
      accessSource: "DIRECT",
      orgId: "org-1",
      permissions: ["SALES_READ"],
      workspaceOrgId: "org-1",
    });
    const [metadata, download] = await Promise.all([
      metadataHandler(event("GET") as any),
      downloadHandler(event("POST") as any),
    ]);
    expect(metadata.statusCode).toBe(200);
    expect(download.statusCode).toBe(200);
    expect(SalesInvoiceDocumentService.getMetadata).toHaveBeenCalledWith(
      "org-1",
      "SINV-1",
    );
    expect(SalesInvoiceDocumentService.createDownloadUrl).toHaveBeenCalledWith(
      "org-1",
      "SINV-1",
    );
  });

  test("SALES_READ without SALES_WRITE cannot generate", async () => {
    jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockResolvedValue({
      accessMode: "READ_ONLY",
      accessSource: "DIRECT",
      orgId: "org-1",
      permissions: ["SALES_READ"],
      workspaceOrgId: "org-1",
    });
    const response = await generateHandler(event("POST") as any);
    expect(response.statusCode).toBe(403);
    expect(SalesInvoiceDocumentService.generate).not.toHaveBeenCalled();
  });

  test.each(["PRODUCT_ACCESS_REQUIRED", "PRODUCT_ACCESS_INACTIVE"])(
    "denies %s before document access",
    async (code) => {
      jest.spyOn(ProductAccessService, "requireActiveProductAccess").mockRejectedValue(
        new AppError(403, code),
      );
      const response = await metadataHandler(event("GET") as any);
      expect(response.statusCode).toBe(403);
      expect(SalesInvoiceDocumentService.getMetadata).not.toHaveBeenCalled();
    },
  );

  test("ACCOUNTING-only permissions and a wrong effective org cannot cross the boundary", async () => {
    jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockResolvedValue({
      accessMode: "READ_WRITE",
      accessSource: "DIRECT",
      orgId: "org-other",
      permissions: ["ACCOUNTING_READ", "ACCOUNTING_WRITE"],
      workspaceOrgId: "org-other",
    });
    const denied = await metadataHandler(event("GET", "org-other") as any);
    expect(denied.statusCode).toBe(403);
    expect(SalesInvoiceDocumentService.getMetadata).not.toHaveBeenCalled();
  });
});
