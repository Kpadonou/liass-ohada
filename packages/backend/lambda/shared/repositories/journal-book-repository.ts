import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import {
  Entry,
  EntryLine,
  EntryLineSchema,
  EntrySchema,
} from "@liass-ohada/shared/accounting";
import {
  BatchGetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

export class JournalBookRepository {
  static async listPostedHeaders(
    orgId: string,
    year: string,
    startDate: string,
    endDate: string,
    journalCodes: string[],
  ): Promise<Entry[]> {
    const entries = new Map<string, Entry>();
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: config.TABLE_NAME,
          IndexName: config.GSI7,
          KeyConditionExpression:
            "#pk = :pk AND #sk BETWEEN :start AND :end",
          ExpressionAttributeNames: {
            "#pk": "GSI7PK",
            "#sk": "GSI7SK",
          },
          ExpressionAttributeValues: marshall({
            ":pk": KeyFactory.journalBookPK(orgId, year),
            ":start": `DT#${startDate}#`,
            ":end": `DT#${endDate}#\uffff`,
          }),
          ExclusiveStartKey: exclusiveStartKey,
          ScanIndexForward: true,
        }),
      );

      for (const item of result.Items || []) {
        const entry = EntrySchema.parse(unmarshall(item));
        if (entry.status === "POSTED") {
          entries.set(entry.entryId, entry);
        }
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    // Transitional compatibility for POSTED entries created before GSI7.
    // The merge is bounded by configured/system journals and remains Query-only.
    for (const journalCode of journalCodes) {
      let journalCursor: Record<string, any> | undefined;
      do {
        const result = await dynamoClient.send(
          new QueryCommand({
            TableName: config.TABLE_NAME,
            IndexName: config.GSI5,
            KeyConditionExpression:
              "#pk = :pk AND #sk BETWEEN :start AND :end",
            FilterExpression: "#status = :posted",
            ExpressionAttributeNames: {
              "#pk": "GSI5PK",
              "#sk": "GSI5SK",
              "#status": "status",
            },
            ExpressionAttributeValues: marshall({
              ":pk": KeyFactory.gsi5JournalPK(orgId, year),
              ":start": `JNL#${journalCode}#DT#${startDate}#`,
              ":end": `JNL#${journalCode}#DT#${endDate}#\uffff`,
              ":posted": "POSTED",
            }),
            ExclusiveStartKey: journalCursor,
            ScanIndexForward: true,
          }),
        );
        for (const item of result.Items || []) {
          const entry = EntrySchema.parse(unmarshall(item));
          if (entry.status === "POSTED") {
            entries.set(entry.entryId, entry);
          }
        }
        journalCursor = result.LastEvaluatedKey;
      } while (journalCursor);
    }

    return [...entries.values()];
  }

  static async listEntryLines(
    orgId: string,
    year: string,
    entryId: string,
  ): Promise<EntryLine[]> {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.partitionKey(orgId, year),
          ":sk": KeyFactory.entryLineSK(`${entryId}#`),
        }),
        ScanIndexForward: true,
      }),
    );

    return (result.Items || [])
      .map((item) => EntryLineSchema.parse(unmarshall(item)))
      .sort((left, right) => left.lineId.localeCompare(right.lineId));
  }

  static async getAccountLabels(
    orgId: string,
    accountIds: string[],
  ): Promise<Map<string, string>> {
    const labels = new Map<string, string>();
    const uniqueIds = [...new Set(accountIds)];

    for (let offset = 0; offset < uniqueIds.length; offset += 100) {
      let keys = uniqueIds.slice(offset, offset + 100).map((accountId) =>
        marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.accountSK(accountId),
        }),
      );

      do {
        const result = await dynamoClient.send(
          new BatchGetItemCommand({
            RequestItems: {
              [config.TABLE_NAME]: {
                Keys: keys,
                ProjectionExpression: "accountId, accountName",
              },
            },
          }),
        );

        for (const item of result.Responses?.[config.TABLE_NAME] || []) {
          const account = unmarshall(item);
          if (account.accountId && account.accountName) {
            labels.set(account.accountId, account.accountName);
          }
        }
        keys = result.UnprocessedKeys?.[config.TABLE_NAME]?.Keys || [];
      } while (keys.length > 0);
    }

    return labels;
  }
}
