import { createHash } from "node:crypto";
import {
  SalesCreditNoteDocument,
  SalesCreditNoteDocumentSchema,
  SalesCreditNoteDownloadUrl,
  SalesCreditNoteDownloadUrlSchema,
  SalesIssuedCreditNote,
} from "@liass-ohada/shared/sales";
import { z } from "zod";
import { AppError } from "@/lambda/shared/app-error";
import { OrganizationService } from "@/lambda/shared/services/organization-service";
import {
  SalesCreditNoteDocumentAlreadyExistsError,
  SalesCreditNoteDocumentItem,
  SalesCreditNoteDocumentRepository,
} from "./sales-credit-note-document-repository";
import {
  SalesCreditNoteDocumentObjectIntegrityError,
  SalesCreditNoteDocumentObjectMissingError,
  SalesCreditNoteDocumentStorage,
} from "./sales-credit-note-document-storage";
import { SalesCreditNotePdfRenderer } from "./sales-credit-note-pdf-renderer";
import { SalesCreditNoteService } from "./sales-credit-note-service";

export const SALES_CREDIT_NOTE_PDF_RENDERING_VERSION = "1";

const EntityIdSchema = z.string().trim().min(1).max(200);

type DocumentAuditAction =
  | "SALES_CREDIT_NOTE_DOCUMENT_GENERATED"
  | "SALES_CREDIT_NOTE_DOCUMENT_REUSED"
  | "SALES_CREDIT_NOTE_DOCUMENT_DOWNLOAD_URL_CREATED"
  | "SALES_CREDIT_NOTE_DOCUMENT_INTEGRITY_ERROR";

const audit = (input: {
  action: DocumentAuditAction;
  orgId: string;
  invoiceId: string;
  creditNoteId: string;
  creditNoteNumber: string;
  renderingVersion: string;
  contentHash?: string;
  sizeBytes?: number;
}) =>
  console.info("[SALES_CREDIT_NOTE_DOCUMENT_AUDIT]", {
    ...input,
    documentType: "CREDIT_NOTE_PDF",
  });

export const hashSalesCreditNotePdf = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const storageDescriptor = (item: SalesCreditNoteDocumentItem) => ({
  contentHash: item.contentHash,
  creditNoteId: item.creditNoteId,
  invoiceId: item.invoiceId,
  objectKey: item.objectKey,
  renderingVersion: item.renderingVersion,
  sizeBytes: item.sizeBytes,
});

export class SalesCreditNoteDocumentService {
  static async generate(
    orgId: string,
    actorUserId: string,
    invoiceId: string,
    creditNoteId: string,
  ): Promise<SalesCreditNoteDocument> {
    const tenantId = EntityIdSchema.parse(orgId);
    const userId = EntityIdSchema.parse(actorUserId);
    const sourceInvoiceId = EntityIdSchema.parse(invoiceId);
    const id = EntityIdSchema.parse(creditNoteId);
    const creditNote = await this.getIssuedCreditNote(
      tenantId,
      sourceInvoiceId,
      id,
    );
    const existing = await SalesCreditNoteDocumentRepository.get(
      tenantId,
      sourceInvoiceId,
      id,
    );

    if (existing) {
      if (existing.renderingVersion !== SALES_CREDIT_NOTE_PDF_RENDERING_VERSION) {
        throw new AppError(409, "SALES_CREDIT_NOTE_DOCUMENT_VERSION_CONFLICT");
      }
      try {
        await SalesCreditNoteDocumentStorage.assertAvailable(
          storageDescriptor(existing),
        );
        this.auditDocument(
          "SALES_CREDIT_NOTE_DOCUMENT_REUSED",
          tenantId,
          creditNote,
          existing,
        );
        return SalesCreditNoteDocumentRepository.toPublic(existing);
      } catch (error) {
        if (!(error instanceof SalesCreditNoteDocumentObjectMissingError)) {
          this.logIntegrityError(tenantId, creditNote, existing);
          throw this.integrityError(error);
        }
        return this.repairMissingObject(tenantId, creditNote, existing);
      }
    }

    const issuerName = await this.getIssuerName(tenantId);
    const bytes = await this.render(creditNote, issuerName);
    const contentHash = hashSalesCreditNotePdf(bytes);
    const stored = await SalesCreditNoteDocumentStorage.put(
      tenantId,
      sourceInvoiceId,
      id,
      SALES_CREDIT_NOTE_PDF_RENDERING_VERSION,
      contentHash,
      bytes,
    );
    const document = SalesCreditNoteDocumentSchema.parse({
      status: "AVAILABLE",
      creditNoteId: id,
      documentType: "CREDIT_NOTE_PDF",
      renderingVersion: SALES_CREDIT_NOTE_PDF_RENDERING_VERSION,
      contentHash,
      contentType: "application/pdf",
      sizeBytes: stored.sizeBytes,
      generatedAt: new Date().toISOString(),
    });
    const item = SalesCreditNoteDocumentRepository.buildItem({
      orgId: tenantId,
      invoiceId: sourceInvoiceId,
      document,
      objectKey: stored.objectKey,
      generatedByUserId: userId,
      issuerName,
    });

    try {
      await SalesCreditNoteDocumentRepository.create(item);
      await SalesCreditNoteDocumentStorage.assertAvailable(stored);
      this.auditDocument(
        "SALES_CREDIT_NOTE_DOCUMENT_GENERATED",
        tenantId,
        creditNote,
        item,
      );
      return document;
    } catch (error) {
      if (error instanceof SalesCreditNoteDocumentAlreadyExistsError) {
        const winner = await SalesCreditNoteDocumentRepository.get(
          tenantId,
          sourceInvoiceId,
          id,
        );
        if (
          winner &&
          winner.renderingVersion === item.renderingVersion &&
          winner.contentHash === item.contentHash
        ) {
          await SalesCreditNoteDocumentStorage.assertAvailable(
            storageDescriptor(winner),
          );
          this.auditDocument(
            "SALES_CREDIT_NOTE_DOCUMENT_REUSED",
            tenantId,
            creditNote,
            winner,
          );
          return SalesCreditNoteDocumentRepository.toPublic(winner);
        }
        this.logIntegrityError(tenantId, creditNote, winner ?? item);
        throw new AppError(500, "SALES_CREDIT_NOTE_DOCUMENT_INTEGRITY_ERROR");
      }

      console.error("[SALES_CREDIT_NOTE_DOCUMENT_PERSISTENCE_FAILURE]", {
        creditNoteId: id,
        invoiceId: sourceInvoiceId,
        orgId: tenantId,
        renderingVersion: SALES_CREDIT_NOTE_PDF_RENDERING_VERSION,
      });
      throw error;
    }
  }

  static async getMetadata(
    orgId: string,
    invoiceId: string,
    creditNoteId: string,
  ): Promise<SalesCreditNoteDocument> {
    const tenantId = EntityIdSchema.parse(orgId);
    const sourceInvoiceId = EntityIdSchema.parse(invoiceId);
    const id = EntityIdSchema.parse(creditNoteId);
    const creditNote = await this.getIssuedCreditNote(
      tenantId,
      sourceInvoiceId,
      id,
    );
    const item = await this.getDocument(tenantId, sourceInvoiceId, id);
    try {
      await SalesCreditNoteDocumentStorage.assertAvailable(storageDescriptor(item));
    } catch (error) {
      this.logIntegrityError(tenantId, creditNote, item);
      throw this.integrityError(error);
    }
    return SalesCreditNoteDocumentRepository.toPublic(item);
  }

  static async createDownloadUrl(
    orgId: string,
    invoiceId: string,
    creditNoteId: string,
  ): Promise<SalesCreditNoteDownloadUrl> {
    const tenantId = EntityIdSchema.parse(orgId);
    const sourceInvoiceId = EntityIdSchema.parse(invoiceId);
    const id = EntityIdSchema.parse(creditNoteId);
    const creditNote = await this.getIssuedCreditNote(
      tenantId,
      sourceInvoiceId,
      id,
    );
    const item = await this.getDocument(tenantId, sourceInvoiceId, id);
    try {
      await SalesCreditNoteDocumentStorage.assertAvailable(storageDescriptor(item));
      const result = SalesCreditNoteDownloadUrlSchema.parse(
        await SalesCreditNoteDocumentStorage.createDownloadUrl(
          item.objectKey,
          creditNote.creditNoteNumber,
        ),
      );
      this.auditDocument(
        "SALES_CREDIT_NOTE_DOCUMENT_DOWNLOAD_URL_CREATED",
        tenantId,
        creditNote,
        item,
      );
      return result;
    } catch (error) {
      if (
        error instanceof SalesCreditNoteDocumentObjectMissingError ||
        error instanceof SalesCreditNoteDocumentObjectIntegrityError
      ) {
        this.logIntegrityError(tenantId, creditNote, item);
        throw this.integrityError(error);
      }
      throw error;
    }
  }

  private static async render(
    creditNote: SalesIssuedCreditNote,
    issuerName: string,
  ): Promise<Buffer> {
    return SalesCreditNotePdfRenderer.render({
      issuer: { name: issuerName },
      creditNote,
      renderingVersion: SALES_CREDIT_NOTE_PDF_RENDERING_VERSION,
    });
  }

  private static async repairMissingObject(
    orgId: string,
    creditNote: SalesIssuedCreditNote,
    existing: SalesCreditNoteDocumentItem,
  ): Promise<SalesCreditNoteDocument> {
    const bytes = await this.render(creditNote, existing.issuerName);
    const contentHash = hashSalesCreditNotePdf(bytes);
    if (
      contentHash !== existing.contentHash ||
      bytes.byteLength !== existing.sizeBytes
    ) {
      this.logIntegrityError(orgId, creditNote, existing);
      throw new AppError(500, "SALES_CREDIT_NOTE_DOCUMENT_INTEGRITY_ERROR");
    }
    const stored = await SalesCreditNoteDocumentStorage.put(
      orgId,
      existing.invoiceId,
      creditNote.id,
      existing.renderingVersion,
      contentHash,
      bytes,
    );
    await SalesCreditNoteDocumentStorage.assertAvailable(stored);
    this.auditDocument(
      "SALES_CREDIT_NOTE_DOCUMENT_REUSED",
      orgId,
      creditNote,
      existing,
    );
    return SalesCreditNoteDocumentRepository.toPublic(existing);
  }

  private static async getIssuerName(orgId: string): Promise<string> {
    const organization = await OrganizationService.getOrganization(orgId);
    if (!organization) {
      throw new AppError(500, "SALES_CREDIT_NOTE_DOCUMENT_ISSUER_NOT_FOUND");
    }
    return organization.name;
  }

  private static async getIssuedCreditNote(
    orgId: string,
    invoiceId: string,
    creditNoteId: string,
  ): Promise<SalesIssuedCreditNote> {
    const creditNote = await SalesCreditNoteService.get(
      orgId,
      invoiceId,
      creditNoteId,
    );
    if (creditNote.status !== "ISSUED") {
      throw new AppError(409, "CREDIT_NOTE_DOCUMENT_REQUIRES_ISSUED");
    }
    return creditNote;
  }

  private static async getDocument(
    orgId: string,
    invoiceId: string,
    creditNoteId: string,
  ): Promise<SalesCreditNoteDocumentItem> {
    const document = await SalesCreditNoteDocumentRepository.get(
      orgId,
      invoiceId,
      creditNoteId,
    );
    if (!document) {
      throw new AppError(404, "SALES_CREDIT_NOTE_DOCUMENT_NOT_FOUND");
    }
    return document;
  }

  private static integrityError(error: unknown): AppError {
    if (
      error instanceof SalesCreditNoteDocumentObjectMissingError ||
      error instanceof SalesCreditNoteDocumentObjectIntegrityError
    ) {
      return new AppError(500, "SALES_CREDIT_NOTE_DOCUMENT_INTEGRITY_ERROR");
    }
    throw error;
  }

  private static auditDocument(
    action: DocumentAuditAction,
    orgId: string,
    creditNote: SalesIssuedCreditNote,
    item: SalesCreditNoteDocumentItem,
  ): void {
    audit({
      action,
      orgId,
      invoiceId: creditNote.originalInvoiceId,
      creditNoteId: creditNote.id,
      creditNoteNumber: creditNote.creditNoteNumber,
      renderingVersion: item.renderingVersion,
      contentHash: item.contentHash,
      sizeBytes: item.sizeBytes,
    });
  }

  private static logIntegrityError(
    orgId: string,
    creditNote: SalesIssuedCreditNote,
    item: SalesCreditNoteDocumentItem,
  ): void {
    this.auditDocument(
      "SALES_CREDIT_NOTE_DOCUMENT_INTEGRITY_ERROR",
      orgId,
      creditNote,
      item,
    );
  }
}
