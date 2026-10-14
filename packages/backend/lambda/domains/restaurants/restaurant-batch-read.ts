import { AttributeValue, BatchGetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { AppError } from "@/lambda/shared/app-error";
import { restaurantsTableName } from "./restaurant-storage";

/** Bounded internal hydration. Unprocessed keys must never be interpreted as absent. */
export async function restaurantBatchRead(keys: { PK: string; SK: string }[]) {
  const identity = (key: { PK: string; SK: string }) =>
    JSON.stringify([key.PK, key.SK]);
  const unique = new Map(keys.map((key) => [identity(key), key]));
  if (unique.size > 100)
    throw new AppError(400, "RESTAURANTS_TRANSACTION_LIMIT");
  const found = new Map<string, Record<string, AttributeValue>>();
  let pending = [...unique.values()].map((key) => marshall(key));
  const table = restaurantsTableName();
  for (let attempt = 0; pending.length && attempt < 3; attempt++) {
    const requested = new Set(
      pending.map((key) =>
        identity(unmarshall(key) as { PK: string; SK: string }),
      ),
    );
    const response = await dynamoClient.send(
      new BatchGetItemCommand({
        RequestItems: { [table]: { Keys: pending, ConsistentRead: true } },
      }),
    );
    for (const raw of response.Responses?.[table] ?? []) {
      const key = identity(unmarshall(raw) as { PK: string; SK: string });
      if (!requested.has(key) || found.has(key))
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      found.set(key, raw);
    }
    pending = response.UnprocessedKeys?.[table]?.Keys ?? [];
    if (
      pending.some(
        (key) =>
          !requested.has(
            identity(unmarshall(key) as { PK: string; SK: string }),
          ) ||
          found.has(identity(unmarshall(key) as { PK: string; SK: string })),
      )
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    if (pending.length && attempt < 2)
      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
  }
  if (pending.length) throw new AppError(503, "ERROR_INTERNAL_SERVER");
  return keys.map((key) => found.get(identity(key)));
}
