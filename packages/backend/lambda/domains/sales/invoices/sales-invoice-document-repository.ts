import {
  ConditionalCheckFailedException,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  SalesInvoiceDocument,
  SalesInvoiceDocumentSchema,
} from "@liass-ohada/shared/sales";
import { z } from "zod";
import { config, dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";

const SalesInvoiceDocumentItemSchema = z
  .object({
    PK: z.string().min(1),
    SK: z.string().startsWith("SALES_INVOICE_DOCUMENT#"),
    entityType: z.literal("SALES_INVOICE_DOCUMENT"),
    orgId: z.string().min(1),
    invoiceId: z.string().min(1),
    documentType: z.literal("INVOICE_PDF"),
    status: z.literal("AVAILABLE"),
    renderingVersion: z.string().regex(/^[1-9]\d*$/),
    objectKey: z.string().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    contentType: z.literal("application/pdf"),
    sizeBytes: z.number().int().positive(),
    generatedAt: z.string().datetime(),
    generatedByUserId: z.string().min(1),
    issuerName: z.string().trim().min(1).max(200),
  })
  .strict();

export type SalesInvoiceDocumentItem = z.infer<
  typeof SalesInvoiceDocumentItemSchema
>;

export class SalesInvoiceDocumentAlreadyExistsError extends Error {
  constructor() {
    super("Sales Invoice document metadata already exists");
    this.name = "SalesInvoiceDocumentAlreadyExistsError";
  }
}

const isConditionalFailure = (error: unknown): boolean =>
  error instanceof ConditionalCheckFailedException ||
  (error as { name?: string } | undefined)?.name ===
    "ConditionalCheckFailedException";

export class SalesInvoiceDocumentRepository {
  static buildItem(input: {
    orgId: string;
    document: SalesInvoiceDocument;
    objectKey: string;
    generatedByUserId: string;
    issuerName: string;
  }): SalesInvoiceDocumentItem {
    return SalesInvoiceDocumentItemSchema.parse({
      PK: KeyFactory.orgKey(input.orgId),
      SK: KeyFactory.salesInvoiceDocumentSK(input.document.invoiceId),
      entityType: "SALES_INVOICE_DOCUMENT",
      orgId: input.orgId,
      ...input.document,
      objectKey: input.objectKey,
      generatedByUserId: input.generatedByUserId,
      issuerName: input.issuerName,
    });
  }

  static async get(
    orgId: string,
    invoiceId: string,
  ): Promise<SalesInvoiceDocumentItem | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.salesInvoiceDocumentSK(invoiceId),
        }),
        ConsistentRead: true,
      }),
    );
    if (!result.Item) return undefined;
    const item = SalesInvoiceDocumentItemSchema.parse(unmarshall(result.Item));
    if (
      item.orgId !== orgId ||
      item.invoiceId !== invoiceId ||
      item.PK !== KeyFactory.orgKey(orgId) ||
      item.SK !== KeyFactory.salesInvoiceDocumentSK(invoiceId)
    ) {
      return undefined;
    }
    return item;
  }

  static async create(input: SalesInvoiceDocumentItem): Promise<void> {
    const item = SalesInvoiceDocumentItemSchema.parse(input);
    try {
      await dynamoClient.send(
        new PutItemCommand({
          TableName: config.TABLE_NAME,
          Item: marshall(item),
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        }),
      );
    } catch (error) {
      if (isConditionalFailure(error)) {
        throw new SalesInvoiceDocumentAlreadyExistsError();
      }
      throw error;
    }
  }

  static toPublic(item: SalesInvoiceDocumentItem): SalesInvoiceDocument {
    const {
      PK: _pk,
      SK: _sk,
      entityType: _entityType,
      orgId: _orgId,
      objectKey: _objectKey,
      generatedByUserId: _generatedByUserId,
      issuerName: _issuerName,
      ...document
    } = item;
    return SalesInvoiceDocumentSchema.parse(document);
  }
}
