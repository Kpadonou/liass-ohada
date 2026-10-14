import {
  DynamoDBClient,
  BatchGetItemCommand,
  BatchGetItemCommandInput,
  GetItemCommand,
  GetItemCommandInput,
  QueryCommand,
  QueryCommandInput,
  TransactWriteItemsCommand,
  TransactWriteItemsCommandInput,
  TransactionCanceledException,
  AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { KeyFactory } from "@/lambda/shared/key-builder";

type Item = Record<string, AttributeValue>;
const identity = (key: Item) => JSON.stringify([key.PK?.S, key.SK?.S]);
function condition(
  item: Item | undefined,
  expression: string | undefined,
  names: Record<string, string> = {},
  attributes: Item = {},
): boolean {
  if (!expression) return true;
  const data = item ? unmarshall(item) : {};
  const values = unmarshall(attributes);
  return expression.split(" AND ").every((clause) => {
    const absent = /^attribute_not_exists\((\w+)\)$/.exec(clause);
    if (absent) return data[absent[1]] === undefined;
    const comparison = /^([\w.#]+) = (:\w+)$/.exec(clause);
    if (!comparison) throw new Error(`Unsupported test condition: ${clause}`);
    let value: unknown = data;
    for (const part of comparison[1].split(".")) {
      value =
        typeof value === "object" && value !== null
          ? (value as Record<string, unknown>)[names[part] ?? part]
          : undefined;
    }
    return value === values[comparison[2]];
  });
}
/** Exercises repository DynamoDB commands and atomic conditions, not a substitute repository. */
export function memoryDynamo() {
  const db = mockClient(DynamoDBClient);
  const rows = new Map<string, Item>();
  const transactions: TransactWriteItemsCommandInput[] = [];
  db.on(GetItemCommand).callsFake(async (input: GetItemCommandInput) => ({
    Item: rows.get(identity(input.Key ?? {})),
  }));
  db.on(BatchGetItemCommand).callsFake(
    async (input: BatchGetItemCommandInput) => ({
      Responses: Object.fromEntries(
        Object.entries(input.RequestItems ?? {}).map(([table, request]) => {
          if ((request.Keys?.length ?? 0) > 100)
            throw new Error("Unbounded restaurant batch");
          return [
            table,
            (request.Keys ?? []).flatMap((key) =>
              rows.has(identity(key)) ? [rows.get(identity(key))!] : [],
            ),
          ];
        }),
      ),
    }),
  );
  db.on(QueryCommand).callsFake(async (input: QueryCommandInput) => {
    const platformProducts =
      input.ExpressionAttributeValues?.[":skPrefix"]?.S ===
      KeyFactory.productAccessPrefix();
    if (
      input.IndexName ||
      input.FilterExpression ||
      (!input.Limit && !platformProducts) ||
      (input.Limit ?? 0) > 100
    )
      throw new Error("Unbounded restaurant query");
    const pk = input.ExpressionAttributeValues?.[":pk"]?.S;
    const prefix =
      input.ExpressionAttributeValues?.[":prefix"]?.S ??
      input.ExpressionAttributeValues?.[":skPrefix"]?.S ??
      "";
    const lower = input.ExpressionAttributeValues?.[":start"]?.S;
    const upper = input.ExpressionAttributeValues?.[":end"]?.S;
    const start = input.ExclusiveStartKey?.SK?.S ?? "";
    const matching = [...rows.values()]
      .filter(
        (row) =>
          row.PK.S === pk &&
          row.SK.S?.startsWith(prefix) &&
          (!start ||
            (input.ScanIndexForward === false
              ? row.SK.S < start
              : row.SK.S > start)) &&
          (!lower || row.SK.S >= lower) &&
          (!upper || row.SK.S <= upper),
      )
      .sort((a, b) =>
        input.ScanIndexForward === false
          ? b.SK.S!.localeCompare(a.SK.S!)
          : a.SK.S!.localeCompare(b.SK.S!),
      );
    const page = matching.slice(0, input.Limit ?? matching.length);
    const last = matching.length > page.length ? page.at(-1) : undefined;
    return {
      Items: page,
      ...(last ? { LastEvaluatedKey: { PK: last.PK, SK: last.SK } } : {}),
    };
  });
  db.on(TransactWriteItemsCommand).callsFake(
    async (input: TransactWriteItemsCommandInput) => {
      transactions.push(input);
      const operations = input.TransactItems ?? [];
      const keys = operations.map((op) =>
        identity(
          op.Put?.Item ?? op.Delete?.Key ?? op.ConditionCheck?.Key ?? {},
        ),
      );
      if (new Set(keys).size !== keys.length)
        throw new Error("DynamoDB transaction targets the same item twice");
      const failures = operations.map((op, index) => {
        const action = op.Put ?? op.Delete ?? op.ConditionCheck;
        if (!action) throw new Error("Unsupported transaction operation");
        return condition(
          rows.get(keys[index]),
          action.ConditionExpression,
          action.ExpressionAttributeNames,
          action.ExpressionAttributeValues,
        )
          ? { Code: "None" }
          : { Code: "ConditionalCheckFailed" };
      });
      if (failures.some((failure) => failure.Code !== "None"))
        throw new TransactionCanceledException({
          message: "Condition failed",
          $metadata: {},
          CancellationReasons: failures,
        });
      operations.forEach((operation, index) => {
        if (operation.Put) rows.set(keys[index], operation.Put.Item ?? {});
        if (operation.Delete) rows.delete(keys[index]);
      });
      return {};
    },
  );
  function seedAccess(
    orgId: string,
    userId: string,
    role: string,
    entitled = true,
  ) {
    const membership = {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.orgUserAccessSK(userId),
      entityType: "USER_ORG_ACCESS",
      orgId,
      userId,
      status: "ACTIVE",
      accessSource: "DIRECT",
      workspaceType: "COMPANY",
      role: "OWNER",
      productRoles: { RESTAURANTS: role },
    };
    rows.set(identity(marshall(membership)), marshall(membership));
    if (entitled) {
      const access = {
        PK: KeyFactory.orgKey(orgId),
        SK: KeyFactory.productAccessSK("RESTAURANTS"),
        entityType: "PRODUCT_ACCESS",
        orgId,
        productCode: "RESTAURANTS",
        status: "ACTIVE",
        createdAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:00:00.000Z",
      };
      rows.set(identity(marshall(access)), marshall(access));
    }
  }
  return { db, rows, transactions, seedAccess };
}
export const fixtureId = (number: number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
