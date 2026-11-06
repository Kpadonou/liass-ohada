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

import { SyntheticFiscalOrchestrator } from "@/lambda/domains/fiscal-compliance/core/synthetic-fiscal-orchestrator";
import { DurableBeninBinding } from "@/lambda/domains/fiscal-compliance/providers/benin-emecef/durable-benin-binding";
import { BeninEMecefTestAdapter } from "@/lambda/domains/fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter";
import { canonical, clean } from "@/lambda/shared/authority/integrity";
import { createHash } from "node:crypto";
const principal = { orgId: identity.orgId, actorId: "synthetic-actor" };
const security = {
  dateTime: "synthetic-date",
  qrCode: "synthetic-qr",
  codeMECeFDGI: "synthetic-code",
  counters: "1/1",
  nim: "synthetic-device",
};
let sequence = 0;
function setup() {
  const payload = {
    invoice: {
      ifu: "synthetic-ifu",
      operator: { name: "Synthetic operator" },
      type: "FV",
      reference: `durable-${++sequence}`,
      items: [{ name: "Synthetic", price: 1000, quantity: 2, taxGroup: "B" }],
      payment: [{ name: "ESPECES", amount: 2000 }],
    },
    expected: { itemTotals: [2000], total: 2000 },
  };
  const requestDigest = createHash("sha256")
    .update(canonical(clean(payload)))
    .digest("hex");
  const transport = jest.fn(async (request: { method: string }) => ({
    status: 200,
    body: JSON.stringify(
      request.method === "POST"
        ? { uid: "synthetic-uid", total: 2000 }
        : security,
    ),
  }));
  const prepare = async () => ({
    identity,
    sourceDigest: digest,
    requestDigest,
    total: 2000,
    payload,
  });
  const authorize = jest.fn(async () => {});
  const instance = () =>
    new SyntheticFiscalOrchestrator(
      new FiscalAttemptStore(),
      new DurableBeninBinding(
        new BeninEMecefTestAdapter({ transport }),
        () => "synthetic-token",
      ),
      authorize,
      prepare,
    );
  return { transport, instance, authorize };
}
test("fresh adapter and orchestrator confirm durable CREATED evidence without GET or capability", async () => {
  const f = setup();
  await f.instance().create(principal, identity, "attempt", "create");
  expect((await new FiscalAttemptStore().read(identity))?.status).toBe(
    "CREATED",
  );
  await f.instance().confirm(principal, identity, "confirm", { confirm: true });
  expect((await new FiscalAttemptStore().read(identity))?.security).toEqual(
    security,
  );
  expect(f.transport.mock.calls.map(([r]) => r.method)).toEqual([
    "POST",
    "PUT",
  ]);
  await expect(
    f.instance().confirm(principal, identity, "confirm", { confirm: true }),
  ).rejects.toThrow();
  await expect(
    f.instance().create(principal, identity, "attempt", "create"),
  ).rejects.toThrow();
  expect(f.transport.mock.calls[1][0]).toHaveProperty("body", undefined);
  expect(f.transport).toHaveBeenCalledTimes(2);
  expect(JSON.stringify([...rows.values()])).not.toContain("synthetic-token");
});
test("lost confirmation response blocks every subsequent PUT across restart", async () => {
  const f = setup();
  await f.instance().create(principal, identity, "attempt", "create");
  f.transport.mockRejectedValueOnce(new Error("synthetic timeout"));
  await f.instance().confirm(principal, identity, "confirm", { confirm: true });
  expect((await new FiscalAttemptStore().read(identity))?.status).toBe(
    "UNKNOWN_OUTCOME",
  );
  await expect(
    f.instance().confirm(principal, identity, "new-confirm", { confirm: true }),
  ).rejects.toThrow();
  expect(f.transport).toHaveBeenCalledTimes(2);
});
test("interrupted confirmation is recoverable only as unknown, with no HTTP", async () => {
  const f = setup();
  await f.instance().create(principal, identity, "attempt", "create");
  const store = new FiscalAttemptStore();
  await store.transition(identity, 3, {
    kind: "RESERVE_MUTATION",
    operation: "CONFIRM",
    commandId: "confirm",
    intentDigest: digest,
  });
  await f.instance().recover(principal, identity, 4);
  await expect(
    f.instance().confirm(principal, identity, "another", { confirm: true }),
  ).rejects.toThrow();
  expect(f.transport).toHaveBeenCalledTimes(1);
});
test("fresh authorization denies foreign or revoked confirmation before HTTP", async () => {
  const f = setup();
  await f.instance().create(principal, identity, "attempt", "create");
  await expect(
    f.instance().confirm({ ...principal, orgId: "other" }, identity, "c", {
      confirm: true,
    }),
  ).rejects.toThrow();
  f.authorize.mockRejectedValueOnce(new Error("revoked"));
  await expect(
    f.instance().confirm(principal, identity, "c", { confirm: true }),
  ).rejects.toThrow();
  expect(f.transport).toHaveBeenCalledTimes(1);
});

test("uncertain POST cannot be repeated by a new adapter instance", async () => {
  const f = setup();
  f.transport.mockRejectedValueOnce(new Error("timeout"));
  await f.instance().create(principal, identity, "a", "create");
  expect((await new FiscalAttemptStore().read(identity))?.status).toBe(
    "UNKNOWN_OUTCOME",
  );
  await expect(
    f.instance().create(principal, identity, "b", "replacement"),
  ).rejects.toThrow();
  expect(f.transport).toHaveBeenCalledTimes(1);
});
