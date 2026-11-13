import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { RestaurantBusinessDaySchema } from "@liass-ohada/shared/restaurants";
import { RestaurantCashService as Cash } from "./cash-service";
import { RestaurantCashRepository as Repository } from "./cash-repository";
import { RestaurantDocumentCollections as Documents } from "./document-collections";
import { TransactionScope } from "./transaction-model";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { AppError } from "@/lambda/shared/app-error";
import { marshall } from "@aws-sdk/util-dynamodb";
import { restaurantsTableName } from "./restaurant-storage";

/** Explicit, operator-invoked rollout repair. Never called by a read or a document write.
 * Deploy both counter writers before running. At most 20 collection calls (10,000
 * evaluated rows), a 31-day window and one named active BusinessDay; abort on an
 * incomplete traversal. Version CAS rejects concurrent day/document commits.
 */
export async function initializeCommercialCounts(
  scope: TransactionScope,
  actor: string,
  businessDayId: string,
) {
  const access = await Cash.authorize(scope, actor);
  if (!["OWNER", "MANAGER"].includes(access.role ?? ""))
    throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
  const active = await Cash.activeDay(scope);
  if (!active || active.day.data.businessDayId !== businessDayId)
    throw new AppError(409, "RESTAURANTS_TRANSACTION_STATE");
  if (active.day.data.commercialCountsInitializedAt) return active.day.data;
  const to = new Date().toISOString();
  const opened = new Date(active.day.data.openedAt);
  if (
    Date.parse(to) - opened.getTime() > 31 * 86400000 ||
    opened.getTime() > Date.parse(to)
  )
    throw new AppError(409, "RESTAURANTS_TRANSACTION_LIMIT");
  // Association is defined at commit, not by timestamp. Include complete monthly
  // buckets, including the preceding bucket for a timestamp reserved just before
  // an opening/month boundary. Each collection request still spans <=31 days.
  const ranges: { from: string; to: string }[] = [];
  const month = new Date(
    Date.UTC(opened.getUTCFullYear(), opened.getUTCMonth() - 1, 1),
  );
  while (month.getTime() <= Date.parse(to)) {
    const from = month.toISOString();
    month.setUTCMonth(month.getUTCMonth() + 1);
    ranges.push({ from, to: new Date(month.getTime() - 1).toISOString() });
  }
  const counts = { invoiceCount: 0, creditNoteCount: 0 };
  for (const kind of ["INV", "CN"] as const) {
    let cursor: string | undefined;
    let index = 0;
    for (let page = 0; page < 10; page++) {
      const result = await Documents.list(scope, actor, kind, {
        ...ranges[index],
        businessDayId,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      counts[kind === "INV" ? "invoiceCount" : "creditNoteCount"] +=
        result.items.length;
      cursor = result.nextCursor;
      if (!cursor) index++;
      if (index === ranges.length) break;
    }
    if (cursor || index < ranges.length)
      throw new AppError(409, "RESTAURANTS_TRANSACTION_LIMIT");
  }
  const data = RestaurantBusinessDaySchema.parse({
    ...active.day.data,
    ...counts,
    commercialCountsInitializedAt: to,
    version: active.day.data.version + 1,
  });
  await dynamoClient.send(
    new TransactWriteItemsCommand({
      TransactItems: [
        Repository.put(Repository.row(scope, "DAY", data), active.day),
        {
          ConditionCheck: {
            TableName: restaurantsTableName(),
            Key: marshall({ PK: active.pointer.PK, SK: active.pointer.SK }),
            ...Repository.conditions(active.pointer),
          },
        },
      ],
    }),
  );
  return data;
}
