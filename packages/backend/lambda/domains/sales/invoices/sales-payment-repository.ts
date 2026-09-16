import {
  AttributeValue,
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  SalesInvoiceReceivable,
  SalesInvoiceReceivableSchema,
  SalesPayment,
  SalesPaymentListResponse,
  SalesPaymentSchema,
} from "@liass-ohada/shared/sales";
import { z } from "zod";
import { AppError } from "@/lambda/shared/app-error";
import { config, dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { SalesInvoiceCalculator } from "./sales-invoice-calculator";

const MinorAmountSchema = z.string().regex(/^\d+$/);

const SalesReceivableItemSchema = z.object({
  PK: z.string().min(1),
  SK: z.string().startsWith("SALES_RECEIVABLE#"),
  entityType: z.literal("SALES_RECEIVABLE"),
  orgId: z.string().min(1),
  invoiceId: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  invoiceAmountMinor: MinorAmountSchema,
  amountPaidMinor: MinorAmountSchema,
  creditedAmountMinor: MinorAmountSchema,
  balanceDueMinor: MinorAmountSchema,
  creditedLineQuantities: z.record(z.string().min(1), z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)),
  status: z.enum(["OPEN", "PARTIALLY_SETTLED", "SETTLED"]),
  paymentCount: z.number().int().min(0),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

const SalesPaymentItemSchema = z.object({
  PK: z.string().min(1),
  SK: z.string().startsWith("SALES_PAYMENT#"),
  entityType: z.literal("SALES_PAYMENT"),
  orgId: z.string().min(1),
  id: z.string().min(1),
  invoiceId: z.string().min(1),
  amountMinor: MinorAmountSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "MOBILE_MONEY", "CHEQUE", "OTHER"]),
  reference: z.string().min(1).max(200).optional(),
  recordedByUserId: z.string().min(1),
  createdAt: z.string().datetime(),
}).strict();

const SalesPaymentIdempotencyItemSchema = z.object({
  PK: z.string().min(1),
  SK: z.string().startsWith("SALES_PAYMENT_IDEMPOTENCY#"),
  entityType: z.literal("SALES_PAYMENT_IDEMPOTENCY"),
  orgId: z.string().min(1),
  clientRequestId: z.string().uuid(),
  invoiceId: z.string().min(1),
  paymentId: z.string().min(1),
  originalExpectedVersion: z.number().int().min(0),
  amount: z.string().min(1),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "MOBILE_MONEY", "CHEQUE", "OTHER"]),
  reference: z.string().min(1).max(200).optional(),
  createdAt: z.string().datetime(),
}).strict();

type SalesReceivableItem = z.infer<typeof SalesReceivableItemSchema>;
export type SalesReceivableState = {
  receivable: SalesInvoiceReceivable;
  creditedLineQuantities: Record<string, string>;
};
type SalesPaymentItem = z.infer<typeof SalesPaymentItemSchema>;
export type SalesPaymentIdempotencyRecord = z.infer<typeof SalesPaymentIdempotencyItemSchema>;

export type SalesPaymentTransactionFailure =
  | "INVOICE_CONFLICT"
  | "RECEIVABLE_CONFLICT"
  | "PAYMENT_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "UNKNOWN_TRANSACTION_CANCELLATION";

export class SalesPaymentTransactionError extends Error {
  constructor(public readonly failure: SalesPaymentTransactionFailure) {
    super(`Sales Payment transaction failed: ${failure}`);
    this.name = "SalesPaymentTransactionError";
  }
}

const toReceivable = (item: SalesReceivableItem): SalesInvoiceReceivable =>
  SalesInvoiceReceivableSchema.parse({
    invoiceId: item.invoiceId,
    currency: item.currency,
    invoiceAmount: SalesInvoiceCalculator.fromMinorUnits(item.currency, item.invoiceAmountMinor),
    amountPaid: SalesInvoiceCalculator.fromMinorUnits(item.currency, item.amountPaidMinor),
    creditedAmount: SalesInvoiceCalculator.fromMinorUnits(item.currency, item.creditedAmountMinor),
    balanceDue: SalesInvoiceCalculator.fromMinorUnits(item.currency, item.balanceDueMinor),
    status: item.status,
    paymentCount: item.paymentCount,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });

const toPayment = (item: SalesPaymentItem): SalesPayment =>
  SalesPaymentSchema.parse({
    id: item.id,
    invoiceId: item.invoiceId,
    amount: SalesInvoiceCalculator.fromMinorUnits(item.currency, item.amountMinor),
    currency: item.currency,
    paymentDate: item.paymentDate,
    method: item.method,
    reference: item.reference,
    createdAt: item.createdAt,
  });

export const buildSalesReceivableItem = (
  orgId: string,
  value: SalesInvoiceReceivable,
  creditedLineQuantities: Record<string, string>,
): SalesReceivableItem =>
  SalesReceivableItemSchema.parse({
    PK: KeyFactory.orgKey(orgId),
    SK: KeyFactory.salesReceivableSK(value.invoiceId),
    entityType: "SALES_RECEIVABLE",
    orgId,
    invoiceId: value.invoiceId,
    currency: value.currency,
    invoiceAmountMinor: SalesInvoiceCalculator.toMinorUnits(value.currency, value.invoiceAmount),
    amountPaidMinor: SalesInvoiceCalculator.toMinorUnits(value.currency, value.amountPaid),
    creditedAmountMinor: SalesInvoiceCalculator.toMinorUnits(value.currency, value.creditedAmount),
    balanceDueMinor: SalesInvoiceCalculator.toMinorUnits(value.currency, value.balanceDue),
    creditedLineQuantities,
    status: value.status,
    paymentCount: value.paymentCount,
    version: value.version,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });

const buildPaymentItem = (
  orgId: string,
  value: SalesPayment,
  recordedByUserId: string,
): SalesPaymentItem => SalesPaymentItemSchema.parse({
  PK: KeyFactory.orgKey(orgId),
  SK: KeyFactory.salesPaymentSK(value.invoiceId, value.id),
  entityType: "SALES_PAYMENT",
  orgId,
  id: value.id,
  invoiceId: value.invoiceId,
  amountMinor: SalesInvoiceCalculator.toMinorUnits(value.currency, value.amount),
  currency: value.currency,
  paymentDate: value.paymentDate,
  method: value.method,
  reference: value.reference,
  recordedByUserId,
  createdAt: value.createdAt,
});

const decodeCursor = (
  cursor: string | undefined,
  orgId: string,
  invoiceId: string,
): Record<string, AttributeValue> | undefined => {
  if (!cursor) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      throw new Error("Invalid cursor payload");
    }
    const key = unmarshall(decoded);
    if (
      key.PK !== KeyFactory.orgKey(orgId) ||
      typeof key.SK !== "string" ||
      !key.SK.startsWith(KeyFactory.salesPaymentPrefix(invoiceId))
    ) {
      throw new Error("Cursor is outside the Payment collection");
    }
    return decoded;
  } catch {
    throw new AppError(400, "ERROR_INVALID_CURSOR");
  }
};

const encodeCursor = (key: Record<string, unknown> | undefined): string | undefined =>
  key ? Buffer.from(JSON.stringify(key)).toString("base64") : undefined;

export class SalesPaymentRepository {
  static async getReceivable(
    orgId: string,
    invoiceId: string,
  ): Promise<SalesInvoiceReceivable | undefined> {
    return (await this.getReceivableState(orgId, invoiceId))?.receivable;
  }

  static async getReceivableState(
    orgId: string,
    invoiceId: string,
  ): Promise<SalesReceivableState | undefined> {
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: config.TABLE_NAME,
      Key: marshall({
        PK: KeyFactory.orgKey(orgId),
        SK: KeyFactory.salesReceivableSK(invoiceId),
      }),
      ConsistentRead: true,
    }));
    if (!result.Item) return undefined;
    const item = SalesReceivableItemSchema.parse(unmarshall(result.Item));
    if (item.orgId !== orgId || item.invoiceId !== invoiceId) return undefined;
    return { receivable: toReceivable(item), creditedLineQuantities: item.creditedLineQuantities };
  }

  static async getPayment(
    orgId: string,
    invoiceId: string,
    paymentId: string,
  ): Promise<SalesPayment | undefined> {
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: config.TABLE_NAME,
      Key: marshall({
        PK: KeyFactory.orgKey(orgId),
        SK: KeyFactory.salesPaymentSK(invoiceId, paymentId),
      }),
      ConsistentRead: true,
    }));
    if (!result.Item) return undefined;
    const item = SalesPaymentItemSchema.parse(unmarshall(result.Item));
    if (item.orgId !== orgId || item.invoiceId !== invoiceId || item.id !== paymentId) return undefined;
    return toPayment(item);
  }

  static async getIdempotency(
    orgId: string,
    clientRequestId: string,
  ): Promise<SalesPaymentIdempotencyRecord | undefined> {
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: config.TABLE_NAME,
      Key: marshall({
        PK: KeyFactory.orgKey(orgId),
        SK: KeyFactory.salesPaymentIdempotencySK(clientRequestId),
      }),
      ConsistentRead: true,
    }));
    if (!result.Item) return undefined;
    const item = SalesPaymentIdempotencyItemSchema.parse(unmarshall(result.Item));
    if (item.orgId !== orgId || item.clientRequestId !== clientRequestId) {
      throw new Error("SALES Payment idempotency tenant mismatch");
    }
    return item;
  }

  static async list(
    orgId: string,
    invoiceId: string,
    input: { limit?: number; cursor?: string },
  ): Promise<SalesPaymentListResponse> {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: config.TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: marshall({
        ":pk": KeyFactory.orgKey(orgId),
        ":prefix": KeyFactory.salesPaymentPrefix(invoiceId),
      }),
      Limit: input.limit ?? 50,
      ExclusiveStartKey: decodeCursor(input.cursor, orgId, invoiceId),
      ScanIndexForward: true,
    }));
    return {
      items: (result.Items ?? [])
        .map((raw) => SalesPaymentItemSchema.parse(unmarshall(raw)))
        .filter((item) =>
          item.orgId === orgId &&
          item.invoiceId === invoiceId &&
          item.SK === KeyFactory.salesPaymentSK(invoiceId, item.id),
        )
        .map(toPayment),
      nextCursor: encodeCursor(result.LastEvaluatedKey),
    };
  }

  static async recordAtomically(input: {
    orgId: string;
    payment: SalesPayment;
    receivable: SalesInvoiceReceivable;
    recordedByUserId: string;
    clientRequestId: string;
    originalExpectedVersion: number;
    previousReceivableVersion: number;
    creditedLineQuantities?: Record<string, string>;
  }): Promise<void> {
    const receivable = buildSalesReceivableItem(
      input.orgId,
      input.receivable,
      input.creditedLineQuantities ?? {},
    );
    const payment = buildPaymentItem(input.orgId, input.payment, input.recordedByUserId);
    const idempotency = SalesPaymentIdempotencyItemSchema.parse({
      PK: KeyFactory.orgKey(input.orgId),
      SK: KeyFactory.salesPaymentIdempotencySK(input.clientRequestId),
      entityType: "SALES_PAYMENT_IDEMPOTENCY",
      orgId: input.orgId,
      clientRequestId: input.clientRequestId,
      invoiceId: input.payment.invoiceId,
      paymentId: input.payment.id,
      originalExpectedVersion: input.originalExpectedVersion,
      amount: input.payment.amount,
      paymentDate: input.payment.paymentDate,
      method: input.payment.method,
      reference: input.payment.reference,
      createdAt: input.payment.createdAt,
    });

    try {
      await dynamoClient.send(new TransactWriteItemsCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: config.TABLE_NAME,
              Key: marshall({
                PK: KeyFactory.orgKey(input.orgId),
                SK: KeyFactory.salesInvoiceSK(input.payment.invoiceId),
              }),
              ConditionExpression: "#entityType = :invoiceType AND #status = :issued",
              ExpressionAttributeNames: { "#entityType": "entityType", "#status": "status" },
              ExpressionAttributeValues: marshall({
                ":invoiceType": "SALES_INVOICE",
                ":issued": "ISSUED",
              }),
            },
          },
          {
            Put: {
              TableName: config.TABLE_NAME,
              Item: marshall(receivable),
              ConditionExpression: input.previousReceivableVersion === 0
                ? "attribute_not_exists(PK) AND attribute_not_exists(SK)"
                : "#entityType = :receivableType AND #version = :expectedVersion",
              ...(input.previousReceivableVersion === 0 ? {} : {
                ExpressionAttributeNames: { "#entityType": "entityType", "#version": "version" },
                ExpressionAttributeValues: marshall({
                  ":receivableType": "SALES_RECEIVABLE",
                  ":expectedVersion": input.previousReceivableVersion,
                }),
              }),
            },
          },
          {
            Put: {
              TableName: config.TABLE_NAME,
              Item: marshall(payment, { removeUndefinedValues: true }),
              ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            },
          },
          {
            Put: {
              TableName: config.TABLE_NAME,
              Item: marshall(idempotency, { removeUndefinedValues: true }),
              ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            },
          },
        ],
      }));
    } catch (error) {
      const transactionError = error as {
        name?: string;
        CancellationReasons?: Array<{ Code?: string }>;
      };
      if (transactionError.name !== "TransactionCanceledException") throw error;
      const failedIndex = transactionError.CancellationReasons?.findIndex(
        (reason) => reason.Code === "ConditionalCheckFailed",
      );
      const failures: SalesPaymentTransactionFailure[] = [
        "INVOICE_CONFLICT",
        "RECEIVABLE_CONFLICT",
        "PAYMENT_CONFLICT",
        "IDEMPOTENCY_CONFLICT",
      ];
      throw new SalesPaymentTransactionError(
        failedIndex === undefined || failedIndex < 0
          ? "UNKNOWN_TRANSACTION_CANCELLATION"
          : failures[failedIndex] ?? "UNKNOWN_TRANSACTION_CANCELLATION",
      );
    }
  }
}
