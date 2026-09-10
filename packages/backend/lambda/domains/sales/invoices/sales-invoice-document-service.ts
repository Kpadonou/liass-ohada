import { createHash } from "node:crypto";
import {
  SalesInvoiceDocument,
  SalesInvoiceDocumentSchema,
  SalesInvoiceDownloadUrl,
  SalesInvoiceDownloadUrlSchema,
  SalesIssuedInvoice,
} from "@liass-ohada/shared/sales";
import { z } from "zod";
import { AppError } from "@/lambda/shared/app-error";
import { OrganizationService } from "@/lambda/shared/services/organization-service";
import {
  SalesInvoiceDocumentAlreadyExistsError,
  SalesInvoiceDocumentItem,
  SalesInvoiceDocumentRepository,
} from "./sales-invoice-document-repository";
import {
  SalesInvoiceDocumentObjectIntegrityError,
  SalesInvoiceDocumentObjectMissingError,
  SalesInvoiceDocumentStorage,
} from "./sales-invoice-document-storage";
import { SalesInvoicePdfRenderer } from "./sales-invoice-pdf-renderer";
import { SalesInvoiceService } from "./sales-invoice-service";

export const SALES_INVOICE_PDF_RENDERING_VERSION = "1";

const EntityIdSchema = z.string().trim().min(1).max(200);

type DocumentAuditAction =
  | "SALES_INVOICE_DOCUMENT_GENERATED"
  | "SALES_INVOICE_DOCUMENT_REUSED"
  | "SALES_INVOICE_DOCUMENT_DOWNLOAD_URL_CREATED"
  | "SALES_INVOICE_DOCUMENT_INTEGRITY_ERROR";

const audit = (input: {
  action: DocumentAuditAction;
  orgId: string;
  invoiceId: string;
  invoiceNumber: string;
  renderingVersion: string;
  contentHash?: string;
  sizeBytes?: number;
}) => console.info("[SALES_INVOICE_DOCUMENT_AUDIT]", {
  ...input,
  documentType: "INVOICE_PDF",
});

export const hashSalesInvoicePdf = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const storageDescriptor = (item: SalesInvoiceDocumentItem) => ({
  contentHash: item.contentHash,
  invoiceId: item.invoiceId,
  objectKey: item.objectKey,
  renderingVersion: item.renderingVersion,
  sizeBytes: item.sizeBytes,
});

export class SalesInvoiceDocumentService {
  static async generate(
    orgId: string,
    actorUserId: string,
    invoiceId: string,
  ): Promise<SalesInvoiceDocument> {
    const tenantId = EntityIdSchema.parse(orgId);
    const userId = EntityIdSchema.parse(actorUserId);
    const id = EntityIdSchema.parse(invoiceId);
    const invoice = await this.getIssuedInvoice(tenantId, id);
    const existing = await SalesInvoiceDocumentRepository.get(tenantId, id);

    if (existing) {
      if (existing.renderingVersion !== SALES_INVOICE_PDF_RENDERING_VERSION) {
        throw new AppError(409, "SALES_INVOICE_DOCUMENT_VERSION_CONFLICT");
      }
      try {
        await SalesInvoiceDocumentStorage.assertAvailable(storageDescriptor(existing));
        this.auditDocument("SALES_INVOICE_DOCUMENT_REUSED", tenantId, invoice, existing);
        return SalesInvoiceDocumentRepository.toPublic(existing);
      } catch (error) {
        if (!(error instanceof SalesInvoiceDocumentObjectMissingError)) {
          this.logIntegrityError(tenantId, invoice, existing);
          throw this.integrityError(error);
        }
        return this.repairMissingObject(tenantId, invoice, existing);
      }
    }

    const issuerName = await this.getIssuerName(tenantId);
    const bytes = await this.render(invoice, issuerName);
    const contentHash = hashSalesInvoicePdf(bytes);
    const stored = await SalesInvoiceDocumentStorage.put(
      tenantId,
      id,
      SALES_INVOICE_PDF_RENDERING_VERSION,
      contentHash,
      bytes,
    );
    const document = SalesInvoiceDocumentSchema.parse({
      status: "AVAILABLE",
      invoiceId: id,
      documentType: "INVOICE_PDF",
      renderingVersion: SALES_INVOICE_PDF_RENDERING_VERSION,
      contentHash,
      contentType: "application/pdf",
      sizeBytes: stored.sizeBytes,
      generatedAt: new Date().toISOString(),
    });
    const item = SalesInvoiceDocumentRepository.buildItem({
      orgId: tenantId,
      document,
      objectKey: stored.objectKey,
      generatedByUserId: userId,
      issuerName,
    });

    try {
      await SalesInvoiceDocumentRepository.create(item);
      await SalesInvoiceDocumentStorage.assertAvailable(stored);
      this.auditDocument("SALES_INVOICE_DOCUMENT_GENERATED", tenantId, invoice, item);
      return document;
    } catch (error) {
      if (error instanceof SalesInvoiceDocumentAlreadyExistsError) {
        const winner = await SalesInvoiceDocumentRepository.get(tenantId, id);
        if (
          winner &&
          winner.renderingVersion === item.renderingVersion &&
          winner.contentHash === item.contentHash
        ) {
          await SalesInvoiceDocumentStorage.assertAvailable(storageDescriptor(winner));
          this.auditDocument("SALES_INVOICE_DOCUMENT_REUSED", tenantId, invoice, winner);
          return SalesInvoiceDocumentRepository.toPublic(winner);
        }
        this.logIntegrityError(tenantId, invoice, winner ?? item);
        throw new AppError(500, "SALES_INVOICE_DOCUMENT_INTEGRITY_ERROR");
      }

      // The deterministic object intentionally remains repairable by the next retry.
      // Metadata is not AVAILABLE unless its conditional write succeeded.
      console.error("[SALES_INVOICE_DOCUMENT_PERSISTENCE_FAILURE]", {
        invoiceId: id,
        orgId: tenantId,
        renderingVersion: SALES_INVOICE_PDF_RENDERING_VERSION,
      });
      throw error;
    }
  }

  static async getMetadata(
    orgId: string,
    invoiceId: string,
  ): Promise<SalesInvoiceDocument> {
    const tenantId = EntityIdSchema.parse(orgId);
    const id = EntityIdSchema.parse(invoiceId);
    const invoice = await this.getIssuedInvoice(tenantId, id);
    const item = await this.getDocument(tenantId, id);
    try {
      await SalesInvoiceDocumentStorage.assertAvailable(storageDescriptor(item));
    } catch (error) {
      this.logIntegrityError(tenantId, invoice, item);
      throw this.integrityError(error);
    }
    return SalesInvoiceDocumentRepository.toPublic(item);
  }

  static async createDownloadUrl(
    orgId: string,
    invoiceId: string,
  ): Promise<SalesInvoiceDownloadUrl> {
    const tenantId = EntityIdSchema.parse(orgId);
    const id = EntityIdSchema.parse(invoiceId);
    const invoice = await this.getIssuedInvoice(tenantId, id);
    const item = await this.getDocument(tenantId, id);
    try {
      await SalesInvoiceDocumentStorage.assertAvailable(storageDescriptor(item));
      const result = SalesInvoiceDownloadUrlSchema.parse(
        await SalesInvoiceDocumentStorage.createDownloadUrl(item.objectKey),
      );
      this.auditDocument(
        "SALES_INVOICE_DOCUMENT_DOWNLOAD_URL_CREATED",
        tenantId,
        invoice,
        item,
      );
      return result;
    } catch (error) {
      if (
        error instanceof SalesInvoiceDocumentObjectMissingError ||
        error instanceof SalesInvoiceDocumentObjectIntegrityError
      ) {
        this.logIntegrityError(tenantId, invoice, item);
        throw this.integrityError(error);
      }
      throw error;
    }
  }

  private static async render(
    invoice: SalesIssuedInvoice,
    issuerName: string,
  ): Promise<Buffer> {
    return SalesInvoicePdfRenderer.render({
      issuer: { name: issuerName },
      invoice,
      renderingVersion: SALES_INVOICE_PDF_RENDERING_VERSION,
    });
  }

  private static async repairMissingObject(
    orgId: string,
    invoice: SalesIssuedInvoice,
    existing: SalesInvoiceDocumentItem,
  ): Promise<SalesInvoiceDocument> {
    const bytes = await this.render(invoice, existing.issuerName);
    const contentHash = hashSalesInvoicePdf(bytes);
    if (contentHash !== existing.contentHash || bytes.byteLength !== existing.sizeBytes) {
      this.logIntegrityError(orgId, invoice, existing);
      throw new AppError(500, "SALES_INVOICE_DOCUMENT_INTEGRITY_ERROR");
    }
    const stored = await SalesInvoiceDocumentStorage.put(
      orgId,
      invoice.id,
      existing.renderingVersion,
      contentHash,
      bytes,
    );
    await SalesInvoiceDocumentStorage.assertAvailable(stored);
    this.auditDocument("SALES_INVOICE_DOCUMENT_REUSED", orgId, invoice, existing);
    return SalesInvoiceDocumentRepository.toPublic(existing);
  }

  private static async getIssuerName(orgId: string): Promise<string> {
    const organization = await OrganizationService.getOrganization(orgId);
    if (!organization) {
      throw new AppError(500, "SALES_INVOICE_DOCUMENT_ISSUER_NOT_FOUND");
    }
    return organization.name;
  }

  private static async getIssuedInvoice(
    orgId: string,
    invoiceId: string,
  ): Promise<SalesIssuedInvoice> {
    const invoice = await SalesInvoiceService.get(orgId, invoiceId);
    if (invoice.status !== "ISSUED") {
      throw new AppError(409, "INVOICE_DOCUMENT_REQUIRES_ISSUED");
    }
    return invoice;
  }

  private static async getDocument(
    orgId: string,
    invoiceId: string,
  ): Promise<SalesInvoiceDocumentItem> {
    const document = await SalesInvoiceDocumentRepository.get(orgId, invoiceId);
    if (!document) throw new AppError(404, "SALES_INVOICE_DOCUMENT_NOT_FOUND");
    return document;
  }

  private static integrityError(error: unknown): AppError {
    if (
      error instanceof SalesInvoiceDocumentObjectMissingError ||
      error instanceof SalesInvoiceDocumentObjectIntegrityError
    ) {
      return new AppError(500, "SALES_INVOICE_DOCUMENT_INTEGRITY_ERROR");
    }
    throw error;
  }

  private static auditDocument(
    action: DocumentAuditAction,
    orgId: string,
    invoice: SalesIssuedInvoice,
    item: SalesInvoiceDocumentItem,
  ): void {
    audit({
      action,
      orgId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      renderingVersion: item.renderingVersion,
      contentHash: item.contentHash,
      sizeBytes: item.sizeBytes,
    });
  }

  private static logIntegrityError(
    orgId: string,
    invoice: SalesIssuedInvoice,
    item: SalesInvoiceDocumentItem,
  ): void {
    audit({
      action: "SALES_INVOICE_DOCUMENT_INTEGRITY_ERROR",
      orgId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      renderingVersion: item.renderingVersion,
      contentHash: item.contentHash,
      sizeBytes: item.sizeBytes,
    });
  }
}
