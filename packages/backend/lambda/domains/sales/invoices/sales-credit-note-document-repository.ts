import {
  ConditionalCheckFailedException,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  SalesCreditNoteDocument,
  SalesCreditNoteDocumentSchema,
} from "@liass-ohada/shared/sales";
import { z } from "zod";
import { config, dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";

const SalesCreditNoteDocumentItemSchema = z
  .object({
    PK: z.string().min(1),
    SK: z.string().startsWith("SALES_CREDIT_NOTE_DOCUMENT#"),
    entityType: z.literal("SALES_CREDIT_NOTE_DOCUMENT"),
    orgId: z.string().min(1),
    invoiceId: z.string().min(1),
    creditNoteId: z.string().min(1),
    documentType: z.literal("CREDIT_NOTE_PDF"),
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

export type SalesCreditNoteDocumentItem = z.infer<
  typeof SalesCreditNoteDocumentItemSchema
>;

export class SalesCreditNoteDocumentAlreadyExistsError extends Error {
  constructor() {
    super("Sales Credit Note document metadata already exists");
    this.name = "SalesCreditNoteDocumentAlreadyExistsError";
  }
}

const isConditionalFailure = (error: unknown): boolean =>
  error instanceof ConditionalCheckFailedException ||
  (error as { name?: string } | undefined)?.name ===
    "ConditionalCheckFailedException";

export class SalesCreditNoteDocumentRepository {
  static buildItem(input: {
    orgId: string;
    invoiceId: string;
    document: SalesCreditNoteDocument;
    objectKey: string;
    generatedByUserId: string;
    issuerName: string;
  }): SalesCreditNoteDocumentItem {
    return SalesCreditNoteDocumentItemSchema.parse({
      PK: KeyFactory.orgKey(input.orgId),
      SK: KeyFactory.salesCreditNoteDocumentSK(
        input.invoiceId,
        input.document.creditNoteId,
      ),
      entityType: "SALES_CREDIT_NOTE_DOCUMENT",
      orgId: input.orgId,
      invoiceId: input.invoiceId,
      ...input.document,
      objectKey: input.objectKey,
      generatedByUserId: input.generatedByUserId,
      issuerName: input.issuerName,
    });
  }

  static async get(
    orgId: string,
    invoiceId: string,
    creditNoteId: string,
  ): Promise<SalesCreditNoteDocumentItem | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.salesCreditNoteDocumentSK(invoiceId, creditNoteId),
        }),
        ConsistentRead: true,
      }),
    );
    if (!result.Item) return undefined;
    const item = SalesCreditNoteDocumentItemSchema.parse(unmarshall(result.Item));
    if (
      item.orgId !== orgId ||
      item.invoiceId !== invoiceId ||
      item.creditNoteId !== creditNoteId ||
      item.PK !== KeyFactory.orgKey(orgId) ||
      item.SK !== KeyFactory.salesCreditNoteDocumentSK(invoiceId, creditNoteId)
    ) {
      return undefined;
    }
    return item;
  }

  static async create(input: SalesCreditNoteDocumentItem): Promise<void> {
    const item = SalesCreditNoteDocumentItemSchema.parse(input);
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
        throw new SalesCreditNoteDocumentAlreadyExistsError();
      }
      throw error;
    }
  }

  static toPublic(item: SalesCreditNoteDocumentItem): SalesCreditNoteDocument {
    const {
      PK: _pk,
      SK: _sk,
      entityType: _entityType,
      orgId: _orgId,
      invoiceId: _invoiceId,
      objectKey: _objectKey,
      generatedByUserId: _generatedByUserId,
      issuerName: _issuerName,
      ...document
    } = item;
    return SalesCreditNoteDocumentSchema.parse(document);
  }
}
