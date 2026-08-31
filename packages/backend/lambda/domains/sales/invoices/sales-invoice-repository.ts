import {
  AttributeValue,
  ConditionalCheckFailedException,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
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

const SalesInvoiceItemSchema = z
  .object({
    PK: z.string().min(1),
    SK: z.string().startsWith("SALES_INVOICE#"),
    entityType: z.literal("SALES_INVOICE"),
    orgId: z.string().min(1),
    id: z.string().min(1),
    status: z.literal("DRAFT"),
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

type SalesInvoiceItem = z.infer<typeof SalesInvoiceItemSchema>;

const SalesInvoiceSummaryItemSchema = SalesInvoiceItemSchema.omit({
  lines: true,
}).strict();

export class SalesInvoiceWriteConflictError extends Error {
  constructor() {
    super("Sales invoice conditional write failed");
    this.name = "SalesInvoiceWriteConflictError";
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
  static buildItem(orgId: string, invoice: SalesInvoice): SalesInvoiceItem {
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
          "PK, SK, entityType, orgId, id, #status, currency, customerId, customerSnapshot, subtotalMinor, taxTotalMinor, totalMinor, lineCount, #version, createdAt, updatedAt",
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
