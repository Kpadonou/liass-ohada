import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import {
  migrateRestaurants,
  transformLegacy,
  Item,
  MigrationStore,
  MigrationOptions,
  validateOptions,
} from "../../../scripts/lib/restaurants-migration";
import { parseMigrationArgs } from "../../../scripts/migrate-restaurants-storage";
import { memoryDynamo, fixtureId } from "./memory-dynamo";
import { acceptanceFixture } from "./acceptance-fixture";
import { RestaurantsService } from "../../../lambda/domains/restaurants/restaurant-service";

const options: MigrationOptions = {
  stage: "test",
  source: "liass-ohada-test-accounting-table",
  target: "liass-ohada-test-restaurants-table",
  apply: false,
  confirmProduction: false,
};
const identity = (item: Item) => JSON.stringify([item.PK.S, item.SK.S]);
function legacy(item: Item): Item {
  const sk = item.SK.S!,
    pk = item.PK.S!;
  const prefixes: Record<string, string> = {
    ROOT: "RESTAURANTS#ROOT",
    OUT: "RESTAURANTS#OUTLET",
    AREA: "RESTAURANTS#AREA",
    TBL: "RESTAURANTS#TABLE",
    TC: "RESTAURANTS#TABLE_CODE",
    STN: "RESTAURANTS#STATION",
    MENU: "RESTAURANTS#MENU",
    CAT: "RESTAURANTS#CATEGORY",
    ITEM: "RESTAURANTS#ITEM",
  };
  return {
    ...item,
    PK: { S: pk.startsWith("QR#") ? pk.replace("QR#", "RESTAURANTS_QR#") : pk },
    SK: {
      S: pk.startsWith("QR#")
        ? sk
        : prefixes[sk.split("#")[0]] +
          sk.slice(sk.indexOf("#") < 0 ? sk.length : sk.indexOf("#")),
    },
  };
}
let memory: ReturnType<typeof memoryDynamo>;
let source: Item[], destination: Map<string, Item>, writes: number;
const store: MigrationStore = {
  async inventory(table) {
    return table === options.source ? source : [...destination.values()];
  },
  async get(_table, item) {
    return destination.get(identity(item));
  },
  async putAbsent(_table, item) {
    if (destination.has(identity(item)))
      throw Object.assign(new Error(), {
        name: "ConditionalCheckFailedException",
      });
    writes++;
    destination.set(identity(item), item);
  },
};
beforeEach(async () => {
  memory = memoryDynamo();
  await acceptanceFixture();
  await RestaurantsService.create(
    "org-resto",
    "owner",
    "outlet",
    {},
    { name: "Second", clientRequestId: fixtureId(99) },
  );
  await acceptanceFixture("org-second");
  source = [...memory.rows.values()].map(legacy);
  destination = new Map();
  writes = 0;
});
afterEach(() => memory.db.restore());
test("dry-run maps every family without writing, across organizations and global QR partitions", async () => {
  const report = await migrateRestaurants(store, options);
  expect(writes).toBe(0);
  expect(report.sourceCount).toBe(source.length);
  expect(report.mappingCount).toBe(source.length);
  expect(Object.keys(report.families)).toHaveLength(10);
  expect(report.qrCount).toBe(8);
  expect(report.validationErrorCount).toBe(0);
  for (const item of source)
    expect(transformLegacy(item)?.SK.S).not.toMatch(/^RESTAURANTS/);
});
test("apply preserves every payload, metadata and version; verified rerun is safe", async () => {
  const report = await migrateRestaurants(store, { ...options, apply: true });
  expect(report.verified).toBe(true);
  expect(writes).toBe(source.length);
  for (const old of source) {
    const target = transformLegacy(old)!;
    expect(unmarshall(destination.get(identity(target))!)).toEqual({
      ...unmarshall(old),
      PK: target.PK.S,
      SK: target.SK.S,
    });
  }
  memory.rows.clear();
  for (const item of destination.values())
    memory.rows.set(identity(item), item);
  for (const item of destination.values()) {
    const row = unmarshall(item);
    if (row.entityType === "RESTAURANT_TABLE") {
      const resolved = await RestaurantsService.resolveTableQr(row.qrToken);
      expect(resolved.orgId).toBe(row.orgId);
      expect(resolved.table.id).toBe(row.data.id);
    }
  }
  const rerun = await migrateRestaurants(store, { ...options, apply: true });
  expect(rerun.verified).toBe(true);
  expect(rerun.createdCount).toBe(0);
  expect(rerun.identicalCount).toBe(source.length);
});
test("preflight conflict prevents all writes", async () => {
  const target = transformLegacy(source[0])!;
  destination.set(identity(target), { ...target, unexpected: { S: "value" } });
  expect(
    (await migrateRestaurants(store, { ...options, apply: true }))
      .conflictCount,
  ).toBe(1);
  expect(writes).toBe(0);
});
test.each(["unknown", "malformed", "qr", "parent", "reservation"])(
  "rejects %s source before mutation",
  async (kind) => {
    if (kind === "unknown")
      source.push(
        marshall({
          PK: "ORG#org-resto",
          SK: "RESTAURANTS#FUTURE#x",
          entityType: "RESTAURANT_FUTURE",
          orgId: "org-resto",
        }),
      );
    if (kind === "malformed")
      source[0] = { ...source[0], SK: { S: "RESTAURANTS#OUTLET#incorrect" } };
    if (kind === "qr")
      source = source.filter(
        (item) => !item.PK.S?.startsWith("RESTAURANTS_QR#"),
      );
    if (kind === "parent")
      source = source.filter(
        (item) => item.entityType.S !== "RESTAURANT_SERVICE_AREA",
      );
    if (kind === "reservation")
      source = source.filter(
        (item) => item.entityType.S !== "RESTAURANT_TABLE_CODE",
      );
    const report = await migrateRestaurants(store, { ...options, apply: true });
    expect(
      report.unknownKeyCount + report.validationErrorCount,
    ).toBeGreaterThan(0);
    expect(writes).toBe(0);
  },
);
test("partial destination detects missing content and apply repairs it", async () => {
  const target = transformLegacy(source[0])!;
  destination.set(identity(target), target);
  expect((await migrateRestaurants(store, options)).verified).toBe(false);
  expect(
    (await migrateRestaurants(store, { ...options, apply: true })).verified,
  ).toBe(true);
});
test("zero Restaurants records ignores Platform without writes", async () => {
  source = [
    marshall({
      PK: "ORG#x",
      SK: "PRODUCT_ACCESS#RESTAURANTS",
      entityType: "PRODUCT_ACCESS",
    }),
  ];
  const result = await migrateRestaurants(store, { ...options, apply: true });
  expect(result.sourceCount).toBe(0);
  expect(result.verified).toBe(true);
  expect(writes).toBe(0);
});
test("operator safeguards reject ambiguous stages, identities, production writes and unknown CLI args", () => {
  expect(() =>
    validateOptions({ ...options, target: options.source }),
  ).toThrow();
  expect(() =>
    validateOptions({
      ...options,
      stage: "prod",
      source: "liass-ohada-prod-accounting-table",
      target: "liass-ohada-prod-restaurants-table",
      apply: true,
    }),
  ).toThrow();
  expect(() => parseMigrationArgs(["--apply"])).toThrow();
  expect(() => parseMigrationArgs(["--unknown"])).toThrow();
});
