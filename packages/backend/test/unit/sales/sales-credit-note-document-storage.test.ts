import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import {
  SALES_CREDIT_NOTE_DOWNLOAD_TTL_SECONDS,
  salesCreditNotePdfObjectKey,
  SalesCreditNoteDocumentObjectIntegrityError,
  SalesCreditNoteDocumentObjectMissingError,
  SalesCreditNoteDocumentStorage,
} from "@/lambda/domains/sales/invoices/sales-credit-note-document-storage";

const s3Mock = mockClient(S3Client);

describe("SalesCreditNoteDocumentStorage", () => {
  beforeAll(() => {
    process.env.SALES_DOCUMENT_BUCKET_NAME = "private-documents";
  });
  beforeEach(() => s3Mock.reset());

  test("uses a deterministic nested key and stores no business PII", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const bytes = Buffer.from("%PDF-1.7\nstable");
    const result = await SalesCreditNoteDocumentStorage.put(
      "org/unsafe",
      "SINV/1",
      "SCN/1",
      "1",
      "a".repeat(64),
      bytes,
    );
    expect(result.objectKey).toBe(
      "sales/org%2Funsafe/invoices/SINV%2F1/credit-notes/SCN%2F1/credit-note.pdf",
    );
    const input = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input;
    expect(input).toMatchObject({
      Bucket: "private-documents",
      Key: result.objectKey,
      ContentType: "application/pdf",
      Metadata: {
        invoiceid: "SINV/1",
        creditnoteid: "SCN/1",
        renderingversion: "1",
        contenthash: "a".repeat(64),
      },
    });
    expect(JSON.stringify(input.Metadata)).not.toMatch(/customer|reason|email|description/i);
  });

  test("verifies exact metadata and fails closed for missing or corrupt objects", async () => {
    const descriptor = {
      objectKey: salesCreditNotePdfObjectKey("org-1", "SINV-1", "SCN-1"),
      invoiceId: "SINV-1",
      creditNoteId: "SCN-1",
      renderingVersion: "1",
      contentHash: "b".repeat(64),
      sizeBytes: 42,
    };
    s3Mock.on(HeadObjectCommand).resolves({
      ContentType: "application/pdf",
      ContentLength: 42,
      Metadata: {
        invoiceid: "SINV-1",
        creditnoteid: "SCN-1",
        renderingversion: "1",
        contenthash: "b".repeat(64),
      },
    });
    await expect(SalesCreditNoteDocumentStorage.assertAvailable(descriptor))
      .resolves.toBeUndefined();

    s3Mock.reset();
    s3Mock.on(HeadObjectCommand).rejects(Object.assign(new Error("missing"), {
      name: "NoSuchKey",
    }));
    await expect(SalesCreditNoteDocumentStorage.assertAvailable(descriptor))
      .rejects.toBeInstanceOf(SalesCreditNoteDocumentObjectMissingError);

    s3Mock.reset();
    s3Mock.on(HeadObjectCommand).resolves({
      ContentType: "text/plain",
      ContentLength: 42,
      Metadata: {},
    });
    await expect(SalesCreditNoteDocumentStorage.assertAvailable(descriptor))
      .rejects.toBeInstanceOf(SalesCreditNoteDocumentObjectIntegrityError);
  });

  test("reuses five-minute policy and exposes no arbitrary-key signer", () => {
    expect(SALES_CREDIT_NOTE_DOWNLOAD_TTL_SECONDS).toBe(300);
    expect(GetObjectCommand).toBeDefined();
    expect(
      (SalesCreditNoteDocumentStorage as unknown as Record<string, unknown>)
        .signArbitraryKey,
    ).toBeUndefined();
  });
});
