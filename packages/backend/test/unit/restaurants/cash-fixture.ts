import { randomUUID } from "crypto";
import { RestaurantCashService as Cash } from "@/lambda/domains/restaurants/cash-service";
import type { TransactionScope } from "@/lambda/domains/restaurants/transaction-model";
export async function openCashFixture(
  scope: TransactionScope,
  actors: string[],
) {
  await Cash.mutate(scope, "owner", "OPEN_DAY", {
    clientRequestId: randomUUID(),
    operationalTimezone: "Africa/Porto-Novo",
  });
  for (const actor of actors)
    await Cash.mutate(scope, actor, "OPEN_CASH", {
      clientRequestId: randomUUID(),
      openingCashAmountMinor: 0,
    });
}
