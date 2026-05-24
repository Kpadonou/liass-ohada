import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { KeyFactory } from "../lambda/shared/key-builder";

interface BackfillAccessRow {
  orgId: string;
  userId: string;
  status?: string;
}

const tableName = process.env.TABLE_NAME;
const region = process.env.AWS_REGION || "eu-west-2";
const rowsJson = process.env.USER_WORKSPACE_BACKFILL;

if (!tableName) {
  throw new Error("TABLE_NAME is required.");
}

if (!rowsJson) {
  throw new Error(
    "USER_WORKSPACE_BACKFILL is required. Example: " +
      "'[{\"orgId\":\"org-123\",\"userId\":\"cognito-sub\"}]'",
  );
}

const rows = JSON.parse(rowsJson) as BackfillAccessRow[];
const client = new DynamoDBClient({ region });

async function run(): Promise<void> {
  for (const row of rows) {
    const status = row.status || "ACTIVE";

    await client.send(
      new UpdateItemCommand({
        TableName: tableName,
        Key: {
          PK: { S: KeyFactory.orgKey(row.orgId) },
          SK: { S: KeyFactory.orgUserAccessSK(row.userId) },
        },
        ConditionExpression:
          "entityType = :entityType AND orgId = :orgId AND userId = :userId",
        UpdateExpression: "SET GSI6PK = :gsi6pk, GSI6SK = :gsi6sk",
        ExpressionAttributeValues: {
          ":entityType": { S: "USER_ORG_ACCESS" },
          ":orgId": { S: row.orgId },
          ":userId": { S: row.userId },
          ":gsi6pk": { S: KeyFactory.userWorkspacesPK(row.userId) },
          ":gsi6sk": { S: KeyFactory.userWorkspaceSK(status, row.orgId) },
        },
      }),
    );

    console.log(`Backfilled ${row.userId} -> ${row.orgId}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
