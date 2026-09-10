import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import {
  SalesInvoiceDocumentAlreadyExistsError,
  SalesInvoiceDocumentRepository,
} from "@/lambda/domains/sales/invoices/sales-invoice-document-repository";

const dynamoMock = mockClient(DynamoDBClient);
const document = {
  status: "AVAILABLE" as const,
  invoiceId: "SINV-1",
  documentType: "INVOICE_PDF" as const,
  renderingVersion: "1",
  contentHash: "a".repeat(64),
  contentType: "application/pdf" as const,
  sizeBytes: 2048,
  generatedAt: "2026-09-10T10:00:00.000Z",
};

describe("SalesInvoiceDocumentRepository", () => {
  beforeEach(() => dynamoMock.reset());

  test("creates separate metadata with canonical keys and conditional idempotency", async () => {
    dynamoMock.on(PutItemCommand).resolves({});
    const item = SalesInvoiceDocumentRepository.buildItem({
      orgId: "org-123",
      document,
      objectKey: "sales/org-123/invoices/SINV-1/invoice.pdf",
      generatedByUserId: "user-1",
      issuerName: "Établissements Liass",
    });
    await SalesInvoiceDocumentRepository.create(item);
    const input = dynamoMock.commandCalls(PutItemCommand)[0].args[0].input;
    expect(unmarshall(input.Item ?? {})).toMatchObject({
      PK: "ORG#org-123",
      SK: "SALES_INVOICE_DOCUMENT#SINV-1#PDF",
      entityType: "SALES_INVOICE_DOCUMENT",
      orgId: "org-123",
    });
    expect(input.ConditionExpression).toBe(
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    );
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("reads the exact org-scoped item and keeps storage internals private", async () => {
    const item = SalesInvoiceDocumentRepository.buildItem({
      orgId: "org-123",
      document,
      objectKey: "sales/org-123/invoices/SINV-1/invoice.pdf",
      generatedByUserId: "user-1",
      issuerName: "Établissements Liass",
    });
    dynamoMock.on(GetItemCommand).resolves({ Item: marshall(item) });
    const result = await SalesInvoiceDocumentRepository.get("org-123", "SINV-1");
    expect(dynamoMock.commandCalls(GetItemCommand)[0].args[0].input.Key).toEqual(
      marshall({
        PK: "ORG#org-123",
        SK: "SALES_INVOICE_DOCUMENT#SINV-1#PDF",
      }),
    );
    expect(SalesInvoiceDocumentRepository.toPublic(result!)).toEqual(document);
    expect(SalesInvoiceDocumentRepository.toPublic(result!)).not.toHaveProperty("objectKey");
  });

  test("hides an item whose tenant identity is inconsistent", async () => {
    const item = SalesInvoiceDocumentRepository.buildItem({
      orgId: "org-other",
      document,
      objectKey: "sales/org-other/invoices/SINV-1/invoice.pdf",
      generatedByUserId: "user-1",
      issuerName: "Établissements Liass",
    });
    dynamoMock.on(GetItemCommand).resolves({ Item: marshall(item) });
    await expect(
      SalesInvoiceDocumentRepository.get("org-123", "SINV-1"),
    ).resolves.toBeUndefined();
  });

  test("maps a concurrent conditional write to the domain race signal", async () => {
    const item = SalesInvoiceDocumentRepository.buildItem({
      orgId: "org-123",
      document,
      objectKey: "sales/org-123/invoices/SINV-1/invoice.pdf",
      generatedByUserId: "user-1",
      issuerName: "Établissements Liass",
    });
    dynamoMock.on(PutItemCommand).rejects(
      new ConditionalCheckFailedException({ $metadata: {}, message: "lost race" }),
    );
    await expect(SalesInvoiceDocumentRepository.create(item)).rejects.toBeInstanceOf(
      SalesInvoiceDocumentAlreadyExistsError,
    );
  });
});
