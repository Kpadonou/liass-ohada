import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { SalesPaymentRepository } from "@/lambda/domains/sales/invoices/sales-payment-repository";
import { KeyFactory } from "@/lambda/shared/key-builder";

const dynamoMock = mockClient(DynamoDBClient);
const timestamp = "2026-09-10T10:00:00.000Z";
const payment = {
  id: "SPAY-1757498400000-123",
  invoiceId: "SINV-1",
  amount: "30",
  currency: "EUR",
  paymentDate: "2026-09-10",
  method: "BANK_TRANSFER" as const,
  reference: "VIR-42",
  createdAt: timestamp,
};
const receivable = {
  invoiceId: "SINV-1",
  currency: "EUR",
  invoiceAmount: "100",
  amountPaid: "30",
  balanceDue: "70",
  status: "PARTIALLY_PAID" as const,
  paymentCount: 1,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe("SalesPaymentRepository", () => {
  beforeEach(() => dynamoMock.reset());

  test("uses KeyFactory for Receivable, Payment, and idempotency keys", () => {
    expect(KeyFactory.salesReceivableSK("SINV-1")).toBe("SALES_RECEIVABLE#SINV-1");
    expect(KeyFactory.salesPaymentPrefix("SINV-1")).toBe("SALES_PAYMENT#SINV-1#");
    expect(KeyFactory.salesPaymentSK("SINV-1", payment.id)).toBe(`SALES_PAYMENT#SINV-1#${payment.id}`);
    expect(KeyFactory.salesPaymentIdempotencySK("request-1")).toBe("SALES_PAYMENT_IDEMPOTENCY#request-1");
  });

  test("atomically creates first Receivable, immutable Payment, and idempotency record", async () => {
    dynamoMock.on(TransactWriteItemsCommand).resolves({});
    await SalesPaymentRepository.recordAtomically({
      orgId: "org-123",
      payment,
      receivable,
      recordedByUserId: "user-123",
      clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
      originalExpectedVersion: 0,
      previousReceivableVersion: 0,
    });
    const transaction = dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    expect(transaction.TransactItems).toHaveLength(4);
    const [invoiceCheck, receivablePut, paymentPut, idempotencyPut] = transaction.TransactItems ?? [];
    expect(unmarshall(invoiceCheck.ConditionCheck?.Key ?? {})).toEqual({
      PK: "ORG#org-123", SK: "SALES_INVOICE#SINV-1",
    });
    expect(invoiceCheck.ConditionCheck?.ConditionExpression).toContain("#status = :issued");
    expect(receivablePut.Put?.ConditionExpression).toContain("attribute_not_exists");
    expect(unmarshall(receivablePut.Put?.Item ?? {})).toMatchObject({
      PK: "ORG#org-123", SK: "SALES_RECEIVABLE#SINV-1",
      entityType: "SALES_RECEIVABLE", invoiceAmountMinor: "10000",
      amountPaidMinor: "3000", balanceDueMinor: "7000", version: 1,
    });
    expect(unmarshall(paymentPut.Put?.Item ?? {})).toMatchObject({
      SK: `SALES_PAYMENT#SINV-1#${payment.id}`,
      entityType: "SALES_PAYMENT", amountMinor: "3000", recordedByUserId: "user-123",
    });
    expect(unmarshall(idempotencyPut.Put?.Item ?? {})).toMatchObject({
      entityType: "SALES_PAYMENT_IDEMPOTENCY", invoiceId: "SINV-1",
      paymentId: payment.id, originalExpectedVersion: 0,
    });
  });

  test("subsequent settlement condition-checks the previous Receivable version", async () => {
    dynamoMock.on(TransactWriteItemsCommand).resolves({});
    await SalesPaymentRepository.recordAtomically({
      orgId: "org-123", payment,
      receivable: { ...receivable, version: 2, paymentCount: 2 },
      recordedByUserId: "user-123",
      clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
      originalExpectedVersion: 1,
      previousReceivableVersion: 1,
    });
    const put = dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input.TransactItems?.[1].Put;
    expect(put?.ConditionExpression).toContain("#version = :expectedVersion");
    expect(unmarshall(put?.ExpressionAttributeValues ?? {})).toMatchObject({ ":expectedVersion": 1 });
  });

  test("lists only one Invoice collection with Query, opaque scoped pagination, and no Scan/GSI", async () => {
    const item = {
      PK: "ORG#org-123", SK: `SALES_PAYMENT#SINV-1#${payment.id}`,
      entityType: "SALES_PAYMENT", orgId: "org-123", id: payment.id,
      invoiceId: "SINV-1", amountMinor: "3000", currency: "EUR",
      paymentDate: payment.paymentDate, method: payment.method,
      reference: payment.reference, recordedByUserId: "user-123", createdAt: timestamp,
    };
    const lastKey = marshall({ PK: item.PK, SK: item.SK });
    dynamoMock.on(QueryCommand).resolves({ Items: [marshall(item)], LastEvaluatedKey: lastKey });
    const result = await SalesPaymentRepository.list("org-123", "SINV-1", { limit: 20 });
    expect(result.items).toEqual([payment]);
    expect(result.items[0]).not.toHaveProperty("recordedByUserId");
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(unmarshall(query.ExpressionAttributeValues ?? {})).toEqual({
      ":pk": "ORG#org-123", ":prefix": "SALES_PAYMENT#SINV-1#",
    });
    expect(query.IndexName).toBeUndefined();
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
    await SalesPaymentRepository.list("org-123", "SINV-1", { cursor: result.nextCursor });
    expect(dynamoMock.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey).toEqual(lastKey);
  });

  test.each([
    marshall({ PK: "ORG#other", SK: `SALES_PAYMENT#SINV-1#${payment.id}` }),
    marshall({ PK: "ORG#org-123", SK: `SALES_PAYMENT#SINV-2#${payment.id}` }),
  ])("rejects cross-tenant or cross-Invoice cursor", async (key) => {
    const cursor = Buffer.from(JSON.stringify(key)).toString("base64");
    await expect(SalesPaymentRepository.list("org-123", "SINV-1", { cursor }))
      .rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("consistent reads are tenant and Invoice scoped", async () => {
    dynamoMock.on(GetItemCommand).resolves({});
    await SalesPaymentRepository.getReceivable("org-123", "SINV-1");
    await SalesPaymentRepository.getPayment("org-123", "SINV-1", payment.id);
    await SalesPaymentRepository.getIdempotency(
      "org-123", "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
    );
    expect(dynamoMock.commandCalls(GetItemCommand).every(
      (call) => call.args[0].input.ConsistentRead === true,
    )).toBe(true);
  });
});
