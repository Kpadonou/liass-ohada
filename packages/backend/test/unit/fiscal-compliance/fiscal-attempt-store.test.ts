import { GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { FiscalAttemptStore } from "@/lambda/domains/fiscal-compliance/persistence/fiscal-attempt-store";
jest.mock("@/lambda/shared/dynamo-client", () => ({
  config: { TABLE_NAME: "synthetic" },
  dynamoClient: { send: jest.fn() },
}));
const send = dynamoClient.send as jest.Mock;
const identity = {
  orgId: "synthetic-org",
  environment: "TEST" as const,
  sourceDomain: "synthetic",
  sourceDocumentType: "INVOICE",
  sourceDocumentId: "invoice",
  jurisdiction: "BJ",
  obligation: "NORMALIZE",
};
const digest = "a".repeat(64);
const input = {
  identity,
  attemptId: "attempt",
  provider: "MOCK",
  sourceDigest: digest,
  requestDigest: digest,
  expectedTotal: 2000,
};
const command = {
  kind: "RESERVE_MUTATION" as const,
  operation: "CREATE" as const,
  commandId: "create",
  intentDigest: digest,
};
let rows: Map<string, NonNullable<PutItemCommand["input"]["Item"]>>;
const address = (key: object) => JSON.stringify(key);
beforeEach(() => {
  process.env.FISCAL_SYNTHETIC_STORAGE = "1";
  rows = new Map();
  send.mockReset();
  send.mockImplementation(async (c: GetItemCommand | PutItemCommand) => {
    if (c instanceof GetItemCommand)
      return { Item: rows.get(address(c.input.Key!)) };
    const row = c.input.Item!;
    const key = address({ PK: row.PK, SK: row.SK });
    const old = rows.get(key);
    const expected = c.input.ExpressionAttributeValues?.[":version"]?.N;
    if (expected === undefined ? Boolean(old) : old?.version.N !== expected) {
      const e = new Error("synthetic sensitive error must not escape");
      e.name = "ConditionalCheckFailedException";
      throw e;
    }
    rows.set(key, row);
    return {};
  });
});
afterEach(() => {
  delete process.env.FISCAL_SYNTHETIC_STORAGE;
});
test("concurrent provider-independent reservation allows exactly one winner", async () => {
  const store = new FiscalAttemptStore();
  const outcomes = await Promise.allSettled([
    store.reserve(input),
    store.reserve({ ...input, provider: "OTHER", attemptId: "other" }),
  ]);
  expect(outcomes.filter((v) => v.status === "fulfilled")).toHaveLength(1);
  expect(rows.size).toBe(1);
});
test("command intent survives restart; replay never grants dispatch", async () => {
  const store = new FiscalAttemptStore();
  await store.reserve(input);
  await store.transition(identity, 1, command);
  const restarted = new FiscalAttemptStore();
  expect((await restarted.transition(identity, 1, command)).replay).toBe(true);
  await expect(
    restarted.transition(identity, 2, {
      ...command,
      intentDigest: "b".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "INTENT_CONFLICT" });
  await expect(
    restarted.transition(identity, 1, { ...command, commandId: "other" }),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
});
test("concurrent CREATE and CONFIRM reservations have one winner; UID is durable", async () => {
  const store = new FiscalAttemptStore();
  await store.reserve(input);
  const create = await Promise.allSettled([
    store.transition(identity, 1, command),
    store.transition(identity, 1, { ...command, commandId: "other" }),
  ]);
  expect(create.filter((v) => v.status === "fulfilled")).toHaveLength(1);
  const active = (await store.read(identity))!.activeCommandId!;
  await store.transition(identity, 2, {
    kind: "CREATED",
    commandId: active,
    uid: "synthetic-uid",
    total: 2000,
  });
  expect(
    (await new FiscalAttemptStore().reconciliationRead(identity)).uid,
  ).toBe("synthetic-uid");
  const confirm = {
    ...command,
    operation: "CONFIRM" as const,
    commandId: "confirm",
  };
  const outcomes = await Promise.allSettled([
    store.transition(identity, 3, confirm),
    store.transition(identity, 3, {
      ...confirm,
      operation: "CANCEL",
      commandId: "cancel",
    }),
  ]);
  expect(outcomes.filter((v) => v.status === "fulfilled")).toHaveLength(1);
});
test("interrupted CREATE becomes unknown, never automatically recreates", async () => {
  const store = new FiscalAttemptStore();
  await store.reserve(input);
  await store.transition(identity, 1, command);
  await new FiscalAttemptStore().recover(identity, 2);
  expect((await store.read(identity))?.status).toBe("UNKNOWN_OUTCOME");
  await expect(
    store.transition(identity, 3, { ...command, commandId: "replacement" }),
  ).rejects.toMatchObject({ code: "TRANSITION_DENIED" });
  await expect(store.reconciliationRead(identity)).rejects.toMatchObject({
    code: "UID_REQUIRED",
  });
});
test("foreign tenant cannot read source; production and credential fields rejected", async () => {
  const store = new FiscalAttemptStore();
  await store.reserve(input);
  expect(await store.read({ ...identity, orgId: "other" })).toBeUndefined();
  await expect(
    store.reserve({
      ...input,
      identity: { ...identity, environment: "PRODUCTION" as "TEST" },
    }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(
    store.reserve({ ...input, token: "never-store" } as typeof input),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(
    JSON.stringify([...rows.values()].map((v) => unmarshall(v))),
  ).not.toContain("never-store");
});
test("uncertain persisted write is sanitized and resolved by strong read without retry", async () => {
  const store = new FiscalAttemptStore();
  await store.reserve(input);
  const normal = send.getMockImplementation()!;
  send.mockImplementationOnce(normal).mockImplementationOnce(async (c) => {
    await normal(c);
    throw new Error("secret-body");
  });
  await expect(store.transition(identity, 1, command)).rejects.toThrow(
    "FISCAL_STORAGE_OUTCOME_UNKNOWN",
  );
  expect((await store.read(identity))?.status).toBe("CREATE_IN_FLIGHT");
  expect((await store.transition(identity, 1, command)).replay).toBe(true);
});
test("cancelled write leaves prior durable revision unchanged", async () => {
  const store = new FiscalAttemptStore();
  await store.reserve(input);
  const normal = send.getMockImplementation()!;
  send
    .mockImplementationOnce(normal)
    .mockRejectedValueOnce(
      Object.assign(new Error("private"), {
        name: "TransactionCanceledException",
      }),
    );
  await expect(store.transition(identity, 1, command)).rejects.toThrow(
    "FISCAL_STORAGE_OUTCOME_UNKNOWN",
  );
  expect((await store.read(identity))?.version).toBe(1);
});
