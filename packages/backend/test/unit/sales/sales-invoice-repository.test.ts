import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import {
  SalesInvoiceRepository,
  SalesInvoiceWriteConflictError,
} from "@/lambda/domains/sales/invoices/sales-invoice-repository";

const dynamoMock = mockClient(DynamoDBClient);
const timestamp = "2026-08-28T10:00:00.000Z";
const invoice = {
  id: "SINV-1",
  status: "DRAFT" as const,
  currency: "EUR",
  customerId: "SC-1",
  customerSnapshot: { name: "ABC SARL", email: "billing@example.com" },
  lines: [
    {
      id: "SIL-1",
      position: 1,
      catalogItemId: "SI-1",
      description: "Conseil",
      unit: "Heure",
      quantity: "1.5",
      unitPrice: "19.99",
      taxRate: "18",
      subtotal: "29.99",
      taxAmount: "5.4",
      total: "35.39",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  subtotal: "29.99",
  taxTotal: "5.4",
  total: "35.39",
  lineCount: 1,
  version: 2,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const issuedInvoice = {
  ...invoice,
  status: "ISSUED" as const,
  invoiceNumber: "00000042",
  issueDate: "2026-09-08",
  issuedAt: timestamp,
  version: 3,
};

describe("SalesInvoiceRepository", () => {
  beforeEach(() => dynamoMock.reset());

  test("stores one bounded aggregate with canonical keys and minor-unit values", async () => {
    dynamoMock.on(PutItemCommand).resolves({});
    await SalesInvoiceRepository.create("org-123", invoice);
    const input = dynamoMock.commandCalls(PutItemCommand)[0].args[0].input;
    const item = unmarshall(input.Item ?? {});
    expect(item).toMatchObject({
      PK: "ORG#org-123",
      SK: "SALES_INVOICE#SINV-1",
      entityType: "SALES_INVOICE",
      orgId: "org-123",
      subtotalMinor: "2999",
      taxTotalMinor: "540",
      totalMinor: "3539",
      lineCount: 1,
      version: 2,
    });
    expect(item.lines[0]).toMatchObject({
      subtotalMinor: "2999",
      taxAmountMinor: "540",
      totalMinor: "3539",
    });
    expect(item.lines[0]).not.toHaveProperty("subtotal");
    expect(input.ConditionExpression).toBe(
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    );
  });

  test("gets a consistent tenant-owned aggregate and returns ordered JSON-safe lines", async () => {
    const item = SalesInvoiceRepository.buildItem("org-123", {
      ...invoice,
      lines: [
        { ...invoice.lines[0], id: "SIL-2", position: 2 },
        invoice.lines[0],
      ],
      lineCount: 2,
      subtotal: "59.98",
      taxTotal: "10.8",
      total: "70.78",
    });
    dynamoMock.on(GetItemCommand).resolves({ Item: marshall(item) });
    const result = await SalesInvoiceRepository.get("org-123", "SINV-1");
    expect(dynamoMock.commandCalls(GetItemCommand)[0].args[0].input).toMatchObject({
      ConsistentRead: true,
      Key: { PK: { S: "ORG#org-123" }, SK: { S: "SALES_INVOICE#SINV-1" } },
    });
    expect(result?.lines.map((line) => line.id)).toEqual(["SIL-1", "SIL-2"]);
    expect(result).not.toHaveProperty("PK");
    expect(result?.lines[0]).not.toHaveProperty("subtotalMinor");
  });

  test("hides wrong-organization persistence data", async () => {
    const item = SalesInvoiceRepository.buildItem("org-123", invoice);
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall({ ...item, orgId: "org-other" }),
    });
    await expect(
      SalesInvoiceRepository.get("org-123", "SINV-1"),
    ).resolves.toBeUndefined();
  });

  test("lists summaries with an org-scoped Query, projection, and opaque cursor", async () => {
    const { lines: _lines, ...summaryItem } =
      SalesInvoiceRepository.buildItem("org-123", invoice);
    const lastKey = marshall({ PK: "ORG#org-123", SK: "SALES_INVOICE#SINV-1" });
    dynamoMock.on(QueryCommand).resolves({
      Items: [marshall(summaryItem)],
      LastEvaluatedKey: lastKey,
    });
    const first = await SalesInvoiceRepository.list("org-123", { limit: 20 });
    expect(first.items[0]).toMatchObject({
      id: "SINV-1",
      customerName: "ABC SARL",
      total: "35.39",
    });
    expect(first.items[0]).not.toHaveProperty("lines");
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(query.KeyConditionExpression).toBe(
      "PK = :pk AND begins_with(SK, :prefix)",
    );
    expect(unmarshall(query.ExpressionAttributeValues ?? {})).toEqual({
      ":pk": "ORG#org-123",
      ":prefix": "SALES_INVOICE#",
    });
    expect(query.IndexName).toBeUndefined();
    expect(query.ProjectionExpression).not.toContain("lines");
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);

    await SalesInvoiceRepository.list("org-123", { cursor: first.nextCursor });
    expect(
      dynamoMock.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey,
    ).toEqual(lastKey);
  });

  test.each([
    marshall({ PK: "ORG#other", SK: "SALES_INVOICE#SINV-1" }),
    marshall({ PK: "ORG#org-123", SK: "SALES_CUSTOMER#SC-1" }),
  ])("rejects a cursor outside the tenant invoice collection", async (key) => {
    const cursor = Buffer.from(JSON.stringify(key)).toString("base64");
    await expect(
      SalesInvoiceRepository.list("org-123", { cursor }),
    ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("conditionally replaces the whole aggregate so lines, totals, count, and version are atomic", async () => {
    dynamoMock.on(PutItemCommand).resolves({});
    await SalesInvoiceRepository.update("org-123", invoice, 1);
    const input = dynamoMock.commandCalls(PutItemCommand)[0].args[0].input;
    const item = unmarshall(input.Item ?? {});
    expect(input.ConditionExpression).toContain("#version = :expectedVersion");
    expect(input.ExpressionAttributeValues?.[":expectedVersion"]).toEqual({ N: "1" });
    expect(item).toMatchObject({ lines: expect.any(Array), totalMinor: "3539", lineCount: 1, version: 2 });
  });

  test("maps stale conditional writes and exposes no invoice hard-delete", async () => {
    dynamoMock.on(PutItemCommand).rejects(
      new ConditionalCheckFailedException({ $metadata: {}, message: "stale" }),
    );
    await expect(
      SalesInvoiceRepository.update("org-123", invoice, 1),
    ).rejects.toBeInstanceOf(SalesInvoiceWriteConflictError);
    expect(
      (SalesInvoiceRepository as unknown as Record<string, unknown>).delete,
    ).toBeUndefined();
  });

  test("persists and reads issued fields while keeping issuedByUserId private", async () => {
    const item = SalesInvoiceRepository.buildItem(
      "org-123",
      issuedInvoice,
      "user-123",
    );
    expect(item).toMatchObject({
      invoiceNumber: "00000042",
      issueDate: "2026-09-08",
      issuedAt: timestamp,
      issuedByUserId: "user-123",
    });
    dynamoMock.on(GetItemCommand).resolves({ Item: marshall(item) });
    const result = await SalesInvoiceRepository.get("org-123", "SINV-1");
    expect(result).toMatchObject({ status: "ISSUED", invoiceNumber: "00000042" });
    expect(result).not.toHaveProperty("issuedByUserId");
  });

  test("reads missing and existing sequence values consistently with exact strings", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({}).resolvesOnce({
      Item: marshall({
        PK: "ORG#org-123",
        SK: "SALES_INVOICE_SEQUENCE#DEFAULT",
        entityType: "SALES_INVOICE_SEQUENCE",
        orgId: "org-123",
        lastValue: "9007199254740993123456789",
        updatedAt: timestamp,
      }),
    });
    await expect(SalesInvoiceRepository.getSequence("org-123"))
      .resolves.toEqual({ exists: false, lastValue: "0" });
    await expect(SalesInvoiceRepository.getSequence("org-123"))
      .resolves.toEqual({ exists: true, lastValue: "9007199254740993123456789" });
    expect(dynamoMock.commandCalls(GetItemCommand).every(
      (call) => call.args[0].input.ConsistentRead === true,
    )).toBe(true);
  });

  test("issues sequence, aggregate, and idempotency in one conditional transaction", async () => {
    dynamoMock.on(TransactWriteItemsCommand).resolves({});
    await SalesInvoiceRepository.issueAtomically({
      orgId: "org-123",
      invoice: issuedInvoice,
      issuedByUserId: "user-123",
      clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
      originalExpectedVersion: 2,
      previousSequenceExists: true,
      previousSequenceValue: "41",
      nextSequenceValue: "42",
    });
    const input = dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    expect(input.TransactItems).toHaveLength(3);
    const [sequence, aggregate, idempotency] = input.TransactItems ?? [];
    expect(unmarshall(sequence.Put?.Item ?? {})).toMatchObject({
      PK: "ORG#org-123",
      SK: "SALES_INVOICE_SEQUENCE#DEFAULT",
      lastValue: "42",
    });
    expect(unmarshall(aggregate.Put?.Item ?? {})).toMatchObject({
      status: "ISSUED",
      invoiceNumber: "00000042",
      issuedByUserId: "user-123",
    });
    expect(unmarshall(idempotency.Put?.Item ?? {})).toMatchObject({
      SK: "SALES_INVOICE_ISSUE_IDEMPOTENCY#243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
      entityType: "SALES_INVOICE_ISSUE_IDEMPOTENCY",
      invoiceId: "SINV-1",
      originalExpectedVersion: 2,
    });
    expect(dynamoMock.commandCalls(PutItemCommand)).toHaveLength(0);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test.each([
    [0, "SEQUENCE_CONTENTION"],
    [1, "INVOICE_CONFLICT"],
    [2, "IDEMPOTENCY_CONFLICT"],
  ] as const)("classifies conditional cancellation at item %s", async (index, failure) => {
    const reasons = Array.from({ length: 3 }, (_, reasonIndex) => ({
      Code: reasonIndex === index ? "ConditionalCheckFailed" : "None",
    }));
    dynamoMock.on(TransactWriteItemsCommand).rejects({
      name: "TransactionCanceledException",
      message: "transaction cancelled",
      CancellationReasons: reasons,
    } as Error);
    await expect(SalesInvoiceRepository.issueAtomically({
      orgId: "org-123",
      invoice: issuedInvoice,
      issuedByUserId: "user-123",
      clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
      originalExpectedVersion: 2,
      previousSequenceExists: true,
      previousSequenceValue: "41",
      nextSequenceValue: "42",
    })).rejects.toMatchObject({ failure });
  });
});
