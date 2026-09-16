import { handler as downloadHandler } from "@/lambda/domains/sales/invoices/create-sales-credit-note-pdf-download-url";
import { handler as generateHandler } from "@/lambda/domains/sales/invoices/generate-sales-credit-note-pdf";
import { handler as metadataHandler } from "@/lambda/domains/sales/invoices/get-sales-credit-note-pdf";
import { SalesCreditNoteDocumentService } from "@/lambda/domains/sales/invoices/sales-credit-note-document-service";
import { AppError } from "@/lambda/shared/app-error";
import { EffectiveOrganizationAccessService } from "@/lambda/shared/services/effective-organization-access-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";

jest.mock("@/lambda/domains/sales/invoices/sales-credit-note-document-service", () => ({
  SalesCreditNoteDocumentService: {
    generate: jest.fn(),
    getMetadata: jest.fn(),
    createDownloadUrl: jest.fn(),
  },
}));

const timestamp = "2026-09-10T10:00:00.000Z";
const document = {
  status: "AVAILABLE" as const,
  creditNoteId: "SCN-1",
  documentType: "CREDIT_NOTE_PDF" as const,
  renderingVersion: "1",
  contentHash: "a".repeat(64),
  contentType: "application/pdf" as const,
  sizeBytes: 2048,
  generatedAt: timestamp,
};
const event = (method: string, orgId = "org-1") => ({
  version: "2.0",
  routeKey: method,
  rawPath: "/sales/invoices/SINV-1/credit-notes/SCN-1/documents/pdf",
  rawQueryString: "",
  headers: { "accept-language": "en", "x-org-id": orgId },
  requestContext: {
    authorizer: { jwt: { claims: { sub: "user-1" }, scopes: [] } },
  },
  pathParameters: { invoiceId: "SINV-1", creditNoteId: "SCN-1" },
  isBase64Encoded: false,
});

describe("SALES Credit Note document routes", () => {
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
    jest.mocked(SalesCreditNoteDocumentService.generate).mockResolvedValue(document);
    jest.mocked(SalesCreditNoteDocumentService.getMetadata).mockResolvedValue(document);
    jest.mocked(SalesCreditNoteDocumentService.createDownloadUrl).mockResolvedValue({
      url: "https://example.test/private.pdf?signature=temporary",
      expiresAt: "2026-09-10T10:05:00.000Z",
    });
  });

  test("SALES_WRITE generates in effective org with authenticated actor and parent IDs", async () => {
    const response = await generateHandler(event("POST") as any);
    expect(response.statusCode).toBe(200);
    expect(SalesCreditNoteDocumentService.generate).toHaveBeenCalledWith(
      "org-1", "user-1", "SINV-1", "SCN-1",
    );
  });

  test("SALES_READ reads metadata and requests a secure URL", async () => {
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
    expect(SalesCreditNoteDocumentService.getMetadata).toHaveBeenCalledWith(
      "org-1", "SINV-1", "SCN-1",
    );
    expect(SalesCreditNoteDocumentService.createDownloadUrl).toHaveBeenCalledWith(
      "org-1", "SINV-1", "SCN-1",
    );
  });

  test("SALES_READ cannot generate", async () => {
    jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockResolvedValue({
      accessMode: "READ_ONLY",
      accessSource: "DIRECT",
      orgId: "org-1",
      permissions: ["SALES_READ"],
      workspaceOrgId: "org-1",
    });
    const response = await generateHandler(event("POST") as any);
    expect(response.statusCode).toBe(403);
    expect(SalesCreditNoteDocumentService.generate).not.toHaveBeenCalled();
  });

  test("inactive or absent SALES entitlement is denied before domain work", async () => {
    jest.spyOn(ProductAccessService, "requireActiveProductAccess").mockRejectedValue(
      new AppError(403, "PRODUCT_ACCESS_INACTIVE"),
    );
    const response = await metadataHandler(event("GET") as any);
    expect(response.statusCode).toBe(403);
    expect(SalesCreditNoteDocumentService.getMetadata).not.toHaveBeenCalled();
  });

  test("rejects wrong tenant context before signing", async () => {
    jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockRejectedValue(
      new AppError(403, "ORG_ACCESS_FORBIDDEN"),
    );
    const response = await downloadHandler(event("POST", "other-org") as any);
    expect(response.statusCode).toBe(403);
    expect(SalesCreditNoteDocumentService.createDownloadUrl).not.toHaveBeenCalled();
  });
});
