import { randomUUID } from "crypto";
import { marshall } from "@aws-sdk/util-dynamodb";
import {
  ScanCommand,
  QueryCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { RestaurantDocumentCollectionRequestSchema } from "@liass-ohada/shared/restaurants";
import { memoryDynamo } from "./memory-dynamo";
import { RestaurantDocumentCollections as D } from "@/lambda/domains/restaurants/document-collections";
import { RestaurantCashService as Cash } from "@/lambda/domains/restaurants/cash-service";
const scope = { orgId: "org-docs", outletId: randomUUID() };
let db: ReturnType<typeof memoryDynamo>;
beforeEach(() => {
  db = memoryDynamo();
  jest
    .spyOn(Cash, "authorize")
    .mockResolvedValue({ actions: [], role: "MANAGER" });
});
afterEach(() => {
  expect(db.db.commandCalls(ScanCommand)).toHaveLength(0);
  db.db.restore();
  jest.restoreAllMocks();
});
const range = {
  from: "2026-10-31T00:00:00.000Z",
  to: "2026-11-02T00:00:00.000Z",
  limit: 1,
};
test("commercial context reads active BusinessDay only, preserves overnight identity and guards commit", async () => {
  const businessDayId = randomUUID();
  const active = jest.spyOn(Cash, "activeDay").mockResolvedValue({
    day: {
      PK: "day",
      SK: "META",
      data: {
        businessDayId,
        version: 3,
        status: "OPEN",
        businessDate: "2026-10-31",
      },
    },
  } as Awaited<ReturnType<typeof Cash.activeDay>>);
  const context = await D.context(scope);
  expect(context.businessDayId).toBe(businessDayId);
  expect(context.actions).toHaveLength(2);
  expect(active).toHaveBeenCalledWith(scope);
  active.mockResolvedValue(undefined);
  const absent = await D.context(scope);
  expect(absent.businessDayId).toBeNull();
  expect(absent.actions[0].ConditionCheck?.ConditionExpression).toBe(
    "attribute_not_exists(PK)",
  );
});
function document(
  kind: "INV" | "CN",
  at: string,
  day: string | null = null,
  tenant = scope,
) {
  const id = randomUUID(),
    invoiceId = kind === "INV" ? id : randomUUID();
  const common = {
    ...tenant,
    invoiceId,
    guestSessionId: randomUUID(),
    businessDayId: day,
    tableDisplayName: "Terrasse Étage service",
    currency: "XOF",
  };
  const data =
    kind === "INV"
      ? { ...common, issuedAt: at, totalMinor: 900, status: "FINAL" }
      : {
          ...common,
          creditNoteId: id,
          creditNoteReference: "AV-20261101-2C0031A8",
          validatedAt: at,
          reason: "Retour client",
          amountMinor: 900,
          refundedMinor: 400,
          remainingRefundableMinor: 500,
          status: "VALIDATED",
        };
  const row = D.put(tenant, kind, at, id, data).Put!.Item!;
  db.rows.set(JSON.stringify([row.PK.S, row.SK.S]), row);
  return data;
}
describe.each(["INV", "CN"] as const)("%s proof matrix", (kind) => {
  test("BusinessDay crossing month and midnight remains an identity filter; null remains in history", async () => {
    const day = randomUUID();
    document(kind, "2026-10-31T23:59:00.000Z", day);
    document(kind, "2026-11-01T00:01:00.000Z", day);
    document(kind, "2026-11-01T00:02:00.000Z");
    const all = await D.list(scope, "manager", kind, { ...range, limit: 100 });
    expect(all.items).toHaveLength(3);
    const filtered = await D.list(scope, "manager", kind, {
      ...range,
      limit: 100,
      businessDayId: day,
    });
    expect(filtered.items).toHaveLength(2);
    expect(db.db.commandCalls(GetItemCommand)).toHaveLength(0);
    expect(
      db.db
        .commandCalls(QueryCommand)
        .every((call) => !call.args[0].input.IndexName),
    ).toBe(true);
  });
  test("tenant and outlet rows are isolated and cursor cannot cross any bound context", async () => {
    document(kind, "2026-11-01T01:00:00.000Z");
    document(kind, "2026-11-01T02:00:00.000Z");
    const otherOutlet = { ...scope, outletId: randomUUID() },
      otherTenant = { ...scope, orgId: "other-org" };
    document(kind, "2026-11-01T03:00:00.000Z", null, otherOutlet);
    document(kind, "2026-11-01T04:00:00.000Z", null, otherTenant);
    const first = await D.list(scope, "manager", kind, range);
    expect(first.items).toHaveLength(1);
    const cursor = first.nextCursor!;
    for (const [s, k, change] of [
      [otherOutlet, kind, {}],
      [otherTenant, kind, {}],
      [scope, kind === "INV" ? "CN" : "INV", {}],
      [scope, kind, { from: "2026-10-30T00:00:00.000Z" }],
      [scope, kind, { to: "2026-11-03T00:00:00.000Z" }],
      [scope, kind, { businessDayId: randomUUID() }],
      [scope, kind, { q: "different" }],
      [scope, kind, { limit: 2 }],
    ] as const)
      await expect(
        D.list(s, "manager", k, { ...range, ...change, cursor }),
      ).rejects.toThrow();
  });
  test("search matches canonical row fields across all selected partitions", async () => {
    const day = randomUUID(),
      data = document(kind, "2026-10-31T23:59:00.000Z", day);
    for (const q of [
      data.invoiceId,
      data.invoiceId.slice(0, 8),
      "TERRASSE",
      "etage",
      "service",
      ...(kind === "CN" ? ["2C0031", "AV-20261101", "retour"] : []),
    ]) {
      const page = await D.list(scope, "manager", kind, {
        ...range,
        limit: 100,
        businessDayId: day,
        q,
      });
      expect(page.items).toHaveLength(1);
    }
  });
});
test.each([
  ["2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z", true],
  ["2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.001Z", false],
  ["2026-11-02T00:00:00.000Z", "2026-11-01T00:00:00.000Z", false],
  ["bad", "2026-11-01T00:00:00.000Z", false],
])("range %s to %s accepts=%s", (from, to, valid) => {
  expect(
    RestaurantDocumentCollectionRequestSchema.safeParse({ from, to }).success,
  ).toBe(valid);
});
function seed(at: string, label: string) {
  const id = randomUUID();
  const row = D.put(scope, "INV", at, id, {
    ...scope,
    invoiceId: id,
    guestSessionId: randomUUID(),
    issuedAt: at,
    businessDayId: null,
    tableDisplayName: label,
    totalMinor: 900,
    currency: "XOF",
    status: "FINAL",
  }).Put!.Item!;
  db.rows.set(JSON.stringify([row.PK.S, row.SK.S]), row);
  return id;
}
test("monthly history is newest first, cursor/search isolated and does not hydrate rows", async () => {
  seed("2026-10-31T22:00:00.000Z", "Older");
  const id = seed("2026-11-01T22:00:00.000Z", "NOMA");
  const request = {
    from: "2026-10-31T00:00:00.000Z",
    to: "2026-11-02T00:00:00.000Z",
    limit: 1,
  };
  const first = await D.list(scope, "manager", "INV", request);
  expect((first.items[0] as { invoiceId: string }).invoiceId).toBe(id);
  expect(first.nextCursor).toBeTruthy();
  const next = await D.list(scope, "manager", "INV", {
    ...request,
    cursor: first.nextCursor,
  });
  expect(next.items).toHaveLength(1);
  await expect(
    D.list(scope, "manager", "INV", {
      ...request,
      q: "changed",
      cursor: first.nextCursor,
    }),
  ).rejects.toThrow();
});
test("range is bounded and historical empty collections never write", async () => {
  await expect(
    D.list(scope, "manager", "CN", {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-11-01T00:00:00.000Z",
    }),
  ).rejects.toThrow();
  expect(
    (
      await D.list(scope, "manager", "CN", {
        from: "2026-11-01T00:00:00.000Z",
        to: "2026-11-02T00:00:00.000Z",
      })
    ).items,
  ).toEqual([]);
  expect(db.transactions).toHaveLength(0);
});
test("a bounded search may return no matches with continuation, then find an older match", async () => {
  seed("2026-11-01T00:00:00.000Z", "target");
  for (let i = 0; i < 500; i++)
    seed(
      new Date(Date.parse("2026-11-01T01:00:00.000Z") + i).toISOString(),
      "unrelated",
    );
  const request = {
    from: "2026-11-01T00:00:00.000Z",
    to: "2026-11-02T00:00:00.000Z",
    q: "TARGET",
    limit: 100,
  };
  const first = await D.list(scope, "manager", "INV", request);
  expect(first.items).toHaveLength(0);
  expect(first.nextCursor).toBeTruthy();
  const next = await D.list(scope, "manager", "INV", {
    ...request,
    cursor: first.nextCursor,
  });
  expect(next.items).toHaveLength(1);
});
