import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const SALES_INVOICE_DOWNLOAD_TTL_SECONDS = 300;

const bucketName = (): string => {
  const value = process.env.SALES_DOCUMENT_BUCKET_NAME;
  if (!value) throw new Error("SALES_DOCUMENT_BUCKET_NAME is required");
  return value;
};

const s3Client = new S3Client({});

export const salesInvoicePdfObjectKey = (
  orgId: string,
  invoiceId: string,
): string =>
  `sales/${encodeURIComponent(orgId)}/invoices/${encodeURIComponent(invoiceId)}/invoice.pdf`;

export interface StoredSalesInvoicePdfDescriptor {
  contentHash: string;
  invoiceId: string;
  objectKey: string;
  renderingVersion: string;
  sizeBytes: number;
}

export class SalesInvoiceDocumentStorage {
  static async put(
    orgId: string,
    invoiceId: string,
    renderingVersion: string,
    contentHash: string,
    bytes: Buffer,
  ): Promise<StoredSalesInvoicePdfDescriptor> {
    const objectKey = salesInvoicePdfObjectKey(orgId, invoiceId);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName(),
        Key: objectKey,
        Body: bytes,
        ContentType: "application/pdf",
        Metadata: {
          invoiceid: invoiceId,
          renderingversion: renderingVersion,
          contenthash: contentHash,
        },
      }),
    );
    return {
      contentHash,
      invoiceId,
      objectKey,
      renderingVersion,
      sizeBytes: bytes.byteLength,
    };
  }

  static async assertAvailable(input: StoredSalesInvoicePdfDescriptor): Promise<void> {
    let response;
    try {
      response = await s3Client.send(
        new HeadObjectCommand({ Bucket: bucketName(), Key: input.objectKey }),
      );
    } catch (error) {
      if (
        error instanceof NotFound ||
        ["NotFound", "NoSuchKey"].includes(
          String((error as { name?: string } | undefined)?.name),
        )
      ) {
        throw new SalesInvoiceDocumentObjectMissingError();
      }
      throw error;
    }
    if (
      response.ContentType !== "application/pdf" ||
      response.ContentLength !== input.sizeBytes ||
      response.Metadata?.invoiceid !== input.invoiceId ||
      response.Metadata?.renderingversion !== input.renderingVersion ||
      response.Metadata?.contenthash !== input.contentHash
    ) {
      throw new SalesInvoiceDocumentObjectIntegrityError();
    }
  }

  static async createDownloadUrl(
    objectKey: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const expiresAt = new Date(
      Date.now() + SALES_INVOICE_DOWNLOAD_TTL_SECONDS * 1000,
    ).toISOString();
    const url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: bucketName(),
        Key: objectKey,
        ResponseContentType: "application/pdf",
      }),
      { expiresIn: SALES_INVOICE_DOWNLOAD_TTL_SECONDS },
    );
    return { url, expiresAt };
  }
}

export class SalesInvoiceDocumentObjectMissingError extends Error {
  constructor() {
    super("Sales Invoice document object is missing");
    this.name = "SalesInvoiceDocumentObjectMissingError";
  }
}

export class SalesInvoiceDocumentObjectIntegrityError extends Error {
  constructor() {
    super("Sales Invoice document object failed integrity checks");
    this.name = "SalesInvoiceDocumentObjectIntegrityError";
  }
}
