import { GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { config } from "../../../lambda/shared/config";
import { RestaurantsRepository } from "../../../lambda/domains/restaurants/restaurant-repository";
import { TenantAccessService } from "../../../lambda/shared/services/tenant-access-service";
import { ProductAccessService } from "../../../lambda/shared/services/product-access-service";
import { restaurantsTableName } from "../../../lambda/domains/restaurants/restaurant-storage";
import { memoryDynamo } from "./memory-dynamo";
import { acceptanceFixture } from "./acceptance-fixture";
let memory: ReturnType<typeof memoryDynamo>;
beforeEach(() => {
  memory = memoryDynamo();
  memory.seedAccess("org-resto", "owner", "OWNER");
});
afterEach(() => memory.db.restore());
test("membership/entitlement use Platform while every business transaction and read uses Restaurants", async () => {
  await TenantAccessService.assertUserCanAccessOrg({
    orgId: "org-resto",
    userId: "owner",
  });
  await ProductAccessService.requireActiveProductAccess({
    orgId: "org-resto",
    productCode: "RESTAURANTS",
    action: "test",
  });
  expect(
    memory.db
      .commandCalls(GetItemCommand)
      .every(
        (call) => call.args[0].input.TableName === config.PLATFORM_TABLE_NAME,
      ),
  ).toBe(true);
  memory.db.resetHistory();
  await acceptanceFixture();
  await RestaurantsRepository.list("org-resto", "outlet", {}, { limit: 10 });
  expect(
    memory.db
      .commandCalls(GetItemCommand)
      .every((call) => call.args[0].input.TableName === restaurantsTableName()),
  ).toBe(true);
  expect(
    memory.db
      .commandCalls(QueryCommand)
      .every((call) => call.args[0].input.TableName === restaurantsTableName()),
  ).toBe(true);
  for (const tx of memory.transactions)
    for (const op of tx.TransactItems ?? [])
      expect((op.Put ?? op.Delete ?? op.ConditionCheck)?.TableName).toBe(
        restaurantsTableName(),
      );
});
test("missing or shared business binding fails closed", () => {
  const old = process.env.RESTAURANTS_TABLE_NAME;
  try {
    delete process.env.RESTAURANTS_TABLE_NAME;
    expect(() => restaurantsTableName()).toThrow();
    process.env.RESTAURANTS_TABLE_NAME = config.TABLE_NAME;
    expect(() => restaurantsTableName()).toThrow();
  } finally {
    process.env.RESTAURANTS_TABLE_NAME = old;
  }
});
