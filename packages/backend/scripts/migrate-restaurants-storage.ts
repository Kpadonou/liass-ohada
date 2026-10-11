import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
  AttributeValue,
} from "@aws-sdk/client-dynamodb";
import {
  migrateRestaurants,
  MigrationOptions,
  MigrationStore,
  validateOptions,
} from "./lib/restaurants-migration";
export function parseMigrationArgs(args: string[]): MigrationOptions {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--apply", "--confirm-production"].includes(arg)) {
      if (flags.has(arg)) throw new Error("Duplicate flag");
      flags.add(arg);
    } else if (
      ["--stage", "--source-table", "--target-table", "--region"].includes(arg)
    ) {
      if (values[arg] || !args[i + 1] || args[i + 1].startsWith("--"))
        throw new Error("Invalid argument value");
      values[arg] = args[++i];
    } else throw new Error("Unknown argument");
  }
  if (!values["--region"]) throw new Error("--region required");
  const options: MigrationOptions = {
    stage: values["--stage"] as MigrationOptions["stage"],
    source: values["--source-table"],
    target: values["--target-table"],
    apply: flags.has("--apply"),
    confirmProduction: flags.has("--confirm-production"),
  };
  validateOptions(options);
  return options;
}
export function createMigrationStore(
  client: DynamoDBClient,
  options: MigrationOptions,
): MigrationStore {
  return {
    async inventory(table) {
      const items: Record<string, AttributeValue>[] = [];
      let cursor: Record<string, AttributeValue> | undefined;
      do {
        const page = await client.send(
          new ScanCommand({
            TableName: table,
            ConsistentRead: true,
            ExclusiveStartKey: cursor,
            ...(table === options.source
              ? {
                  FilterExpression:
                    "begins_with(PK, :pk) OR begins_with(SK, :sk) OR begins_with(#type, :type)",
                  ExpressionAttributeNames: { "#type": "entityType" },
                  ExpressionAttributeValues: {
                    ":pk": { S: "RESTAURANTS" },
                    ":sk": { S: "RESTAURANTS" },
                    ":type": { S: "RESTAURANT" },
                  },
                }
              : {}),
          }),
        );
        items.push(...(page.Items ?? []));
        cursor = page.LastEvaluatedKey;
      } while (cursor);
      return items;
    },
    async get(table, item) {
      return (
        await client.send(
          new GetItemCommand({
            TableName: table,
            Key: { PK: item.PK, SK: item.SK },
            ConsistentRead: true,
          }),
        )
      ).Item;
    },
    async putAbsent(table, item) {
      await client.send(
        new PutItemCommand({
          TableName: table,
          Item: item,
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        }),
      );
    },
  };
}
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const options = parseMigrationArgs(args);
    const region = args[args.indexOf("--region") + 1];
    const client = new DynamoDBClient({ region });
    const store = createMigrationStore(client, options);
    const report = await migrateRestaurants(store, options);
    console.info(JSON.stringify(report, null, 2));
    if (
      report.conflictCount ||
      report.unknownKeyCount ||
      report.validationErrorCount ||
      (options.apply && !report.verified)
    )
      process.exitCode = 1;
  })().catch((error) => {
    console.error(
      "Restaurants migration failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    process.exitCode = 1;
  });
}
