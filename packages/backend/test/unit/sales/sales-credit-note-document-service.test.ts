import type { SalesIssuedCreditNote } from "@liass-ohada/shared/sales";
import {
  SalesCreditNoteDocumentAlreadyExistsError,
  SalesCreditNoteDocumentRepository,
} from "@/lambda/domains/sales/invoices/sales-credit-note-document-repository";
import {
  hashSalesCreditNotePdf,
  SalesCreditNoteDocumentService,
} from "@/lambda/domains/sales/invoices/sales-credit-note-document-service";
import {
  salesCreditNotePdfObjectKey,
  SalesCreditNoteDocumentObjectMissingError,
  SalesCreditNoteDocumentStorage,
} from "@/lambda/domains/sales/invoices/sales-credit-note-document-storage";
import { SalesCreditNotePdfRenderer } from "@/lambda/domains/sales/invoices/sales-credit-note-pdf-renderer";
import { SalesCreditNoteService } from "@/lambda/domains/sales/invoices/sales-credit-note-service";
import { SalesInvoiceCalculator } from "@/lambda/domains/sales/invoices/sales-invoice-calculator";
import { SalesPaymentService } from "@/lambda/domains/sales/invoices/sales-payment-service";
import { OrganizationService } from "@/lambda/shared/services/organization-service";

const timestamp = "2026-09-10T10:00:00.000Z";
const creditNote: SalesIssuedCreditNote = {
  id: "SCN-1",
  originalInvoiceId: "SINV-1",
  originalInvoiceNumber: "00000042",
  status: "ISSUED",
  creditNoteNumber: "00000007",
  issueDate: "2026-09-10",
  issuedAt: timestamp,
  currency: "XOF",
  reason: "Retour",
  lines: [{
    id: "SCL-1",
    originalInvoiceLineId: "SIL-1",
    position: 1,
    description: "Conseil",
    quantity: "1",
    unitPrice: "25000",
    taxRate: "18",
    subtotal: "25001",
    taxAmount: "4501",
    total: "29502",
    createdAt: timestamp,
    updatedAt: timestamp,
  }],
  subtotal: "25001",
  taxTotal: "4501",
  total: "29502",
  lineCount: 1,
  version: 3,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const bytes = Buffer.from("%PDF-1.7\nstable-issued-credit-note");
const contentHash = hashSalesCreditNotePdf(bytes);
const objectKey = salesCreditNotePdfObjectKey("org-1", "SINV-1", "SCN-1");
const publicDocument = {
  status: "AVAILABLE" as const,
  creditNoteId: "SCN-1",
  documentType: "CREDIT_NOTE_PDF" as const,
  renderingVersion: "1",
  contentHash,
  contentType: "application/pdf" as const,
  sizeBytes: bytes.byteLength,
  generatedAt: timestamp,
};
const item = SalesCreditNoteDocumentRepository.buildItem({
  orgId: "org-1",
  invoiceId: "SINV-1",
  document: publicDocument,
  objectKey,
  generatedByUserId: "user-1",
  issuerName: "Établissements Liass",
});

describe("SalesCreditNoteDocumentService", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(SalesCreditNoteService, "get").mockResolvedValue(creditNote);
    jest.spyOn(OrganizationService, "getOrganization").mockResolvedValue({
      orgId: "org-1",
      name: "Établissements Liass",
      country: "BJ",
      accountingFramework: "SYSCOHADA_REVISED",
      workspaceType: "COMPANY",
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    jest.spyOn(SalesCreditNotePdfRenderer, "render").mockResolvedValue(bytes);
    jest.spyOn(SalesCreditNoteDocumentStorage, "put").mockResolvedValue({
      objectKey,
      invoiceId: "SINV-1",
      creditNoteId: "SCN-1",
      renderingVersion: "1",
      contentHash,
      sizeBytes: bytes.byteLength,
    });
    jest.spyOn(SalesCreditNoteDocumentStorage, "assertAvailable").mockResolvedValue();
    jest.spyOn(SalesCreditNoteDocumentRepository, "create").mockResolvedValue();
  });

  test("rejects Draft before rendering, storage, or metadata access", async () => {
    jest.spyOn(SalesCreditNoteService, "get").mockResolvedValue({
      ...creditNote,
      status: "DRAFT",
      creditNoteNumber: undefined,
      issueDate: undefined,
      issuedAt: undefined,
    } as any);
    const getDocument = jest.spyOn(SalesCreditNoteDocumentRepository, "get");
    await expect(SalesCreditNoteDocumentService.generate(
      "org-1", "user-1", "SINV-1", "SCN-1",
    )).rejects.toMatchObject({ messageCode: "CREDIT_NOTE_DOCUMENT_REQUIRES_ISSUED" });
    expect(getDocument).not.toHaveBeenCalled();
    expect(SalesCreditNotePdfRenderer.render).not.toHaveBeenCalled();
    expect(SalesCreditNoteDocumentStorage.put).not.toHaveBeenCalled();
  });

  test("renders only persisted Credit Note and issuer facts without recalculation or mutation", async () => {
    const before = structuredClone(creditNote);
    jest.spyOn(SalesCreditNoteDocumentRepository, "get").mockResolvedValue(undefined);
    const calculateTotals = jest.spyOn(SalesInvoiceCalculator, "calculateTotals");
    const receivableRead = jest.spyOn(SalesPaymentService, "loadCanonicalReceivableState");
    await expect(SalesCreditNoteDocumentService.generate(
      "org-1", "user-1", "SINV-1", "SCN-1",
    )).resolves.toMatchObject({ contentHash });
    expect(SalesCreditNotePdfRenderer.render).toHaveBeenCalledWith({
      issuer: { name: "Établissements Liass" },
      creditNote,
      renderingVersion: "1",
    });
    expect(calculateTotals).not.toHaveBeenCalled();
    expect(receivableRead).not.toHaveBeenCalled();
    expect(creditNote).toEqual(before);
    expect(creditNote.version).toBe(3);
  });

  test("reuses valid same-version metadata", async () => {
    jest.spyOn(SalesCreditNoteDocumentRepository, "get").mockResolvedValue(item);
    await expect(SalesCreditNoteDocumentService.generate(
      "org-1", "user-1", "SINV-1", "SCN-1",
    )).resolves.toEqual(publicDocument);
    expect(SalesCreditNotePdfRenderer.render).not.toHaveBeenCalled();
    expect(SalesCreditNoteDocumentStorage.put).not.toHaveBeenCalled();
  });

  test("keeps metadata unavailable when S3 fails and retries S3/DDB partial failure", async () => {
    jest.spyOn(SalesCreditNoteDocumentRepository, "get").mockResolvedValue(undefined);
    jest.spyOn(SalesCreditNoteDocumentStorage, "put").mockRejectedValueOnce(new Error("S3 down"));
    await expect(SalesCreditNoteDocumentService.generate(
      "org-1", "user-1", "SINV-1", "SCN-1",
    )).rejects.toThrow("S3 down");
    expect(SalesCreditNoteDocumentRepository.create).not.toHaveBeenCalled();

    jest.spyOn(SalesCreditNoteDocumentStorage, "put").mockResolvedValue({
      objectKey,
      invoiceId: "SINV-1",
      creditNoteId: "SCN-1",
      renderingVersion: "1",
      contentHash,
      sizeBytes: bytes.byteLength,
    });
    jest.spyOn(SalesCreditNoteDocumentRepository, "create")
      .mockRejectedValueOnce(new Error("DynamoDB down"))
      .mockResolvedValueOnce();
    await expect(SalesCreditNoteDocumentService.generate(
      "org-1", "user-1", "SINV-1", "SCN-1",
    )).rejects.toThrow("DynamoDB down");
    await expect(SalesCreditNoteDocumentService.generate(
      "org-1", "user-1", "SINV-1", "SCN-1",
    )).resolves.toMatchObject({ contentHash });
  });

  test("concurrent generation converges and missing objects repair only from matching bytes", async () => {
    jest.spyOn(SalesCreditNoteDocumentRepository, "get")
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(item);
    jest.spyOn(SalesCreditNoteDocumentRepository, "create").mockRejectedValue(
      new SalesCreditNoteDocumentAlreadyExistsError(),
    );
    await expect(SalesCreditNoteDocumentService.generate(
      "org-1", "user-1", "SINV-1", "SCN-1",
    )).resolves.toEqual(publicDocument);

    jest.restoreAllMocks();
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(SalesCreditNoteService, "get").mockResolvedValue(creditNote);
    jest.spyOn(SalesCreditNoteDocumentRepository, "get").mockResolvedValue(item);
    jest.spyOn(SalesCreditNotePdfRenderer, "render").mockResolvedValue(bytes);
    jest.spyOn(SalesCreditNoteDocumentStorage, "put").mockResolvedValue({
      objectKey, invoiceId: "SINV-1", creditNoteId: "SCN-1", renderingVersion: "1",
      contentHash, sizeBytes: bytes.byteLength,
    });
    jest.spyOn(SalesCreditNoteDocumentStorage, "assertAvailable")
      .mockRejectedValueOnce(new SalesCreditNoteDocumentObjectMissingError())
      .mockResolvedValueOnce();
    await expect(SalesCreditNoteDocumentService.generate(
      "org-1", "user-1", "SINV-1", "SCN-1",
    )).resolves.toEqual(publicDocument);
  });

  test("never signs a missing object and hashes final bytes", async () => {
    jest.spyOn(SalesCreditNoteDocumentRepository, "get").mockResolvedValue(item);
    jest.spyOn(SalesCreditNoteDocumentStorage, "assertAvailable").mockRejectedValue(
      new SalesCreditNoteDocumentObjectMissingError(),
    );
    const sign = jest.spyOn(SalesCreditNoteDocumentStorage, "createDownloadUrl");
    await expect(SalesCreditNoteDocumentService.createDownloadUrl(
      "org-1", "SINV-1", "SCN-1",
    )).rejects.toMatchObject({ messageCode: "SALES_CREDIT_NOTE_DOCUMENT_INTEGRITY_ERROR" });
    expect(sign).not.toHaveBeenCalled();
    expect(hashSalesCreditNotePdf(bytes)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSalesCreditNotePdf(Buffer.concat([bytes, Buffer.from("changed")])))
      .not.toBe(contentHash);
  });
});
