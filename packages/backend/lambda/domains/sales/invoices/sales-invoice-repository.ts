import {
  AttributeValue,
  ConditionalCheckFailedException,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  SalesInvoice,
  SalesInvoiceCustomerSnapshotSchema,
  SalesInvoiceLineSchema,
  SalesInvoiceListResponse,
  SalesInvoiceSchema,
  SalesInvoiceSummary,
  SalesInvoiceSummarySchema,
  SalesIssuedInvoice,
} from "@liass-ohada/shared/sales";
import { z } from "zod";
import { AppError } from "@/lambda/shared/app-error";
import { config, dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { SalesInvoiceCalculator } from "./sales-invoice-calculator";

const MinorAmountSchema = z.string().regex(/^\d+$/);

const SalesInvoiceLinePersistenceSchema = SalesInvoiceLineSchema.omit({
  subtotal: true,
  taxAmount: true,
  total: true,
})
  .extend({
    subtotalMinor: MinorAmountSchema,
    taxAmountMinor: MinorAmountSchema,
    totalMinor: MinorAmountSchema,
  })
  .strict();

const SalesInvoiceItemBaseSchema = z
  .object({
    PK: z.string().min(1),
    SK: z.string().startsWith("SALES_INVOICE#"),
    entityType: z.literal("SALES_INVOICE"),
    orgId: z.string().min(1),
    id: z.string().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/),
    customerId: z.string().min(1).optional(),
    customerSnapshot: SalesInvoiceCustomerSnapshotSchema.optional(),
    lines: z.array(SalesInvoiceLinePersistenceSchema).max(100),
    subtotalMinor: MinorAmountSchema,
    taxTotalMinor: MinorAmountSchema,
    totalMinor: MinorAmountSchema,
    lineCount: z.number().int().min(0).max(100),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const SalesDraftInvoiceItemSchema = SalesInvoiceItemBaseSchema.extend({
  status: z.literal("DRAFT"),
}).strict();

const SalesIssuedInvoiceItemSchema = SalesInvoiceItemBaseSchema.extend({
  status: z.literal("ISSUED"),
  invoiceNumber: z.string().regex(/^0*[1-9]\d*$/),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  issuedAt: z.string().datetime(),
  issuedByUserId: z.string().min(1),
}).strict();

const SalesInvoiceItemSchema = z.union([
  SalesDraftInvoiceItemSchema,
  SalesIssuedInvoiceItemSchema,
]);

type SalesInvoiceItem = z.infer<typeof SalesInvoiceItemSchema>;

const SalesInvoiceSummaryItemSchema = z.union([
  SalesDraftInvoiceItemSchema.omit({ lines: true }).strict(),
  SalesIssuedInvoiceItemSchema.omit({ lines: true }).strict(),
]);

const SalesInvoiceSequenceItemSchema = z.object({
  PK: z.string().min(1),
  SK: z.literal("SALES_INVOICE_SEQUENCE#DEFAULT"),
  entityType: z.literal("SALES_INVOICE_SEQUENCE"),
  orgId: z.string().min(1),
  lastValue: z.string().regex(/^(?:0|[1-9]\d*)$/),
  updatedAt: z.string().datetime(),
}).strict();

const SalesInvoiceIssueIdempotencyItemSchema = z.object({
  PK: z.string().min(1),
  SK: z.string().startsWith("SALES_INVOICE_ISSUE_IDEMPOTENCY#"),
  entityType: z.literal("SALES_INVOICE_ISSUE_IDEMPOTENCY"),
  orgId: z.string().min(1),
  clientRequestId: z.string().uuid(),
  invoiceId: z.string().min(1),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  originalExpectedVersion: z.number().int().positive(),
  invoiceNumber: z.string().regex(/^0*[1-9]\d*$/),
  createdAt: z.string().datetime(),
}).strict();

export type SalesInvoiceIssueIdempotencyRecord = z.infer<
  typeof SalesInvoiceIssueIdempotencyItemSchema
>;

export class SalesInvoiceWriteConflictError extends Error {
  constructor() {
    super("Sales invoice conditional write failed");
    this.name = "SalesInvoiceWriteConflictError";
  }
}

export type SalesInvoiceIssueTransactionFailure =
  | "SEQUENCE_CONTENTION"
  | "INVOICE_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "UNKNOWN_TRANSACTION_CANCELLATION";

export class SalesInvoiceIssueTransactionError extends Error {
  constructor(public readonly failure: SalesInvoiceIssueTransactionFailure) {
    super(`Sales Invoice issue transaction failed: ${failure}`);
    this.name = "SalesInvoiceIssueTransactionError";
  }
}

const isConditionalFailure = (error: unknown): boolean =>
  error instanceof ConditionalCheckFailedException ||
  (error as { name?: string } | undefined)?.name ===
    "ConditionalCheckFailedException";

const toPersistenceLine = (
  currency: string,
  line: SalesInvoice["lines"][number],
) => {
  const { subtotal, taxAmount, total, ...attributes } = line;
  return {
    ...attributes,
    subtotalMinor: SalesInvoiceCalculator.toMinorUnits(currency, subtotal),
    taxAmountMinor: SalesInvoiceCalculator.toMinorUnits(currency, taxAmount),
    totalMinor: SalesInvoiceCalculator.toMinorUnits(currency, total),
  };
};

const toLine = (
  currency: string,
  line: z.infer<typeof SalesInvoiceLinePersistenceSchema>,
) => {
  const { subtotalMinor, taxAmountMinor, totalMinor, ...attributes } = line;
  return SalesInvoiceLineSchema.parse({
    ...attributes,
    subtotal: SalesInvoiceCalculator.fromMinorUnits(currency, subtotalMinor),
    taxAmount: SalesInvoiceCalculator.fromMinorUnits(currency, taxAmountMinor),
    total: SalesInvoiceCalculator.fromMinorUnits(currency, totalMinor),
  });
};

const toInvoice = (item: SalesInvoiceItem): SalesInvoice =>
  SalesInvoiceSchema.parse({
    id: item.id,
    status: item.status,
    currency: item.currency,
    customerId: item.customerId,
    customerSnapshot: item.customerSnapshot,
    lines: item.lines
      .map((line) => toLine(item.currency, line))
      .sort((left, right) => left.position - right.position),
    subtotal: SalesInvoiceCalculator.fromMinorUnits(
      item.currency,
      item.subtotalMinor,
    ),
    taxTotal: SalesInvoiceCalculator.fromMinorUnits(
      item.currency,
      item.taxTotalMinor,
    ),
    total: SalesInvoiceCalculator.fromMinorUnits(item.currency, item.totalMinor),
    lineCount: item.lineCount,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(item.status === "ISSUED" ? {
      invoiceNumber: item.invoiceNumber,
      issueDate: item.issueDate,
      issuedAt: item.issuedAt,
    } : {}),
  });

const toSummary = (
  item: z.infer<typeof SalesInvoiceSummaryItemSchema>,
): SalesInvoiceSummary =>
  SalesInvoiceSummarySchema.parse({
    id: item.id,
    status: item.status,
    currency: item.currency,
    customerId: item.customerId,
    customerName: item.customerSnapshot?.name,
    subtotal: SalesInvoiceCalculator.fromMinorUnits(
      item.currency,
      item.subtotalMinor,
    ),
    taxTotal: SalesInvoiceCalculator.fromMinorUnits(
      item.currency,
      item.taxTotalMinor,
    ),
    total: SalesInvoiceCalculator.fromMinorUnits(item.currency, item.totalMinor),
    lineCount: item.lineCount,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(item.status === "ISSUED" ? {
      invoiceNumber: item.invoiceNumber,
      issueDate: item.issueDate,
    } : {}),
  });

const decodeCursor = (
  cursor: string | undefined,
  orgId: string,
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
      !key.SK.startsWith(KeyFactory.salesInvoicePrefix())
    ) {
      throw new Error("Cursor is outside the invoice collection");
    }
    return decoded;
  } catch {
    throw new AppError(400, "ERROR_INVALID_CURSOR");
  }
};

const encodeCursor = (
  key: Record<string, unknown> | undefined,
): string | undefined =>
  key ? Buffer.from(JSON.stringify(key)).toString("base64") : undefined;

export class SalesInvoiceRepository {
  static buildItem(
    orgId: string,
    invoice: SalesInvoice,
    issuedByUserId?: string,
  ): SalesInvoiceItem {
    return SalesInvoiceItemSchema.parse({
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.salesInvoiceSK(invoice.id),
      entityType: "SALES_INVOICE",
      orgId,
      id: invoice.id,
      status: invoice.status,
      currency: invoice.currency,
      customerId: invoice.customerId,
      customerSnapshot: invoice.customerSnapshot,
      lines: invoice.lines.map((line) => toPersistenceLine(invoice.currency, line)),
      subtotalMinor: SalesInvoiceCalculator.toMinorUnits(
        invoice.currency,
        invoice.subtotal,
      ),
      taxTotalMinor: SalesInvoiceCalculator.toMinorUnits(
        invoice.currency,
        invoice.taxTotal,
      ),
      totalMinor: SalesInvoiceCalculator.toMinorUnits(
        invoice.currency,
        invoice.total,
      ),
      lineCount: invoice.lineCount,
      version: invoice.version,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
      ...(invoice.status === "ISSUED" ? {
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate,
        issuedAt: invoice.issuedAt,
        issuedByUserId,
      } : {}),
    });
  }

  static async create(orgId: string, invoice: SalesInvoice): Promise<void> {
    await this.put(this.buildItem(orgId, invoice),
      "attribute_not_exists(PK) AND attribute_not_exists(SK)");
  }

  static async get(
    orgId: string,
    invoiceId: string,
  ): Promise<SalesInvoice | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(orgId) },
          SK: { S: KeyFactory.salesInvoiceSK(invoiceId) },
        },
        ConsistentRead: true,
      }),
    );
    if (!result.Item) return undefined;
    const item = SalesInvoiceItemSchema.parse(unmarshall(result.Item));
    if (item.orgId !== orgId || item.id !== invoiceId) return undefined;
    return toInvoice(item);
  }

  static async list(
    orgId: string,
    input: { limit?: number; cursor?: string },
  ): Promise<SalesInvoiceListResponse> {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeNames: {
          "#status": "status",
          "#version": "version",
        },
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.orgKey(orgId),
          ":prefix": KeyFactory.salesInvoicePrefix(),
        }),
        ProjectionExpression:
          "PK, SK, entityType, orgId, id, #status, currency, customerId, customerSnapshot, subtotalMinor, taxTotalMinor, totalMinor, lineCount, #version, createdAt, updatedAt, invoiceNumber, issueDate, issuedAt, issuedByUserId",
        Limit: input.limit ?? 50,
        ExclusiveStartKey: decodeCursor(input.cursor, orgId),
        ScanIndexForward: true,
      }),
    );

    return {
      items: (result.Items ?? [])
        .map((raw) => SalesInvoiceSummaryItemSchema.parse(unmarshall(raw)))
        .filter(
          (item) =>
            item.orgId === orgId &&
            item.PK === KeyFactory.orgKey(orgId) &&
            item.SK === KeyFactory.salesInvoiceSK(item.id),
        )
        .map(toSummary),
      nextCursor: encodeCursor(result.LastEvaluatedKey),
    };
  }

  static async update(
    orgId: string,
    invoice: SalesInvoice,
    expectedVersion: number,
  ): Promise<void> {
    await this.put(
      this.buildItem(orgId, invoice),
      "#entityType = :entityType AND #version = :expectedVersion",
      {
        "#entityType": "entityType",
        "#version": "version",
      },
      {
        ":entityType": { S: "SALES_INVOICE" },
        ":expectedVersion": { N: String(expectedVersion) },
      },
    );
  }

  static async getSequence(
    orgId: string,
  ): Promise<{ exists: boolean; lastValue: string }> {
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: config.TABLE_NAME,
      Key: marshall({
        PK: KeyFactory.orgKey(orgId),
        SK: KeyFactory.salesInvoiceSequenceSK(),
      }),
      ConsistentRead: true,
    }));
    if (!result.Item) return { exists: false, lastValue: "0" };
    const item = SalesInvoiceSequenceItemSchema.parse(unmarshall(result.Item));
    if (item.orgId !== orgId) throw new Error("SALES Invoice sequence tenant mismatch");
    return { exists: true, lastValue: item.lastValue };
  }

  static async getIssueIdempotency(
    orgId: string,
    clientRequestId: string,
  ): Promise<SalesInvoiceIssueIdempotencyRecord | undefined> {
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: config.TABLE_NAME,
      Key: marshall({
        PK: KeyFactory.orgKey(orgId),
        SK: KeyFactory.salesInvoiceIssueIdempotencySK(clientRequestId),
      }),
      ConsistentRead: true,
    }));
    if (!result.Item) return undefined;
    const record = SalesInvoiceIssueIdempotencyItemSchema.parse(
      unmarshall(result.Item),
    );
    if (record.orgId !== orgId || record.clientRequestId !== clientRequestId) {
      throw new Error("SALES Invoice idempotency tenant mismatch");
    }
    return record;
  }

  static async issueAtomically(input: {
    orgId: string;
    invoice: SalesIssuedInvoice;
    issuedByUserId: string;
    clientRequestId: string;
    originalExpectedVersion: number;
    previousSequenceExists: boolean;
    previousSequenceValue: string;
    nextSequenceValue: string;
  }): Promise<void> {
    const sequence = SalesInvoiceSequenceItemSchema.parse({
      PK: KeyFactory.orgKey(input.orgId),
      SK: KeyFactory.salesInvoiceSequenceSK(),
      entityType: "SALES_INVOICE_SEQUENCE",
      orgId: input.orgId,
      lastValue: input.nextSequenceValue,
      updatedAt: input.invoice.issuedAt,
    });
    const idempotency = SalesInvoiceIssueIdempotencyItemSchema.parse({
      PK: KeyFactory.orgKey(input.orgId),
      SK: KeyFactory.salesInvoiceIssueIdempotencySK(input.clientRequestId),
      entityType: "SALES_INVOICE_ISSUE_IDEMPOTENCY",
      orgId: input.orgId,
      clientRequestId: input.clientRequestId,
      invoiceId: input.invoice.id,
      issueDate: input.invoice.issueDate,
      originalExpectedVersion: input.originalExpectedVersion,
      invoiceNumber: input.invoice.invoiceNumber,
      createdAt: input.invoice.issuedAt,
    });
    const sequenceCondition = !input.previousSequenceExists
      ? "attribute_not_exists(PK) AND attribute_not_exists(SK)"
      : "#entityType = :sequenceType AND lastValue = :previousValue";

    try {
      await dynamoClient.send(new TransactWriteItemsCommand({
        TransactItems: [
          { Put: {
            TableName: config.TABLE_NAME,
            Item: marshall(sequence),
            ConditionExpression: sequenceCondition,
            ...(!input.previousSequenceExists ? {} : {
              ExpressionAttributeNames: { "#entityType": "entityType" },
              ExpressionAttributeValues: marshall({
                ":sequenceType": "SALES_INVOICE_SEQUENCE",
                ":previousValue": input.previousSequenceValue,
              }),
            }),
          } },
          { Put: {
            TableName: config.TABLE_NAME,
            Item: marshall(
              this.buildItem(input.orgId, input.invoice, input.issuedByUserId),
              { removeUndefinedValues: true },
            ),
            ConditionExpression:
              "#entityType = :invoiceType AND #status = :draft AND #version = :expectedVersion",
            ExpressionAttributeNames: {
              "#entityType": "entityType",
              "#status": "status",
              "#version": "version",
            },
            ExpressionAttributeValues: marshall({
              ":invoiceType": "SALES_INVOICE",
              ":draft": "DRAFT",
              ":expectedVersion": input.originalExpectedVersion,
            }),
          } },
          { Put: {
            TableName: config.TABLE_NAME,
            Item: marshall(idempotency),
            ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
          } },
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
      const failure: SalesInvoiceIssueTransactionFailure = failedIndex === 0
        ? "SEQUENCE_CONTENTION"
        : failedIndex === 1
          ? "INVOICE_CONFLICT"
          : failedIndex === 2
            ? "IDEMPOTENCY_CONFLICT"
            : "UNKNOWN_TRANSACTION_CANCELLATION";
      throw new SalesInvoiceIssueTransactionError(failure);
    }
  }

  private static async put(
    item: SalesInvoiceItem,
    conditionExpression: string,
    expressionAttributeNames?: Record<string, string>,
    expressionAttributeValues?: Record<string, AttributeValue>,
  ): Promise<void> {
    try {
      await dynamoClient.send(
        new PutItemCommand({
          TableName: config.TABLE_NAME,
          Item: marshall(item, { removeUndefinedValues: true }),
          ConditionExpression: conditionExpression,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
        }),
      );
    } catch (error) {
      if (isConditionalFailure(error)) {
        throw new SalesInvoiceWriteConflictError();
      }
      throw error;
    }
  }
}
