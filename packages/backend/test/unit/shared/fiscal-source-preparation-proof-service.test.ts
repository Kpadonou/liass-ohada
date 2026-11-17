import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
  type TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { FiscalSourcePreparationProofService as Service } from "@/lambda/shared/services/fiscal-source-preparation-proof-service";

const db = mockClient(DynamoDBClient);
const rows = new Map<string, Record<string, unknown>>();
const key = (value: Record<string, unknown>) => JSON.stringify([value.PK, value.SK]);
const orgId = "org-a";
const input = () => ({
  orgId,
  outletId: "76d54ba2-ee98-4373-8d3f-567920e91a73",
  operatorUserId: "2189c04e-00f1-402c-98e5-c38569e8974e",
  sessionId: "62f61225-43ce-45bf-8381-8474fd9b8ab9",
  invoiceId: "60a509af-e385-4185-b86c-bf60be6c7b57",
  sourceDigest: "a".repeat(64),
  sourceVersion: 7,
  financialRevision: 2,
  sellerAuthorityDigest: "b".repeat(64),
  scenarioId: "02",
  fiscalGroups: ["B"] as const,
  fiscalMapping: { environment: "TEST", invoiceType: "FV" },
  expectedFiscalTotals: {
    ta: 0, tb: 18, tc: 0, td: 18, taa: 0, tab: 2360, tac: 0, tad: 0,
    tae: 0, taf: 0, hab: 2000, had: 0, vab: 360, vad: 0, aib: 0, ts: 0,
    total: 2360,
  },
  operations: { CREATE: 1, GET: 2, CONFIRM: 1, CANCEL: 1 },
  expiresAt: "2026-11-17T10:30:00.000Z",
  commandId: "fb7ea76f-3b16-4e45-83f2-5fbc90c2d770",
});

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-11-17T10:00:00.000Z"));
  process.env.PLATFORM_TABLE_NAME = "platform-test";
  rows.clear();
  db.reset();
  db.on(GetItemCommand).callsFake(async (request) => {
    const item = rows.get(key(unmarshall(request.Key!)));
    return item ? { Item: marshall(item) } : {};
  });
  db.on(TransactWriteItemsCommand).callsFake(async (request) => {
    const puts: Record<string, unknown>[] = request.TransactItems!.map(
      (item: TransactWriteItem) => unmarshall(item.Put!.Item!) as Record<string, unknown>,
    );
    if (puts.some((item) => rows.has(key(item)))) throw new Error("conditional conflict");
    puts.forEach((item) => rows.set(key(item), item));
    return {};
  });
  db.on(UpdateItemCommand).callsFake(async (request) => {
    const rowKey = key(unmarshall(request.Key!));
    const row = rows.get(rowKey) as { entityType: string; orgId: string; data: Record<string, unknown> } | undefined;
    const values = unmarshall(request.ExpressionAttributeValues!);
    if (!row || row.entityType !== values[":type"] || row.orgId !== values[":org"] ||
      row.data.status !== values[":prepared"] ||
      JSON.stringify(row.data) !== JSON.stringify(values[":proof"]) ||
      Date.parse(String(row.data.expiresAt)) <= Date.parse(String(values[":now"])))
      throw new Error("conditional conflict");
    row.data = { ...row.data, status: values[":consumed"], consumedAt: values[":now"], consumedBy: values[":actor"] };
    rows.set(rowKey, row);
    return {};
  });
});
afterEach(() => jest.useRealTimers());

test("creates an immutable tenant proof and exact command replay returns it", async () => {
  const first = await Service.create(input());
  const replay = await Service.create(input());
  expect(replay).toEqual(first);
  expect(first.status).toBe("PREPARED");
  expect(first.orgId).toBe(orgId);
  expect(first.proofDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(1);
  const persisted = [...rows.values()];
  expect(persisted.map((row) => row.entityType).sort()).toEqual([
    "PLATFORM_FISCAL_SOURCE_PREPARATION_PROOF",
    "PLATFORM_FISCAL_SOURCE_PREPARATION_PROOF_COMMAND",
  ]);
});

test("rejects command replay with different evidence", async () => {
  await Service.create(input());
  await expect(Service.create({ ...input(), sourceDigest: "c".repeat(64) }))
    .rejects.toMatchObject({ statusCode: 409, messageCode: "FISCAL_COMMAND_CONFLICT" });
});

test("conditionally consumes once and rejects replay, wrong tenant and wrong digest", async () => {
  const proof = await Service.create(input());
  const approverUserId = "9e7e0aee-a0bf-45c5-a698-ea7f4f01bfa8";
  await expect(Service.consume({ orgId: "org-b", proofId: proof.proofId, proofDigest: proof.proofDigest, approverUserId }))
    .rejects.toMatchObject({ statusCode: 409 });
  await expect(Service.consume({ orgId, proofId: proof.proofId, proofDigest: "d".repeat(64), approverUserId }))
    .rejects.toMatchObject({ statusCode: 409 });
  const consumed = await Service.consume({ orgId, proofId: proof.proofId, proofDigest: proof.proofDigest, approverUserId });
  expect(consumed).toMatchObject({ status: "CONSUMED", consumedBy: approverUserId });
  await expect(Service.consume({ orgId, proofId: proof.proofId, proofDigest: proof.proofDigest, approverUserId }))
    .rejects.toMatchObject({ statusCode: 409 });
});

test("rejects expired proof before any conditional write", async () => {
  const proof = await Service.create({ ...input(), expiresAt: "2026-11-17T10:00:01.000Z" });
  jest.setSystemTime(new Date("2026-11-17T10:00:02.000Z"));
  await expect(Service.consume({
    orgId, proofId: proof.proofId, proofDigest: proof.proofDigest,
    approverUserId: "9e7e0aee-a0bf-45c5-a698-ea7f4f01bfa8",
  })).rejects.toMatchObject({ statusCode: 409 });
  expect(db.commandCalls(UpdateItemCommand)).toHaveLength(0);
});

test("rejects persisted evidence whose immutable payload no longer matches its digest", async () => {
  const proof = await Service.create(input());
  const record = [...rows.values()].find((row) =>
    row.entityType === "PLATFORM_FISCAL_SOURCE_PREPARATION_PROOF",
  ) as { data: Record<string, unknown> };
  record.data = { ...record.data, sourceVersion: 8 };
  await expect(Service.read(orgId, proof.proofId)).rejects.toMatchObject({ statusCode: 409 });
});

test("concurrent same-command creation establishes one proof", async () => {
  const [first, second] = await Promise.all([Service.create(input()), Service.create(input())]);
  expect(second).toEqual(first);
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(2);
  expect([...rows.values()].filter((row) => row.entityType === "PLATFORM_FISCAL_SOURCE_PREPARATION_PROOF")).toHaveLength(1);
});
