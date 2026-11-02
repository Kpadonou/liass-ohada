import { randomUUID } from "crypto";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { RestaurantBusinessDaySchema } from "@liass-ohada/shared/restaurants";
import { RestaurantCashService as Cash } from "@/lambda/domains/restaurants/cash-service";
import { RestaurantDocumentCollections as Documents } from "@/lambda/domains/restaurants/document-collections";
import { initializeCommercialCounts } from "@/lambda/domains/restaurants/document-counts-initialization";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { memoryDynamo } from "./memory-dynamo";
import { acceptanceFixture } from "./acceptance-fixture";
let db: ReturnType<typeof memoryDynamo>,
  scope: { orgId: string; outletId: string };
beforeEach(async () => {
  db = memoryDynamo();
  const fixture = await acceptanceFixture();
  scope = { orgId: "org-resto", outletId: fixture.outlet.id };
  db.seedAccess(scope.orgId, "owner", "OWNER");
  await Cash.mutate(scope, "owner", "OPEN_DAY", {
    clientRequestId: randomUUID(),
    operationalTimezone: "Africa/Porto-Novo",
  });
});
afterEach(() => {
  expect(db.db.commandCalls(ScanCommand)).toHaveLength(0);
  db.db.restore();
  jest.restoreAllMocks();
});
async function write(kind: "INV" | "CN", id = randomUUID()) {
  const context = await Documents.context(scope, kind);
  const at = new Date().toISOString();
  const row = {
    ...scope,
    invoiceId: randomUUID(),
    guestSessionId: randomUUID(),
    businessDayId: context.businessDayId,
    tableDisplayName: "ALTAB",
    currency: "XOF",
    ...(kind === "INV"
      ? { issuedAt: at, totalMinor: 900, status: "FINAL" }
      : {
          creditNoteId: id,
          creditNoteReference: "AV-20261102-12345678",
          validatedAt: at,
          reason: "Retour",
          amountMinor: 900,
          refundedMinor: 0,
          remainingRefundableMinor: 900,
          status: "VALIDATED",
        }),
  };
  const put = Documents.put(scope, kind, at, id, row);
  await dynamoClient.send(
    new TransactWriteItemsCommand({ TransactItems: [...context.actions, put] }),
  );
  return { put, context };
}
test.each(["INV", "CN"] as const)(
  "%s increments only in successful atomic projection commit; duplicate cannot increment",
  async (kind) => {
    const { put } = await write(kind);
    const first = (await Cash.activeDay(scope))!.day.data;
    expect(first.invoiceCount).toBe(kind === "INV" ? 1 : 0);
    expect(first.creditNoteCount).toBe(kind === "CN" ? 1 : 0);
    const retry = await Documents.context(scope, kind);
    await expect(
      dynamoClient.send(
        new TransactWriteItemsCommand({
          TransactItems: [...retry.actions, put],
        }),
      ),
    ).rejects.toThrow();
    expect((await Cash.activeDay(scope))!.day.data).toEqual(first);
  },
);
test.each(["INV", "CN"] as const)(
  "%s uses overnight identity and null context writes no counter",
  async (kind) => {
    const active = (await Cash.activeDay(scope))!;
    const raw = {
      ...active.day,
      data: {
        ...active.day.data,
        businessDate: "2026-10-30",
        openedAt: "2026-10-30T23:00:00.000Z",
      },
    };
    db.rows.set(JSON.stringify([raw.PK, raw.SK]), marshall(raw));
    await write(kind);
    expect((await Cash.activeDay(scope))!.day.data.businessDayId).toBe(
      raw.data.businessDayId,
    );
    jest.spyOn(Cash, "activeDay").mockResolvedValue(undefined);
    const context = await Documents.context(scope, kind);
    expect(context.businessDayId).toBeNull();
    expect(context.actions).toHaveLength(1);
    expect(context.actions[0].Put).toBeUndefined();
  },
);
test("legacy missing counters decode as zero without writing", async () => {
  const before = db.transactions.length;
  const raw = { ...(await Cash.activeDay(scope))!.day.data } as Record<
    string,
    unknown
  >;
  delete raw.invoiceCount;
  delete raw.creditNoteCount;
  delete raw.commercialCountsInitializedAt;
  expect(RestaurantBusinessDaySchema.parse(raw)).toMatchObject({
    invoiceCount: 0,
    creditNoteCount: 0,
  });
  expect(db.transactions).toHaveLength(before);
});
async function legacyDay() {
  const active = (await Cash.activeDay(scope))!;
  const key = JSON.stringify([active.day.PK, active.day.SK]);
  const row = unmarshall(db.rows.get(key)!);
  delete row.data.commercialCountsInitializedAt;
  delete row.data.invoiceCount;
  delete row.data.creditNoteCount;
  db.rows.set(key, marshall(row));
  return active.day.data.businessDayId;
}
test("targeted initialization counts only existing projections, is idempotent and never backfills documents", async () => {
  const id = await legacyDay();
  await write("INV");
  await write("CN");
  const rows = db.rows.size;
  const result = await initializeCommercialCounts(scope, "owner", id);
  expect(result).toMatchObject({ invoiceCount: 1, creditNoteCount: 1 });
  expect(db.rows.size).toBe(rows);
  const tx = db.transactions.length;
  expect(await initializeCommercialCounts(scope, "owner", id)).toEqual(result);
  expect(db.transactions).toHaveLength(tx);
});
test("initialization rejects a concurrent commit without losing or double-counting it", async () => {
  const id = await legacyDay();
  await write("INV");
  const original = Documents.list.bind(Documents);
  let raced = false;
  jest.spyOn(Documents, "list").mockImplementation(async (...args) => {
    const page = await original(...args);
    if (!raced) {
      raced = true;
      await write("CN");
    }
    return page;
  });
  await expect(
    initializeCommercialCounts(scope, "owner", id),
  ).rejects.toThrow();
  expect(
    (await Cash.activeDay(scope))!.day.data.commercialCountsInitializedAt,
  ).toBeUndefined();
  expect(await initializeCommercialCounts(scope, "owner", id)).toMatchObject({
    invoiceCount: 1,
    creditNoteCount: 1,
  });
});
test("incomplete bounded initialization fails without writing", async () => {
  const id = await legacyDay();
  jest
    .spyOn(Documents, "list")
    .mockResolvedValue({ items: [], nextCursor: "more" });
  const tx = db.transactions.length;
  await expect(
    initializeCommercialCounts(scope, "owner", id),
  ).rejects.toThrow();
  expect(db.transactions).toHaveLength(tx);
});

test("initialization does not infer membership from publication time relative to day opening", async () => {
  const businessDayId = await legacyDay();
  const day = (await Cash.activeDay(scope))!.day.data;
  const id = randomUUID(),
    at = new Date(Date.parse(day.openedAt) - 1).toISOString();
  await dynamoClient.send(
    new TransactWriteItemsCommand({
      TransactItems: [
        Documents.put(scope, "INV", at, id, {
          ...scope,
          invoiceId: id,
          guestSessionId: randomUUID(),
          issuedAt: at,
          businessDayId,
          tableDisplayName: "Boundary",
          totalMinor: 900,
          currency: "XOF",
          status: "FINAL",
        }),
      ],
    }),
  );
  expect(
    await initializeCommercialCounts(scope, "owner", businessDayId),
  ).toMatchObject({ invoiceCount: 1, creditNoteCount: 0 });
});
