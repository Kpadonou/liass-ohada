import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/middleware/handler-wrapper";
import {
  Journal,
  JournalBookLineDto,
  JournalBookLineDtoSchema,
  JournalSpecificBookQuery,
  JournalSpecificBookQuerySchema,
  JournalDto,
  JournalDtoSchema,
  JournalSchema,
} from "@liass-ohada/shared/accounting";
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

export type CreateJournalInput = z.infer<typeof CreateJournalInputSchema>;
export type UpdateJournalInput = z.infer<typeof UpdateJournalInputSchema>;

export class JournalService {
  static toDto(journal: Journal | Record<string, any>): JournalDto {
    return JournalDtoSchema.parse({
      orgId: journal.orgId,
      year: journal.year,
      journalCode: journal.journalCode,
      journalName: journal.journalName,
      type: journal.type,
      createdAt: journal.createdAt,
      updatedAt: journal.updatedAt,
    });
  }

  /**
   * Creates a journal definition in the tenant master-data partition.
   * The conditional put enforces journal-code uniqueness per organization/year
   * and stamps the creating user for auditability.
   */
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

    return JournalService.toDto(item);
  }

  /**
   * Lists all journals configured for an organization.
   * Uses the JNL# sort-key prefix so no journal data from another tenant can leak.
   */
  static async listJournals(orgId: string): Promise<JournalDto[]> {
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
      JournalService.toDto(JournalSchema.parse(unmarshall(item))),
    );
  }

  /**
   * Retrieves one tenant-scoped journal by business code.
   * Throws JOURNAL_NOT_FOUND instead of falling back to default or test tenants.
   */
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

  /**
   * Updates mutable journal metadata only after confirming the journal exists.
   * Preserves creation audit fields and records the updating user.
   */
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

    return result.Attributes
      ? JournalService.toDto(unmarshall(result.Attributes))
      : undefined;
  }

  /**
   * Deletes an unused journal definition.
   * Prevents deletion when posted entries exist in GSI5 for the journal, preserving
   * chronological audit-trail integrity.
   */
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

  /**
   * Reads posted entry headers for one journal from GSI5.
   * GSI5 is journal-first, so a journal code is mandatory for stable chronology.
   */
  static async getJournalEntries(orgId: string, input: JournalSpecificBookQuery) {
    const parsedInput = JournalSpecificBookQuerySchema.parse(input);
    const {
      year,
      journalCode,
      month,
      limit = 50,
      cursor,
    } = parsedInput;
    const pk = KeyFactory.gsi5JournalPK(orgId, year);
    const skPrefix = month
      ? `JNL#${journalCode.toUpperCase()}#DT#${year}-${month}`
      : `JNL#${journalCode.toUpperCase()}`;
    let exclusiveStartKey = JournalService.decodeCursor(cursor);
    let lastEvaluatedKey: Record<string, any> | undefined;
    const entries: JournalBookLineDto[] = [];

    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: config.TABLE_NAME,
          IndexName: config.GSI5,
          KeyConditionExpression:
            "#pk = :pk AND begins_with(#sk, :skPrefix)",
          FilterExpression: "#status = :posted",
          ExpressionAttributeNames: {
            "#pk": "GSI5PK",
            "#sk": "GSI5SK",
            "#status": "status",
          },
          ExpressionAttributeValues: marshall({
            ":pk": pk,
            ":skPrefix": skPrefix,
            ":posted": "POSTED",
          }),
          Limit: Math.max(limit - entries.length, 1),
          ExclusiveStartKey: exclusiveStartKey,
          ScanIndexForward: true,
        }),
      );

      for (const item of result.Items || []) {
        const entry = unmarshall(item);
        entries.push(
          JournalBookLineDtoSchema.parse({
            entryId: entry.entryId,
            date: entry.entryDate,
            journalCode: entry.journalCode,
            reference: entry.voucherNumber,
            label: entry.label,
            totalDebit: entry.totalDebit || 0,
            totalCredit: entry.totalCredit || 0,
            status: entry.status,
          }),
        );
      }

      lastEvaluatedKey = result.LastEvaluatedKey;
      exclusiveStartKey = lastEvaluatedKey;
    } while (entries.length < limit && lastEvaluatedKey);

    const nextCursor = JournalService.encodeCursor(lastEvaluatedKey);

    return {
      entries,
      nextCursor,
      hasMore: !!nextCursor,
    };
  }

  private static async hasPostedEntries(
    orgId: string,
    year: number | string,
    journalCode: string,
  ) {
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: config.TABLE_NAME,
          IndexName: config.GSI5,
          KeyConditionExpression:
            "GSI5PK = :pk AND begins_with(GSI5SK, :sk)",
          FilterExpression: "#status = :posted",
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: marshall({
            ":pk": KeyFactory.gsi5JournalPK(orgId, year),
            ":sk": `JNL#${journalCode.toUpperCase()}`,
            ":posted": "POSTED",
          }),
          Limit: 25,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      if ((result.Items || []).length > 0) {
        return true;
      }

      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return false;
  }

  private static decodeCursor(
    cursor?: string,
  ): Record<string, any> | undefined {
    if (!cursor) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(Buffer.from(cursor, "base64").toString());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Invalid cursor");
      }
      return parsed;
    } catch {
      throw new AppError(400, "ERROR_INVALID_CURSOR");
    }
  }

  private static encodeCursor(
    key?: Record<string, any>,
  ): string | undefined {
    return key
      ? Buffer.from(JSON.stringify(key)).toString("base64")
      : undefined;
  }
}
