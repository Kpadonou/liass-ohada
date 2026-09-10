import {
  SalesInvoiceDocumentSchema,
  SalesInvoiceDocumentTypeSchema,
  SalesInvoiceDownloadUrlSchema,
} from "@liass-ohada/shared/sales";

const document = {
  status: "AVAILABLE",
  invoiceId: "SINV-1",
  documentType: "INVOICE_PDF",
  renderingVersion: "1",
  contentHash: "a".repeat(64),
  contentType: "application/pdf",
  sizeBytes: 4096,
  generatedAt: "2026-09-10T10:00:00.000Z",
};

describe("SALES Invoice document contracts", () => {
  test("accepts canonical public metadata without storage internals", () => {
    expect(SalesInvoiceDocumentSchema.parse(document)).toEqual(document);
    expect(Object.keys(SalesInvoiceDocumentSchema.shape)).not.toEqual(
      expect.arrayContaining(["PK", "SK", "bucketName", "objectKey"]),
    );
  });

  test("supports only the Invoice PDF document type", () => {
    expect(SalesInvoiceDocumentTypeSchema.parse("INVOICE_PDF")).toBe("INVOICE_PDF");
    expect(SalesInvoiceDocumentTypeSchema.safeParse("QUOTE_PDF").success).toBe(false);
  });

  test.each([
    { ...document, contentHash: "A".repeat(64) },
    { ...document, contentHash: "a".repeat(63) },
    { ...document, renderingVersion: "0" },
    { ...document, generatedAt: "not-a-date" },
    { ...document, objectKey: "sales/org/invoice.pdf" },
  ])("rejects invalid or internal metadata %#", (candidate) => {
    expect(SalesInvoiceDocumentSchema.safeParse(candidate).success).toBe(false);
  });

  test("validates ephemeral download output", () => {
    expect(
      SalesInvoiceDownloadUrlSchema.parse({
        url: "https://documents.example.test/invoice.pdf?signature=short-lived",
        expiresAt: "2026-09-10T10:05:00.000Z",
      }),
    ).toBeDefined();
  });
});
