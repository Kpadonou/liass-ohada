import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { createMigrationStore } from "../../../scripts/migrate-restaurants-storage";
const options = {
  stage: "test" as const,
  source: "liass-ohada-test-accounting-table",
  target: "liass-ohada-test-restaurants-table",
  apply: false,
  confirmProduction: false,
};
test("source inventory follows empty filtered pages and includes global QR predicates; target inventory is complete", async () => {
  const db = mockClient(DynamoDBClient);
  const cursor = { PK: { S: "ORG#x" }, SK: { S: "OTHER" } };
  const qr = {
    PK: { S: `RESTAURANTS_QR#${"a".repeat(64)}` },
    SK: { S: "LOOKUP" },
  };
  db.on(ScanCommand)
    .resolvesOnce({ Items: [], LastEvaluatedKey: cursor })
    .resolvesOnce({ Items: [qr] })
    .resolvesOnce({ Items: [] });
  try {
    const store = createMigrationStore(
      new DynamoDBClient({ region: "us-east-1" }),
      options,
    );
    expect(await store.inventory(options.source)).toEqual([qr]);
    await store.inventory(options.target);
    const calls = db
      .commandCalls(ScanCommand)
      .map((call) => call.args[0].input);
    expect(calls).toHaveLength(3);
    expect(calls[1].ExclusiveStartKey).toEqual(cursor);
    expect(calls[0].FilterExpression).toContain("begins_with(PK, :pk)");
    expect(calls[0].ExpressionAttributeValues?.[":pk"]).toEqual({
      S: "RESTAURANTS",
    });
    expect(calls[2].FilterExpression).toBeUndefined();
    expect(calls.every((call) => call.ConsistentRead)).toBe(true);
  } finally {
    db.restore();
  }
});
