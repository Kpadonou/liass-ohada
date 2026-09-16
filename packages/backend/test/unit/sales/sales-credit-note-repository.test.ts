import { DynamoDBClient, QueryCommand, ScanCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { SalesCreditNoteRepository } from "@/lambda/domains/sales/invoices/sales-credit-note-repository";
import { KeyFactory } from "@/lambda/shared/key-builder";

const dynamoMock = mockClient(DynamoDBClient);
const timestamp = "2026-09-10T10:00:00.000Z";
const line = { id: "SCL-1", originalInvoiceLineId: "SIL-1", position: 1,
  description: "Service", quantity: "1", unitPrice: "100", taxRate: "0",
  subtotal: "100", taxAmount: "0", total: "100", createdAt: timestamp, updatedAt: timestamp };
const draft = { id: "SCN-1", originalInvoiceId: "SINV-1", originalInvoiceNumber: "00000001",
  status: "DRAFT" as const, currency: "XOF", reason: "Correction", lines: [line],
  subtotal: "100", taxTotal: "0", total: "100", lineCount: 1, version: 2,
  createdAt: timestamp, updatedAt: timestamp };
const issued = { ...draft, status: "ISSUED" as const, creditNoteNumber: "00000001",
  issueDate: "2026-09-10", issuedAt: timestamp, version: 3 };
const receivable = { invoiceId: "SINV-1", currency: "XOF", invoiceAmount: "100",
  amountPaid: "0", creditedAmount: "100", balanceDue: "0", status: "SETTLED" as const,
  paymentCount: 0, version: 1, createdAt: timestamp, updatedAt: timestamp };

describe("SalesCreditNoteRepository", () => {
  beforeEach(() => dynamoMock.reset());

  test("uses only canonical KeyFactory keys", () => {
    expect(KeyFactory.salesCreditNotePrefix("SINV-1")).toBe("SALES_CREDIT_NOTE#SINV-1#");
    expect(KeyFactory.salesCreditNoteSK("SINV-1", "SCN-1")).toBe("SALES_CREDIT_NOTE#SINV-1#SCN-1");
    expect(KeyFactory.salesCreditNoteSequenceSK()).toBe("SALES_CREDIT_NOTE_SEQUENCE#DEFAULT");
    expect(KeyFactory.salesCreditNoteIssueIdempotencySK("r1")).toBe("SALES_CREDIT_NOTE_ISSUE_IDEMPOTENCY#r1");
  });

  test("issues Invoice check, sequence, Credit Note, Receivable, and idempotency atomically", async () => {
    dynamoMock.on(TransactWriteItemsCommand).resolves({});
    await SalesCreditNoteRepository.issueAtomically({ orgId: "org-123", invoiceId: "SINV-1",
      creditNote: issued, issuedByUserId: "user-123", receivable,
      creditedLineQuantities: { "SIL-1": "1" },
      clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
      originalExpectedCreditNoteVersion: 2, originalExpectedReceivableVersion: 0,
      previousSequenceExists: false, previousSequenceValue: "0", nextSequenceValue: "1" });
    const items = dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input.TransactItems ?? [];
    expect(items).toHaveLength(5);
    expect(unmarshall(items[0].ConditionCheck?.Key ?? {})).toEqual({ PK: "ORG#org-123", SK: "SALES_INVOICE#SINV-1" });
    expect(unmarshall(items[1].Put?.Item ?? {})).toMatchObject({ entityType: "SALES_CREDIT_NOTE_SEQUENCE", lastValue: "1" });
    expect(unmarshall(items[2].Put?.Item ?? {})).toMatchObject({ entityType: "SALES_CREDIT_NOTE", status: "ISSUED", issuedByUserId: "user-123" });
    expect(unmarshall(items[3].Put?.Item ?? {})).toMatchObject({ entityType: "SALES_RECEIVABLE", creditedAmountMinor: "100", creditedLineQuantities: { "SIL-1": "1" } });
    expect(unmarshall(items[4].Put?.Item ?? {})).toMatchObject({ entityType: "SALES_CREDIT_NOTE_ISSUE_IDEMPOTENCY", creditNoteId: "SCN-1" });
  });

  test("lists one Invoice collection by Query with opaque Invoice-scoped cursor and no Scan or GSI", async () => {
    const item = SalesCreditNoteRepository.buildItem("org-123", draft);
    const lastKey = marshall({ PK: item.PK, SK: item.SK });
    dynamoMock.on(QueryCommand).resolves({ Items: [marshall(item, { removeUndefinedValues: true })], LastEvaluatedKey: lastKey });
    const result = await SalesCreditNoteRepository.list("org-123", "SINV-1", { limit: 25 });
    expect(result.items[0]).not.toHaveProperty("lines");
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(unmarshall(query.ExpressionAttributeValues ?? {})).toEqual({
      ":pk": "ORG#org-123", ":prefix": "SALES_CREDIT_NOTE#SINV-1#",
    });
    expect(query.IndexName).toBeUndefined();
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
    await SalesCreditNoteRepository.list("org-123", "SINV-1", { cursor: result.nextCursor });
    expect(dynamoMock.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey).toEqual(lastKey);
    const foreign = Buffer.from(JSON.stringify(marshall({ PK: "ORG#org-123", SK: "SALES_CREDIT_NOTE#SINV-2#SCN-1" }))).toString("base64");
    await expect(SalesCreditNoteRepository.list("org-123", "SINV-1", { cursor: foreign }))
      .rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
  });

  test("worst-case bounded aggregate has DynamoDB item-size headroom", () => {
    const lines = Array.from({ length: 100 }, (_, index) => ({ ...line, id: `SCL-${index}`,
      originalInvoiceLineId: `SIL-${index}`, position: index + 1, description: "x".repeat(2000) }));
    const item = SalesCreditNoteRepository.buildItem("org-123", { ...draft, lines,
      lineCount: 100, subtotal: "10000", total: "10000" });
    const proxyBytes = Buffer.byteLength(JSON.stringify(marshall(item, { removeUndefinedValues: true })));
    expect(proxyBytes).toBeLessThan(300 * 1024);
    expect((SalesCreditNoteRepository as unknown as { delete?: unknown }).delete).toBeUndefined();
  });
});
