import type { SalesIssuedInvoice } from "@liass-ohada/shared/sales";
import {
  SalesInvoiceDocumentAlreadyExistsError,
  SalesInvoiceDocumentRepository,
} from "@/lambda/domains/sales/invoices/sales-invoice-document-repository";
import {
  hashSalesInvoicePdf,
  SalesInvoiceDocumentService,
} from "@/lambda/domains/sales/invoices/sales-invoice-document-service";
import {
  SalesInvoiceDocumentObjectMissingError,
  SalesInvoiceDocumentStorage,
  salesInvoicePdfObjectKey,
} from "@/lambda/domains/sales/invoices/sales-invoice-document-storage";
import { SalesInvoicePdfRenderer } from "@/lambda/domains/sales/invoices/sales-invoice-pdf-renderer";
import { SalesInvoiceService } from "@/lambda/domains/sales/invoices/sales-invoice-service";
import { OrganizationService } from "@/lambda/shared/services/organization-service";

const timestamp = "2026-09-10T10:00:00.000Z";
const invoice: SalesIssuedInvoice = {
  id: "SINV-1",
  status: "ISSUED",
  invoiceNumber: "00000001",
  issueDate: "2026-09-10",
  issuedAt: timestamp,
  currency: "XOF",
  lines: [{
    id: "SIL-1",
    position: 1,
    description: "Conseil",
    quantity: "1",
    unitPrice: "25000",
    taxRate: "18",
    subtotal: "25000",
    taxAmount: "4500",
    total: "29500",
    createdAt: timestamp,
    updatedAt: timestamp,
  }],
  subtotal: "25000",
  taxTotal: "4500",
  total: "29500",
  lineCount: 1,
  version: 2,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const bytes = Buffer.from("%PDF-1.7\nstable-issued-invoice");
const contentHash = hashSalesInvoicePdf(bytes);
const objectKey = salesInvoicePdfObjectKey("org-1", invoice.id);
const publicDocument = {
  status: "AVAILABLE" as const,
  invoiceId: invoice.id,
  documentType: "INVOICE_PDF" as const,
  renderingVersion: "1",
  contentHash,
  contentType: "application/pdf" as const,
  sizeBytes: bytes.byteLength,
  generatedAt: timestamp,
};
const item = SalesInvoiceDocumentRepository.buildItem({
  orgId: "org-1",
  document: publicDocument,
  objectKey,
  generatedByUserId: "user-1",
  issuerName: "Établissements Liass",
});

describe("SalesInvoiceDocumentService", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(SalesInvoiceService, "get").mockResolvedValue(invoice);
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
    jest.spyOn(SalesInvoicePdfRenderer, "render").mockResolvedValue(bytes);
    jest.spyOn(SalesInvoiceDocumentStorage, "put").mockResolvedValue({
      objectKey,
      invoiceId: invoice.id,
      renderingVersion: "1",
      contentHash,
      sizeBytes: bytes.byteLength,
    });
    jest.spyOn(SalesInvoiceDocumentStorage, "assertAvailable").mockResolvedValue();
    jest.spyOn(SalesInvoiceDocumentRepository, "create").mockResolvedValue();
  });

  test("rejects Draft generation without rendering, storage, or metadata writes", async () => {
    jest.spyOn(SalesInvoiceService, "get").mockResolvedValue({
      ...invoice,
      status: "DRAFT",
      invoiceNumber: undefined,
      issueDate: undefined,
      issuedAt: undefined,
      lines: [],
      lineCount: 0,
      subtotal: "0",
      taxTotal: "0",
      total: "0",
      version: 1,
    } as any);
    const getDocument = jest.spyOn(SalesInvoiceDocumentRepository, "get");
    await expect(
      SalesInvoiceDocumentService.generate("org-1", "user-1", invoice.id),
    ).rejects.toMatchObject({ messageCode: "INVOICE_DOCUMENT_REQUIRES_ISSUED" });
    expect(getDocument).not.toHaveBeenCalled();
    expect(SalesInvoicePdfRenderer.render).not.toHaveBeenCalled();
    expect(SalesInvoiceDocumentStorage.put).not.toHaveBeenCalled();
    expect(SalesInvoiceDocumentRepository.create).not.toHaveBeenCalled();
  });

  test("generates from persisted Invoice and issuer facts without mutating the Invoice", async () => {
    const before = structuredClone(invoice);
    jest.spyOn(SalesInvoiceDocumentRepository, "get").mockResolvedValue(undefined);
    const result = await SalesInvoiceDocumentService.generate(
      "org-1",
      "user-1",
      invoice.id,
    );
    expect(result).toMatchObject({ contentHash, sizeBytes: bytes.byteLength });
    expect(SalesInvoicePdfRenderer.render).toHaveBeenCalledWith({
      issuer: { name: "Établissements Liass" },
      invoice,
      renderingVersion: "1",
    });
    expect(SalesInvoiceDocumentStorage.put).toHaveBeenCalledWith(
      "org-1",
      invoice.id,
      "1",
      contentHash,
      bytes,
    );
    expect(invoice).toEqual(before);
    expect(invoice.version).toBe(2);
  });

  test("reuses same-version metadata only after checking the object", async () => {
    jest.spyOn(SalesInvoiceDocumentRepository, "get").mockResolvedValue(item);
    await expect(
      SalesInvoiceDocumentService.generate("org-1", "user-1", invoice.id),
    ).resolves.toEqual(publicDocument);
    expect(SalesInvoiceDocumentStorage.assertAvailable).toHaveBeenCalledWith(
      expect.objectContaining({ objectKey, contentHash }),
    );
    expect(SalesInvoicePdfRenderer.render).not.toHaveBeenCalled();
    expect(SalesInvoiceDocumentStorage.put).not.toHaveBeenCalled();
  });

  test("does not write AVAILABLE metadata when S3 PutObject fails", async () => {
    jest.spyOn(SalesInvoiceDocumentRepository, "get").mockResolvedValue(undefined);
    jest.spyOn(SalesInvoiceDocumentStorage, "put").mockRejectedValue(new Error("S3 down"));
    await expect(
      SalesInvoiceDocumentService.generate("org-1", "user-1", invoice.id),
    ).rejects.toThrow("S3 down");
    expect(SalesInvoiceDocumentRepository.create).not.toHaveBeenCalled();
  });

  test("repairs a deterministic S3-without-metadata partial failure on retry", async () => {
    jest.spyOn(SalesInvoiceDocumentRepository, "get").mockResolvedValue(undefined);
    jest.spyOn(SalesInvoiceDocumentRepository, "create")
      .mockRejectedValueOnce(new Error("DynamoDB unavailable"))
      .mockResolvedValueOnce();
    await expect(
      SalesInvoiceDocumentService.generate("org-1", "user-1", invoice.id),
    ).rejects.toThrow("DynamoDB unavailable");
    await expect(
      SalesInvoiceDocumentService.generate("org-1", "user-1", invoice.id),
    ).resolves.toMatchObject({ contentHash });
    const puts = jest.mocked(SalesInvoiceDocumentStorage.put).mock.calls;
    expect(puts).toHaveLength(2);
    expect(puts[0].slice(0, 5)).toEqual(puts[1].slice(0, 5));
  });

  test("concurrent generation converges on matching winner metadata", async () => {
    jest.spyOn(SalesInvoiceDocumentRepository, "get")
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(item);
    jest.spyOn(SalesInvoiceDocumentRepository, "create").mockRejectedValue(
      new SalesInvoiceDocumentAlreadyExistsError(),
    );
    await expect(
      SalesInvoiceDocumentService.generate("org-1", "user-1", invoice.id),
    ).resolves.toEqual(publicDocument);
  });

  test("repairs missing object only when regenerated bytes match persisted hash", async () => {
    jest.spyOn(SalesInvoiceDocumentRepository, "get").mockResolvedValue(item);
    jest.spyOn(SalesInvoiceDocumentStorage, "assertAvailable")
      .mockRejectedValueOnce(new SalesInvoiceDocumentObjectMissingError())
      .mockResolvedValueOnce();
    await expect(
      SalesInvoiceDocumentService.generate("org-1", "user-1", invoice.id),
    ).resolves.toEqual(publicDocument);
    expect(SalesInvoiceDocumentStorage.put).toHaveBeenCalledTimes(1);
  });

  test("never signs missing or corrupt metadata objects", async () => {
    jest.spyOn(SalesInvoiceDocumentRepository, "get").mockResolvedValue(item);
    jest.spyOn(SalesInvoiceDocumentStorage, "assertAvailable").mockRejectedValue(
      new SalesInvoiceDocumentObjectMissingError(),
    );
    const sign = jest.spyOn(SalesInvoiceDocumentStorage, "createDownloadUrl");
    await expect(
      SalesInvoiceDocumentService.createDownloadUrl("org-1", invoice.id),
    ).rejects.toMatchObject({
      messageCode: "SALES_INVOICE_DOCUMENT_INTEGRITY_ERROR",
    });
    expect(sign).not.toHaveBeenCalled();
  });

  test("SHA-256 reflects final PDF bytes and is not a signature", () => {
    expect(hashSalesInvoicePdf(bytes)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSalesInvoicePdf(bytes)).toBe(hashSalesInvoicePdf(Buffer.from(bytes)));
    expect(hashSalesInvoicePdf(Buffer.concat([bytes, Buffer.from("changed")]))).not.toBe(
      contentHash,
    );
  });
});
