import { SalesFiscalSourceService } from "@/lambda/domains/sales/references/sales-fiscal-source-service";
import { SalesInvoiceRepository } from "@/lambda/domains/sales/invoices/sales-invoice-repository";
import { SalesCreditNoteRepository } from "@/lambda/domains/sales/invoices/sales-credit-note-repository";
import { commercialInvoice } from "./fixtures";

beforeEach(() => jest.restoreAllMocks());
test("SALES returns only immutable issued source facts with exact minor-unit amounts and a stable digest", async () => {
  const get = jest.spyOn(SalesInvoiceRepository, "get").mockResolvedValue(commercialInvoice);
  const input = { orgId: "org-1", sourceDocumentId: "invoice-1", sourceDocumentType: "INVOICE" as const };
  const value = await SalesFiscalSourceService.getIssuedDocument(input);
  expect(value).toMatchObject({ orgId: "org-1", sourceVersion: 2, currency: "EUR", totalMinor: "2954", commercialNumber: "19",
    customerSnapshot: { taxIdentifier: "UNCLASSIFIED-TAX-ID" } });
  expect(value.lines[0]).toMatchObject({ quantity: "2.5", unitPrice: "10.01", taxRate: "18", subtotalMinor: "2503", taxAmountMinor: "451", totalMinor: "2954" });
  expect(get).toHaveBeenCalledWith("org-1", "invoice-1");
  expect(value.sourceDigest).toEqual((await SalesFiscalSourceService.getIssuedDocument(input)).sourceDigest);
  expect(value).not.toHaveProperty("PK");
  expect(value).not.toHaveProperty("issuedByUserId");
  jest.mocked(SalesInvoiceRepository.get).mockResolvedValue({ ...commercialInvoice, invoiceNumber: "20" });
  expect((await SalesFiscalSourceService.getIssuedDocument(input)).sourceDigest).not.toBe(value.sourceDigest);
});
test("drafts and wrong-organization missing sources cannot become fiscalizable", async () => {
  jest.spyOn(SalesInvoiceRepository, "get").mockResolvedValue({ ...commercialInvoice, status: "DRAFT" });
  const input = { orgId: "org-1", sourceDocumentId: "invoice-1", sourceDocumentType: "INVOICE" as const };
  await expect(SalesFiscalSourceService.getIssuedDocument(input)).rejects.toMatchObject({ messageCode: "FISCAL_SOURCE_NOT_ISSUED" });
  jest.mocked(SalesInvoiceRepository.get).mockResolvedValue(undefined);
  await expect(SalesFiscalSourceService.getIssuedDocument({ ...input, orgId: "other-org" })).rejects.toMatchObject({ messageCode: "FISCAL_SOURCE_NOT_FOUND" });
});
test("issued credit contract preserves original commercial references, reason and line identity without a fiscal code", async () => {
  const { invoiceNumber, customerId, ...facts } = commercialInvoice;
  jest.spyOn(SalesCreditNoteRepository, "get").mockResolvedValue({ ...facts, id: "credit-1", creditNoteNumber: "5",
    originalInvoiceId: "invoice-1", originalInvoiceNumber: invoiceNumber, reason: "Correction",
    lines: facts.lines.map(line => ({ ...line, originalInvoiceLineId: line.id })) });
  const value = await SalesFiscalSourceService.getIssuedDocument({ orgId: "org-1", sourceDocumentId: "credit-1",
    sourceDocumentType: "CREDIT_NOTE", originalInvoiceId: "invoice-1" });
  expect(value).toMatchObject({ sourceDocumentType: "CREDIT_NOTE", commercialNumber: "5", originalInvoiceNumber: "19", reason: "Correction" });
  expect(value.lines[0]).toHaveProperty("originalInvoiceLineId", "line-1");
  expect(JSON.stringify(value)).not.toContain("codeMECeFDGI");
  expect(SalesCreditNoteRepository.get).toHaveBeenCalledWith("org-1", "invoice-1", "credit-1");
});
