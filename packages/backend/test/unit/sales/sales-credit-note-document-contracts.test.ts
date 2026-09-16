import {
  SalesCreditNoteDocumentSchema,
  SalesCreditNoteDocumentTypeSchema,
  SalesCreditNoteDownloadUrlSchema,
} from "@liass-ohada/shared/sales";

const document = {
  status: "AVAILABLE",
  creditNoteId: "SCN-1",
  documentType: "CREDIT_NOTE_PDF",
  renderingVersion: "1",
  contentHash: "a".repeat(64),
  contentType: "application/pdf",
  sizeBytes: 4096,
  generatedAt: "2026-09-10T10:00:00.000Z",
};

describe("SALES Credit Note document contracts", () => {
  test("accepts frontend-safe metadata without persistence internals", () => {
    expect(SalesCreditNoteDocumentSchema.parse(document)).toEqual(document);
    expect(Object.keys(SalesCreditNoteDocumentSchema.shape)).not.toEqual(
      expect.arrayContaining(["PK", "SK", "bucketName", "objectKey", "invoiceId"]),
    );
  });

  test("supports only the Credit Note PDF type and valid integrity metadata", () => {
    expect(SalesCreditNoteDocumentTypeSchema.parse("CREDIT_NOTE_PDF")).toBe(
      "CREDIT_NOTE_PDF",
    );
    expect(SalesCreditNoteDocumentTypeSchema.safeParse("REFUND_PDF").success).toBe(false);
    for (const candidate of [
      { ...document, contentHash: "A".repeat(64) },
      { ...document, renderingVersion: "0" },
      { ...document, objectKey: "private/key.pdf" },
    ]) {
      expect(SalesCreditNoteDocumentSchema.safeParse(candidate).success).toBe(false);
    }
  });

  test("validates only ephemeral download output", () => {
    expect(SalesCreditNoteDownloadUrlSchema.parse({
      url: "https://documents.example.test/credit-note.pdf?signature=temporary",
      expiresAt: "2026-09-10T10:05:00.000Z",
    })).toBeDefined();
  });
});
