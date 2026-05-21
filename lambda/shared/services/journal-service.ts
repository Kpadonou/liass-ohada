import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/middleware/handler-wrapper";
import { Journal, JournalSchema } from "@/models/core-ledger/journal";
import {
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";

export const CreateJournalInputSchema = JournalSchema.omit({
  orgId: true,
  entityType: true,
  PK: true,
  SK: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateJournalInputSchema = z.object({
  journalCode: z.string().min(1),
  year: z.number().int().optional(),
  journalName: z.string().min(1),
  type: JournalSchema.shape.type,
});

export const JournalEntriesRequestSchema = z.object({
  year: z.string().regex(/^\d{4}$/),
  journalCode: z.string().optional(),
  month: z
    .string()
    .regex(/^\d{2}$/)
    .optional(),
});

export type CreateJournalInput = z.infer<typeof CreateJournalInputSchema>;
export type UpdateJournalInput = z.infer<typeof UpdateJournalInputSchema>;
export type JournalEntriesRequest = z.infer<typeof JournalEntriesRequestSchema>;

export class JournalService {
  static async createJournal(
    orgId: string,
    userId: string,
    input: CreateJournalInput,
  ) {
    const now = new Date().toISOString();
    const journal = JournalSchema.parse({
      ...input,
      orgId,
      journalCode: input.journalCode.toUpperCase(),
      entityType: "JOURNAL",
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.journalSK(input.journalCode.toUpperCase()),
      createdAt: now,
      updatedAt: now,
    });

    const item = {
      ...journal,
      createdBy: userId,
      updatedBy: userId,
    };

    try {
      await dynamoClient.send(
        new PutItemCommand({
          TableName: config.TABLE_NAME,
          Item: marshall(item, { removeUndefinedValues: true }),
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        }),
      );
    } catch (error: any) {
      if (error?.name === "ConditionalCheckFailedException") {
        throw new AppError(400, "ERROR_JOURNAL_ALREADY_EXISTS");
      }
      throw error;
    }

    return item;
  }

  static async listJournals(orgId: string): Promise<Journal[]> {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.orgKey(orgId),
          ":sk": "JNL#",
        }),
      }),
    );

    return (result.Items || []).map((item) =>
      JournalSchema.parse(unmarshall(item)),
    );
  }

  static async getJournal(
    orgId: string,
    journalCode: string,
  ): Promise<Journal> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.journalSK(journalCode.toUpperCase()),
        }),
      }),
    );

    if (!result.Item) {
      throw new AppError(404, "JOURNAL_NOT_FOUND");
    }

    return JournalSchema.parse(unmarshall(result.Item));
  }

  static async updateJournal(
    orgId: string,
    userId: string,
    input: UpdateJournalInput,
  ) {
    await JournalService.getJournal(orgId, input.journalCode);
    const now = new Date().toISOString();

    const result = await dynamoClient.send(
      new UpdateItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.journalSK(input.journalCode.toUpperCase()),
        }),
        ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
        UpdateExpression:
          "SET journalName = :name, #type = :type, updatedAt = :updatedAt, updatedBy = :updatedBy",
        ExpressionAttributeNames: {
          "#type": "type",
        },
        ExpressionAttributeValues: marshall({
          ":name": input.journalName,
          ":type": input.type,
          ":updatedAt": now,
          ":updatedBy": userId,
        }),
        ReturnValues: "ALL_NEW",
      }),
    );

    return result.Attributes ? unmarshall(result.Attributes) : undefined;
  }

  static async deleteJournal(orgId: string, journalCode: string) {
    const journal = await JournalService.getJournal(orgId, journalCode);
    const hasEntries = await JournalService.hasPostedEntries(
      orgId,
      journal.year,
      journalCode,
    );

    if (hasEntries) {
      throw new AppError(400, "ERROR_JOURNAL_HAS_ENTRIES");
    }

    await dynamoClient.send(
      new DeleteItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.journalSK(journalCode.toUpperCase()),
        }),
        ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
      }),
    );

    return {};
  }

  static async getJournalEntries(orgId: string, input: JournalEntriesRequest) {
    const { year, journalCode, month } = input;
    const pk = KeyFactory.gsi5JournalPK(orgId, year);

    let skFilter = "";
    if (journalCode) {
      skFilter = `JNL#${journalCode.toUpperCase()}`;
      if (month) {
        skFilter += `#DT#${year}-${month}`;
      }
    }

    const queryParams: any = {
      TableName: config.TABLE_NAME,
      IndexName: config.GSI5,
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: { "#pk": "GSI5PK" },
      ExpressionAttributeValues: marshall({ ":pk": pk }),
      ScanIndexForward: true,
    };

    if (skFilter) {
      queryParams.KeyConditionExpression += " AND begins_with(#sk, :sk)";
      queryParams.ExpressionAttributeNames["#sk"] = "GSI5SK";
      queryParams.ExpressionAttributeValues[":sk"] = skFilter;
    }

    const result = await dynamoClient.send(new QueryCommand(queryParams));

    return (result.Items || []).map((item) => {
      const entry = unmarshall(item);
      return {
        entryId: entry.entryId,
        date: entry.entryDate,
        label: entry.label,
        journal: entry.journalCode,
        reference: entry.voucherNumber,
        amount: entry.totalDebit,
        status: entry.status,
      };
    });
  }

  private static async hasPostedEntries(
    orgId: string,
    year: number | string,
    journalCode: string,
  ) {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI5,
        KeyConditionExpression: "GSI5PK = :pk AND begins_with(GSI5SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.gsi5JournalPK(orgId, year),
          ":sk": `JNL#${journalCode.toUpperCase()}`,
        }),
        Limit: 1,
      }),
    );

    return (result.Items || []).length > 0;
  }
}
