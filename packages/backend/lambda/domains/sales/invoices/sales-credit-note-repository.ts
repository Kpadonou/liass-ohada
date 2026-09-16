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
  SalesCreditNote,
  SalesCreditNoteLineSchema,
  SalesCreditNoteListResponse,
  SalesCreditNoteSchema,
  SalesCreditNoteSummarySchema,
  SalesInvoiceCustomerSnapshotSchema,
  SalesInvoiceReceivable,
  SalesIssuedCreditNote,
} from "@liass-ohada/shared/sales";
import { z } from "zod";
import { AppError } from "@/lambda/shared/app-error";
import { config, dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { SalesInvoiceCalculator } from "./sales-invoice-calculator";
import { buildSalesReceivableItem } from "./sales-payment-repository";

const MinorAmountSchema = z.string().regex(/^\d+$/);
const LineItemSchema = SalesCreditNoteLineSchema.omit({
  subtotal: true, taxAmount: true, total: true,
}).extend({
  subtotalMinor: MinorAmountSchema,
  taxAmountMinor: MinorAmountSchema,
  totalMinor: MinorAmountSchema,
}).strict();
const BaseItemSchema = z.object({
  PK: z.string().min(1),
  SK: z.string().startsWith("SALES_CREDIT_NOTE#"),
  entityType: z.literal("SALES_CREDIT_NOTE"),
  orgId: z.string().min(1),
  id: z.string().min(1),
  originalInvoiceId: z.string().min(1),
  originalInvoiceNumber: z.string().regex(/^0*[1-9]\d*$/),
  customerSnapshot: SalesInvoiceCustomerSnapshotSchema.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  reason: z.string().min(1).max(1000).optional(),
  lines: z.array(LineItemSchema).max(100),
  subtotalMinor: MinorAmountSchema,
  taxTotalMinor: MinorAmountSchema,
  totalMinor: MinorAmountSchema,
  lineCount: z.number().int().min(0).max(100),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
const DraftItemSchema = BaseItemSchema.extend({ status: z.literal("DRAFT") }).strict();
const IssuedItemSchema = BaseItemSchema.extend({
  status: z.literal("ISSUED"),
  creditNoteNumber: z.string().regex(/^0*[1-9]\d*$/),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  issuedAt: z.string().datetime(),
  issuedByUserId: z.string().min(1),
}).strict();
const ItemSchema = z.union([DraftItemSchema, IssuedItemSchema]);
type Item = z.infer<typeof ItemSchema>;

const SequenceSchema = z.object({
  PK: z.string().min(1), SK: z.literal("SALES_CREDIT_NOTE_SEQUENCE#DEFAULT"),
  entityType: z.literal("SALES_CREDIT_NOTE_SEQUENCE"), orgId: z.string().min(1),
  lastValue: z.string().regex(/^(?:0|[1-9]\d*)$/), updatedAt: z.string().datetime(),
}).strict();
const IdempotencySchema = z.object({
  PK: z.string().min(1), SK: z.string().startsWith("SALES_CREDIT_NOTE_ISSUE_IDEMPOTENCY#"),
  entityType: z.literal("SALES_CREDIT_NOTE_ISSUE_IDEMPOTENCY"), orgId: z.string().min(1),
  clientRequestId: z.string().uuid(), invoiceId: z.string().min(1), creditNoteId: z.string().min(1),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  originalExpectedCreditNoteVersion: z.number().int().positive(),
  originalExpectedReceivableVersion: z.number().int().min(0),
  creditNoteNumber: z.string().regex(/^0*[1-9]\d*$/), createdAt: z.string().datetime(),
}).strict();
export type SalesCreditNoteIssueIdempotencyRecord = z.infer<typeof IdempotencySchema>;

export class SalesCreditNoteWriteConflictError extends Error {}
export type SalesCreditNoteIssueFailure = "INVOICE_CONFLICT" | "SEQUENCE_CONTENTION" |
  "CREDIT_NOTE_CONFLICT" | "RECEIVABLE_CONFLICT" | "IDEMPOTENCY_CONFLICT" |
  "UNKNOWN_TRANSACTION_CANCELLATION";
export class SalesCreditNoteIssueTransactionError extends Error {
  constructor(public readonly failure: SalesCreditNoteIssueFailure) {
    super(`Sales Credit Note issue transaction failed: ${failure}`);
  }
}

const toItem = (orgId: string, note: SalesCreditNote, issuedByUserId?: string): Item =>
  ItemSchema.parse({
    PK: KeyFactory.orgKey(orgId), SK: KeyFactory.salesCreditNoteSK(note.originalInvoiceId, note.id),
    entityType: "SALES_CREDIT_NOTE", orgId, id: note.id,
    originalInvoiceId: note.originalInvoiceId, originalInvoiceNumber: note.originalInvoiceNumber,
    customerSnapshot: note.customerSnapshot, currency: note.currency, reason: note.reason,
    lines: note.lines.map(({ subtotal, taxAmount, total, ...line }) => ({
      ...line,
      subtotalMinor: SalesInvoiceCalculator.toMinorUnits(note.currency, subtotal),
      taxAmountMinor: SalesInvoiceCalculator.toMinorUnits(note.currency, taxAmount),
      totalMinor: SalesInvoiceCalculator.toMinorUnits(note.currency, total),
    })),
    subtotalMinor: SalesInvoiceCalculator.toMinorUnits(note.currency, note.subtotal),
    taxTotalMinor: SalesInvoiceCalculator.toMinorUnits(note.currency, note.taxTotal),
    totalMinor: SalesInvoiceCalculator.toMinorUnits(note.currency, note.total),
    lineCount: note.lineCount, version: note.version, createdAt: note.createdAt, updatedAt: note.updatedAt,
    ...(note.status === "ISSUED" ? {
      status: "ISSUED", creditNoteNumber: note.creditNoteNumber, issueDate: note.issueDate,
      issuedAt: note.issuedAt, issuedByUserId,
    } : { status: "DRAFT" }),
  });

const toNote = (item: Item): SalesCreditNote => SalesCreditNoteSchema.parse({
  id: item.id, originalInvoiceId: item.originalInvoiceId,
  originalInvoiceNumber: item.originalInvoiceNumber, status: item.status,
  customerSnapshot: item.customerSnapshot, currency: item.currency, reason: item.reason,
  lines: item.lines.map(({ subtotalMinor, taxAmountMinor, totalMinor, ...line }) => ({
    ...line,
    subtotal: SalesInvoiceCalculator.fromMinorUnits(item.currency, subtotalMinor),
    taxAmount: SalesInvoiceCalculator.fromMinorUnits(item.currency, taxAmountMinor),
    total: SalesInvoiceCalculator.fromMinorUnits(item.currency, totalMinor),
  })),
  subtotal: SalesInvoiceCalculator.fromMinorUnits(item.currency, item.subtotalMinor),
  taxTotal: SalesInvoiceCalculator.fromMinorUnits(item.currency, item.taxTotalMinor),
  total: SalesInvoiceCalculator.fromMinorUnits(item.currency, item.totalMinor),
  lineCount: item.lineCount, version: item.version, createdAt: item.createdAt, updatedAt: item.updatedAt,
  ...(item.status === "ISSUED" ? {
    creditNoteNumber: item.creditNoteNumber, issueDate: item.issueDate, issuedAt: item.issuedAt,
  } : {}),
});

const decodeCursor = (cursor: string | undefined, orgId: string, invoiceId: string) => {
  if (!cursor) return undefined;
  try {
    const raw = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
    const key = unmarshall(raw);
    if (key.PK !== KeyFactory.orgKey(orgId) || typeof key.SK !== "string" ||
      !key.SK.startsWith(KeyFactory.salesCreditNotePrefix(invoiceId))) throw new Error();
    return raw as Record<string, AttributeValue>;
  } catch { throw new AppError(400, "ERROR_INVALID_CURSOR"); }
};

export class SalesCreditNoteRepository {
  static buildItem = toItem;

  static async create(orgId: string, note: SalesCreditNote): Promise<void> {
    await this.put(orgId, note, "attribute_not_exists(PK) AND attribute_not_exists(SK)");
  }

  static async update(orgId: string, note: SalesCreditNote, expectedVersion: number): Promise<void> {
    await this.put(orgId, note, "#entityType = :type AND #status = :draft AND #version = :version", {
      "#entityType": "entityType", "#status": "status", "#version": "version",
    }, marshall({ ":type": "SALES_CREDIT_NOTE", ":draft": "DRAFT", ":version": expectedVersion }));
  }

  static async get(orgId: string, invoiceId: string, creditNoteId: string): Promise<SalesCreditNote | undefined> {
    const result = await dynamoClient.send(new GetItemCommand({ TableName: config.TABLE_NAME,
      Key: marshall({ PK: KeyFactory.orgKey(orgId), SK: KeyFactory.salesCreditNoteSK(invoiceId, creditNoteId) }),
      ConsistentRead: true }));
    if (!result.Item) return undefined;
    const item = ItemSchema.parse(unmarshall(result.Item));
    return item.orgId === orgId && item.originalInvoiceId === invoiceId && item.id === creditNoteId
      ? toNote(item) : undefined;
  }

  static async list(orgId: string, invoiceId: string, input: { limit?: number; cursor?: string }): Promise<SalesCreditNoteListResponse> {
    const result = await dynamoClient.send(new QueryCommand({ TableName: config.TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: marshall({ ":pk": KeyFactory.orgKey(orgId), ":prefix": KeyFactory.salesCreditNotePrefix(invoiceId) }),
      Limit: input.limit ?? 50, ExclusiveStartKey: decodeCursor(input.cursor, orgId, invoiceId), ScanIndexForward: true }));
    return { items: (result.Items ?? []).map((raw) => ItemSchema.parse(unmarshall(raw)))
      .filter((item) => item.orgId === orgId && item.originalInvoiceId === invoiceId)
      .map((item) => {
        const { lines: _lines, ...summary } = toNote(item);
        return SalesCreditNoteSummarySchema.parse(summary);
      }), nextCursor: result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64") : undefined };
  }

  static async getSequence(orgId: string): Promise<{ exists: boolean; lastValue: string }> {
    const result = await dynamoClient.send(new GetItemCommand({ TableName: config.TABLE_NAME,
      Key: marshall({ PK: KeyFactory.orgKey(orgId), SK: KeyFactory.salesCreditNoteSequenceSK() }), ConsistentRead: true }));
    if (!result.Item) return { exists: false, lastValue: "0" };
    const item = SequenceSchema.parse(unmarshall(result.Item));
    if (item.orgId !== orgId) throw new Error("Credit Note sequence tenant mismatch");
    return { exists: true, lastValue: item.lastValue };
  }

  static async getIssueIdempotency(orgId: string, clientRequestId: string) {
    const result = await dynamoClient.send(new GetItemCommand({ TableName: config.TABLE_NAME,
      Key: marshall({ PK: KeyFactory.orgKey(orgId), SK: KeyFactory.salesCreditNoteIssueIdempotencySK(clientRequestId) }),
      ConsistentRead: true }));
    if (!result.Item) return undefined;
    const item = IdempotencySchema.parse(unmarshall(result.Item));
    if (item.orgId !== orgId) throw new Error("Credit Note idempotency tenant mismatch");
    return item;
  }

  static async issueAtomically(input: {
    orgId: string; invoiceId: string; creditNote: SalesIssuedCreditNote; issuedByUserId: string;
    receivable: SalesInvoiceReceivable; creditedLineQuantities: Record<string, string>;
    clientRequestId: string; originalExpectedCreditNoteVersion: number;
    originalExpectedReceivableVersion: number; previousSequenceExists: boolean;
    previousSequenceValue: string; nextSequenceValue: string;
  }): Promise<void> {
    const sequence = SequenceSchema.parse({ PK: KeyFactory.orgKey(input.orgId), SK: KeyFactory.salesCreditNoteSequenceSK(),
      entityType: "SALES_CREDIT_NOTE_SEQUENCE", orgId: input.orgId, lastValue: input.nextSequenceValue,
      updatedAt: input.creditNote.issuedAt });
    const idempotency = IdempotencySchema.parse({ PK: KeyFactory.orgKey(input.orgId),
      SK: KeyFactory.salesCreditNoteIssueIdempotencySK(input.clientRequestId), entityType: "SALES_CREDIT_NOTE_ISSUE_IDEMPOTENCY",
      orgId: input.orgId, clientRequestId: input.clientRequestId, invoiceId: input.invoiceId,
      creditNoteId: input.creditNote.id, issueDate: input.creditNote.issueDate,
      originalExpectedCreditNoteVersion: input.originalExpectedCreditNoteVersion,
      originalExpectedReceivableVersion: input.originalExpectedReceivableVersion,
      creditNoteNumber: input.creditNote.creditNoteNumber, createdAt: input.creditNote.issuedAt });
    const receivable = buildSalesReceivableItem(input.orgId, input.receivable, input.creditedLineQuantities);
    try {
      await dynamoClient.send(new TransactWriteItemsCommand({ TransactItems: [
        { ConditionCheck: { TableName: config.TABLE_NAME,
          Key: marshall({ PK: KeyFactory.orgKey(input.orgId), SK: KeyFactory.salesInvoiceSK(input.invoiceId) }),
          ConditionExpression: "#entityType = :invoiceType AND #status = :issued",
          ExpressionAttributeNames: { "#entityType": "entityType", "#status": "status" },
          ExpressionAttributeValues: marshall({ ":invoiceType": "SALES_INVOICE", ":issued": "ISSUED" }) } },
        { Put: { TableName: config.TABLE_NAME, Item: marshall(sequence),
          ConditionExpression: input.previousSequenceExists
            ? "#entityType = :type AND lastValue = :previous" : "attribute_not_exists(PK) AND attribute_not_exists(SK)",
          ...(input.previousSequenceExists ? { ExpressionAttributeNames: { "#entityType": "entityType" },
            ExpressionAttributeValues: marshall({ ":type": "SALES_CREDIT_NOTE_SEQUENCE", ":previous": input.previousSequenceValue }) } : {}) } },
        { Put: { TableName: config.TABLE_NAME,
          Item: marshall(toItem(input.orgId, input.creditNote, input.issuedByUserId), { removeUndefinedValues: true }),
          ConditionExpression: "#entityType = :type AND #status = :draft AND #version = :version",
          ExpressionAttributeNames: { "#entityType": "entityType", "#status": "status", "#version": "version" },
          ExpressionAttributeValues: marshall({ ":type": "SALES_CREDIT_NOTE", ":draft": "DRAFT", ":version": input.originalExpectedCreditNoteVersion }) } },
        { Put: { TableName: config.TABLE_NAME, Item: marshall(receivable),
          ConditionExpression: input.originalExpectedReceivableVersion === 0
            ? "attribute_not_exists(PK) AND attribute_not_exists(SK)"
            : "#entityType = :type AND #version = :version",
          ...(input.originalExpectedReceivableVersion === 0 ? {} : {
            ExpressionAttributeNames: { "#entityType": "entityType", "#version": "version" },
            ExpressionAttributeValues: marshall({ ":type": "SALES_RECEIVABLE", ":version": input.originalExpectedReceivableVersion }) }) } },
        { Put: { TableName: config.TABLE_NAME, Item: marshall(idempotency),
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
      ] }));
    } catch (error) {
      const transaction = error as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
      if (transaction.name !== "TransactionCanceledException") throw error;
      const index = transaction.CancellationReasons?.findIndex((reason) => reason.Code === "ConditionalCheckFailed");
      const failures: SalesCreditNoteIssueFailure[] = ["INVOICE_CONFLICT", "SEQUENCE_CONTENTION", "CREDIT_NOTE_CONFLICT", "RECEIVABLE_CONFLICT", "IDEMPOTENCY_CONFLICT"];
      throw new SalesCreditNoteIssueTransactionError(index === undefined || index < 0
        ? "UNKNOWN_TRANSACTION_CANCELLATION" : failures[index] ?? "UNKNOWN_TRANSACTION_CANCELLATION");
    }
  }

  private static async put(orgId: string, note: SalesCreditNote, condition: string,
    names?: Record<string, string>, values?: Record<string, AttributeValue>) {
    try { await dynamoClient.send(new PutItemCommand({ TableName: config.TABLE_NAME,
      Item: marshall(toItem(orgId, note), { removeUndefinedValues: true }), ConditionExpression: condition,
      ExpressionAttributeNames: names, ExpressionAttributeValues: values })); }
    catch (error) {
      if (error instanceof ConditionalCheckFailedException || (error as { name?: string }).name === "ConditionalCheckFailedException")
        throw new SalesCreditNoteWriteConflictError();
      throw error;
    }
  }
}
