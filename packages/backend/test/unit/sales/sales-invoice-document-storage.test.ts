import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import {
  SALES_INVOICE_DOWNLOAD_TTL_SECONDS,
  salesInvoicePdfObjectKey,
  SalesInvoiceDocumentStorage,
  SalesInvoiceDocumentObjectIntegrityError,
  SalesInvoiceDocumentObjectMissingError,
} from "@/lambda/domains/sales/invoices/sales-invoice-document-storage";

const s3Mock = mockClient(S3Client);

describe("SalesInvoiceDocumentStorage", () => {
  beforeAll(() => {
    process.env.SALES_DOCUMENT_BUCKET_NAME = "private-documents";
  });

  beforeEach(() => s3Mock.reset());

  test("derives a deterministic tenant object key and stores private PDF facts only", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const bytes = Buffer.from("%PDF-1.7\ncontent");
    const result = await SalesInvoiceDocumentStorage.put(
      "org/unsafe",
      "SINV/1",
      "1",
      "a".repeat(64),
      bytes,
    );
    expect(result.objectKey).toBe(
      "sales/org%2Funsafe/invoices/SINV%2F1/invoice.pdf",
    );
    const input = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input;
    expect(input).toMatchObject({
      Bucket: "private-documents",
      Key: result.objectKey,
      ContentType: "application/pdf",
      Metadata: {
        invoiceid: "SINV/1",
        renderingversion: "1",
        contenthash: "a".repeat(64),
      },
    });
    expect(JSON.stringify(input.Metadata)).not.toMatch(/customer|email|phone|description/i);
  });

  test("checks the exact known object before availability or signing", async () => {
    const descriptor = {
      objectKey: salesInvoicePdfObjectKey("org-1", "SINV-1"),
      invoiceId: "SINV-1",
      renderingVersion: "1",
      contentHash: "b".repeat(64),
      sizeBytes: 42,
    };
    s3Mock.on(HeadObjectCommand).resolves({
      ContentType: "application/pdf",
      ContentLength: 42,
      Metadata: {
        invoiceid: "SINV-1",
        renderingversion: "1",
        contenthash: "b".repeat(64),
      },
    });
    await expect(SalesInvoiceDocumentStorage.assertAvailable(descriptor)).resolves.toBeUndefined();
    expect(s3Mock.commandCalls(HeadObjectCommand)[0].args[0].input.Key).toBe(
      descriptor.objectKey,
    );
  });

  test("uses a five-minute download policy and has no arbitrary-key public API", () => {
    expect(SALES_INVOICE_DOWNLOAD_TTL_SECONDS).toBe(300);
    expect(
      (SalesInvoiceDocumentStorage as unknown as Record<string, unknown>).signArbitraryKey,
    ).toBeUndefined();
    expect(GetObjectCommand).toBeDefined();
  });

  test("fails closed when the object is missing or its safe metadata differs", async () => {
    const descriptor = {
      objectKey: salesInvoicePdfObjectKey("org-1", "SINV-1"),
      invoiceId: "SINV-1",
      renderingVersion: "1",
      contentHash: "b".repeat(64),
      sizeBytes: 42,
    };
    s3Mock.on(HeadObjectCommand).rejectsOnce(Object.assign(new Error("missing"), {
      name: "NoSuchKey",
    }));
    await expect(
      SalesInvoiceDocumentStorage.assertAvailable(descriptor),
    ).rejects.toBeInstanceOf(SalesInvoiceDocumentObjectMissingError);

    s3Mock.on(HeadObjectCommand).resolves({
      ContentType: "application/pdf",
      ContentLength: 42,
      Metadata: { ...descriptor, contenthash: "c".repeat(64) } as any,
    });
    await expect(
      SalesInvoiceDocumentStorage.assertAvailable(descriptor),
    ).rejects.toBeInstanceOf(SalesInvoiceDocumentObjectIntegrityError);
  });
});
