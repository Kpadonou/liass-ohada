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

import {
  SyntheticFiscalOrchestrator as Orchestrator,
  DefiniteFiscalRejection,
} from "@/lambda/domains/fiscal-compliance/core/synthetic-fiscal-orchestrator";
const principal = { orgId: identity.orgId, actorId: "synthetic-actor" };
const security = {
  dateTime: "synthetic-date",
  qrCode: "synthetic-qr",
  codeMECeFDGI: "synthetic-code",
  counters: "1/1",
  nim: "synthetic-device",
};
function setup() {
  const provider = {
    kind: "MOCK" as const,
    createInvoice: jest.fn(async () => ({
      uid: "synthetic-uid",
      total: 2000,
      reconciled: true,
    })),
    confirmInvoice: jest.fn(async () => security),
    getInvoice: jest.fn(async () => ({ errorCode: "20", type: "NA" })),
  };
  const authorize = jest.fn(async () => {});
  const prepare = jest.fn(async () => ({
    identity,
    sourceDigest: digest,
    requestDigest: digest,
    total: 2000,
    payload: {},
  }));
  const store = new FiscalAttemptStore();
  return {
    store,
    provider,
    authorize,
    prepare,
    orchestration: new Orchestrator(store, provider, authorize, prepare),
  };
}
test("durable CREATE then explicit CONFIRM saves UID and security after reserved intent", async () => {
  const f = setup();
  f.provider.createInvoice.mockImplementationOnce(async () => {
    expect((await f.store.read(identity))?.status).toBe("CREATE_IN_FLIGHT");
    return { uid: "synthetic-uid", total: 2000, reconciled: true };
  });
  await f.orchestration.create(principal, identity, "attempt", "create");
  f.provider.confirmInvoice.mockImplementationOnce(async () => {
    expect((await f.store.read(identity))?.status).toBe("CONFIRM_IN_FLIGHT");
    return security;
  });
  await new Orchestrator(
    new FiscalAttemptStore(),
    f.provider,
    f.authorize,
    f.prepare,
  ).confirm(principal, identity, "confirm", { confirm: true });
  expect(await f.store.read(identity)).toMatchObject({
    status: "CONFIRMED",
    uid: "synthetic-uid",
    security,
  });
  await expect(
    f.orchestration.confirm(principal, identity, "confirm", { confirm: true }),
  ).rejects.toThrow();
  expect(f.provider.confirmInvoice).toHaveBeenCalledTimes(1);
});
test("concurrent and replayed CREATE never dispatch twice", async () => {
  const f = setup();
  await Promise.allSettled([
    f.orchestration.create(principal, identity, "a", "c"),
    f.orchestration.create(principal, identity, "b", "d"),
  ]);
  await expect(
    f.orchestration.create(principal, identity, "a", "c"),
  ).rejects.toThrow();
  expect(f.provider.createInvoice).toHaveBeenCalledTimes(1);
});
test.each(["cross-tenant", "authorization", "preparation"])(
  "blocks %s before dispatch",
  async (reason) => {
    const f = setup();
    if (reason === "authorization")
      f.authorize.mockRejectedValueOnce(new Error("denied"));
    if (reason === "preparation")
      f.prepare.mockRejectedValueOnce(
        new Error("missing classification or provenance"),
      );
    await expect(
      f.orchestration.create(
        reason === "cross-tenant"
          ? { ...principal, orgId: "foreign" }
          : principal,
        identity,
        "a",
        "c",
      ),
    ).rejects.toThrow();
    expect(f.provider.createInvoice).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  },
);
test.each([false, true])(
  "provider uncertainty/rejection is durable and sanitized: definite=%s",
  async (definite) => {
    const f = setup();
    f.provider.createInvoice.mockRejectedValueOnce(
      definite
        ? new DefiniteFiscalRejection("private")
        : new Error("private token"),
    );
    await f.orchestration.create(principal, identity, "a", "c");
    expect((await f.store.read(identity))?.status).toBe(
      definite ? "FAILED" : "UNKNOWN_OUTCOME",
    );
    await expect(
      f.orchestration.create(principal, identity, "b", "d"),
    ).rejects.toThrow();
    expect(f.provider.createInvoice).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([...rows.values()])).not.toContain("private");
  },
);
test("financial mismatch blocks confirmation and leaves no genuine security", async () => {
  const f = setup();
  f.provider.createInvoice.mockResolvedValueOnce({
    uid: "uid",
    total: 1999,
    reconciled: true,
  });
  await f.orchestration.create(principal, identity, "a", "c");
  await expect(
    f.orchestration.confirm(principal, identity, "confirm", { confirm: true }),
  ).rejects.toThrow();
  expect(f.provider.confirmInvoice).not.toHaveBeenCalled();
});
test("known-UID read error20 cannot infer confirmation; interrupted confirm recovers unknown", async () => {
  const f = setup();
  await f.orchestration.create(principal, identity, "a", "c");
  expect(
    (await f.orchestration.reconcile(principal, identity)).statusChanged,
  ).toBe(false);
  expect((await f.store.read(identity))?.status).toBe("CREATED");
  await f.store.transition(identity, 3, {
    kind: "RESERVE_MUTATION",
    operation: "CONFIRM",
    commandId: "confirm",
    intentDigest: digest,
  });
  await f.orchestration.recover(principal, identity, 4);
  await expect(
    f.orchestration.confirm(principal, identity, "confirm", { confirm: true }),
  ).rejects.toThrow();
  expect(f.provider.confirmInvoice).not.toHaveBeenCalled();
  expect((await f.store.read(identity))?.status).toBe("UNKNOWN_OUTCOME");
});
