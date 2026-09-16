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
  SalesCreditNoteDocumentAlreadyExistsError,
  SalesCreditNoteDocumentRepository,
} from "@/lambda/domains/sales/invoices/sales-credit-note-document-repository";

const dynamoMock = mockClient(DynamoDBClient);
const document = {
  status: "AVAILABLE" as const,
  creditNoteId: "SCN-1",
  documentType: "CREDIT_NOTE_PDF" as const,
  renderingVersion: "1",
  contentHash: "a".repeat(64),
  contentType: "application/pdf" as const,
  sizeBytes: 2048,
  generatedAt: "2026-09-10T10:00:00.000Z",
};

const build = (orgId = "org-123", invoiceId = "SINV-1") =>
  SalesCreditNoteDocumentRepository.buildItem({
    orgId,
    invoiceId,
    document,
    objectKey: `sales/${orgId}/invoices/${invoiceId}/credit-notes/SCN-1/credit-note.pdf`,
    generatedByUserId: "user-1",
    issuerName: "Établissements Liass",
  });

describe("SalesCreditNoteDocumentRepository", () => {
  beforeEach(() => dynamoMock.reset());

  test("conditionally creates separate metadata with canonical keys and no Scan", async () => {
    dynamoMock.on(PutItemCommand).resolves({});
    await SalesCreditNoteDocumentRepository.create(build());
    const input = dynamoMock.commandCalls(PutItemCommand)[0].args[0].input;
    expect(unmarshall(input.Item ?? {})).toMatchObject({
      PK: "ORG#org-123",
      SK: "SALES_CREDIT_NOTE_DOCUMENT#SINV-1#SCN-1#PDF",
      entityType: "SALES_CREDIT_NOTE_DOCUMENT",
      invoiceId: "SINV-1",
      creditNoteId: "SCN-1",
    });
    expect(input.ConditionExpression).toContain("attribute_not_exists");
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("reads exact tenant and Invoice-parent key and hides storage internals", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: marshall(build()) });
    const result = await SalesCreditNoteDocumentRepository.get(
      "org-123",
      "SINV-1",
      "SCN-1",
    );
    expect(dynamoMock.commandCalls(GetItemCommand)[0].args[0].input.Key).toEqual(
      marshall({
        PK: "ORG#org-123",
        SK: "SALES_CREDIT_NOTE_DOCUMENT#SINV-1#SCN-1#PDF",
      }),
    );
    expect(SalesCreditNoteDocumentRepository.toPublic(result!)).toEqual(document);
    expect(SalesCreditNoteDocumentRepository.toPublic(result!)).not.toHaveProperty("objectKey");
    dynamoMock.reset();
    dynamoMock.on(GetItemCommand).resolves({ Item: marshall(build("other-org")) });
    await expect(
      SalesCreditNoteDocumentRepository.get("org-123", "SINV-1", "SCN-1"),
    ).resolves.toBeUndefined();
  });

  test("maps the conditional concurrency race", async () => {
    dynamoMock.on(PutItemCommand).rejects(
      new ConditionalCheckFailedException({ $metadata: {}, message: "lost" }),
    );
    await expect(SalesCreditNoteDocumentRepository.create(build())).rejects.toBeInstanceOf(
      SalesCreditNoteDocumentAlreadyExistsError,
    );
  });
});
