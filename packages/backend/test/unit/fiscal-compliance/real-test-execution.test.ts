import { GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import {
  restaurantBeninRealTestWorkflow,
  RealTestConfiguration,
} from "@/lambda/domains/restaurants/benin-real-test-workflow";
import { restaurantBeninPreparation } from "@/lambda/domains/restaurants/benin-fiscal-request-mapper";
import { ConfirmationCapture } from "@/lambda/domains/fiscal-compliance/persistence/confirmation-capture";
import { FiscalAttemptStore } from "@/lambda/domains/fiscal-compliance/persistence/fiscal-attempt-store";
import { canonical, hash } from "@/lambda/shared/authority/integrity";
jest.mock("@/lambda/shared/dynamo-client", () => ({
  config: { TABLE_NAME: "platform" },
  dynamoClient: { send: jest.fn() },
}));
jest.mock("@/lambda/domains/restaurants/benin-fiscal-request-mapper", () => ({
  restaurantBeninPreparation: jest.fn(),
}));
const db = dynamoClient.send as jest.Mock;
const s3 = mockClient(S3Client);
const id = "11111111-1111-4111-8111-111111111111";
const totals = {
  ta: 0,
  tb: 18,
  tc: 0,
  td: 18,
  taa: 0,
  tab: 2000,
  tac: 0,
  tad: 0,
  tae: 0,
  taf: 0,
  hab: 1695,
  had: 0,
  vab: 305,
  vad: 0,
  aib: 0,
  ts: 0,
  total: 2000,
};
const config: RealTestConfiguration = {
  orgId: "org",
  operatorUserId: "actor",
  outletId: id,
  sessionId: id,
  invoiceId: id,
  token: "private-token",
  ifu: "seller-ifu",
  nim: "device",
  sourceDigest: "a".repeat(64),
  classifications: [],
  mapping: {},
  expectedFiscalTotals: totals,
};
const identity = {
  orgId: "org",
  environment: "TEST" as const,
  sourceDomain: "restaurants",
  sourceDocumentType: "INVOICE",
  sourceDocumentId: id,
  jurisdiction: "BJ",
  obligation: "NORMALIZE",
};
const principal = { orgId: "org", actorId: "actor" };
const security = {
  dateTime: "07/11/2026 10:00:00",
  qrCode: "private-qr",
  codeMECeFDGI: "private-code",
  counters: "1/1 FV",
  nim: "device",
};
let sequence = 0;
const payload = {
  invoice: {
    reference: "test",
    ifu: "seller-ifu",
    type: "FV",
    operator: { name: "operator" },
    items: [{ name: "Meal", quantity: 2, price: 1000, taxGroup: "B" }],
    payment: [{ name: "ESPECES", amount: 2000 }],
  },
  expected: { itemTotals: [2000], total: 2000 },
};
let rows: Map<string, NonNullable<PutItemCommand["input"]["Item"]>>;
beforeEach(() => {
  Object.assign(process.env, {
    STAGE: "dev",
    FISCAL_EXECUTION_MODE: "REAL_TEST",
    FISCAL_REAL_TEST_ENABLED: "1",
  });
  payload.invoice.reference = `test-${++sequence}`;
  rows = new Map();
  s3.reset();
  s3.on(PutObjectCommand).resolves({});
  db.mockReset();
  db.mockImplementation(async (command: GetItemCommand | PutItemCommand) => {
    if (command instanceof GetItemCommand)
      return { Item: rows.get(JSON.stringify(command.input.Key)) };
    const item = command.input.Item!;
    const key = JSON.stringify({ PK: item.PK, SK: item.SK });
    const old = rows.get(key);
    const version = command.input.ExpressionAttributeValues?.[":version"]?.N;
    if (version === undefined ? Boolean(old) : old?.version.N !== version) {
      const error = new Error("conflict");
      error.name = "ConditionalCheckFailedException";
      throw error;
    }
    rows.set(key, item);
    return {};
  });
  jest
    .mocked(restaurantBeninPreparation)
    .mockReturnValue(async () => ({
      identity,
      sourceDigest: config.sourceDigest,
      requestDigest: hash(canonical(payload)),
      total: 2000,
      ordinaryVatTotals: { net: 1695, tax: 305 },
      payload,
    }));
});
afterEach(() => {
  for (const name of [
    "STAGE",
    "FISCAL_EXECUTION_MODE",
    "FISCAL_REAL_TEST_ENABLED",
  ])
    delete process.env[name];
});
function setup(body: unknown = security, status = 200) {
  const transport = jest.fn(async (request: { method: string }) => ({
    status: request.method === "PUT" ? status : 200,
    body: JSON.stringify(
      request.method === "POST"
        ? { uid: "provider-uid", ...totals }
        : request.method === "PUT"
          ? { ...(body as object), refundWithAibPayment: false }
          : { status: true, ifu: config.ifu, nim: config.nim },
    ),
  }));
  const authorize = jest.fn(async () => undefined);
  const flow = restaurantBeninRealTestWorkflow(
    config,
    authorize,
    new ConfirmationCapture("private-bucket"),
    transport,
  );
  return { flow, transport, authorize };
}
async function create(flow: ReturnType<typeof setup>["flow"]) {
  return flow.create(principal, identity, "attempt", "create");
}
test("captures before validation and persists authentic security separately; replay never sends again", async () => {
  const { flow, transport } = setup();
  await create(flow);
  await flow.confirm(principal, identity, "confirm", { confirm: true });
  const state = await new FiscalAttemptStore().read(identity);
  expect(state).toMatchObject({
    status: "CONFIRMED",
    execution: "REAL_TEST",
    securityEvidenceOrigin: "DGI_TEST",
    security,
    diagnostic: { captured: true },
  });
  const put = s3.commandCalls(PutObjectCommand)[0].args[0].input;
  expect(put).toMatchObject({
    IfNoneMatch: "*",
    ServerSideEncryption: "AES256",
  });
  expect(put.Key).toBe(state?.diagnostic?.reference);
  expect(String(put.Body)).not.toContain(config.token);
  expect(String(put.Body)).toContain("private-qr");
  expect(JSON.stringify(state?.diagnostic)).not.toMatch(
    /private-qr|private-token|private-code|provider-uid/,
  );
  const count = transport.mock.calls.length;
  await expect(
    flow.confirm(principal, identity, "confirm", { confirm: true }),
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(count);
});
test.each([
  [{}, 200],
  [{ errorCode: "20", errorDesc: "private" }, 200],
  [{}, 401],
  [{}, 503],
])(
  "invalid or rejected response is captured and remains unknown",
  async (body, status) => {
    const { flow, transport } = setup(body, status);
    await create(flow);
    await flow.confirm(principal, identity, "confirm", { confirm: true });
    const state = await new FiscalAttemptStore().read(identity);
    expect(state).toMatchObject({
      status: "UNKNOWN_OUTCOME",
      diagnostic: { captured: true, httpStatus: status },
    });
    expect(state?.security).toBeUndefined();
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(1);
    expect(
      transport.mock.calls.filter(([r]) => r.method === "PUT"),
    ).toHaveLength(1);
  },
);
test("S3 failure after confirmation does not claim success or retry", async () => {
  s3.on(PutObjectCommand).rejects(new Error("private AWS failure"));
  const { flow, transport } = setup();
  await create(flow);
  await flow.confirm(principal, identity, "confirm", { confirm: true });
  expect(await new FiscalAttemptStore().read(identity)).toMatchObject({
    status: "UNKNOWN_OUTCOME",
    diagnostic: { captured: false, category: "CAPTURE_FAILURE" },
  });
  expect(transport.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(
    1,
  );
});
test("authorization and default gate reject before any provider mutation", async () => {
  const { flow, transport, authorize } = setup();
  authorize.mockRejectedValueOnce(new Error("denied"));
  await expect(create(flow)).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
  delete process.env.FISCAL_REAL_TEST_ENABLED;
  await expect(create(flow)).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
test("capture enforces size bound and refuses overwrites without exposing AWS details", async () => {
  const capture = new ConfirmationCapture("private-bucket");
  await expect(
    capture.save("a".repeat(64), { status: 200, body: "x".repeat(65537) }),
  ).rejects.toThrow("FISCAL_CAPTURE_INVALID");
  expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
  s3.on(PutObjectCommand).rejects(
    Object.assign(new Error("private AWS failure"), {
      name: "PreconditionFailed",
    }),
  );
  await expect(
    capture.save("a".repeat(64), { status: 200, body: "{}" }),
  ).rejects.toThrow("FISCAL_CAPTURE_FAILED");
});
test("DynamoDB outcome failure leaves durable in-flight reservation for explicit recovery", async () => {
  const { flow, transport } = setup();
  await create(flow);
  const original = db.getMockImplementation()!;
  db.mockImplementation(async (command) => {
    if (
      command instanceof PutItemCommand &&
      unmarshall(command.input.Item!).state.status === "CONFIRMED"
    )
      throw new Error("storage unavailable");
    return original(command);
  });
  await flow.confirm(principal, identity, "confirm", { confirm: true });
  expect(await new FiscalAttemptStore().read(identity)).toMatchObject({
    status: "UNKNOWN_OUTCOME",
    diagnostic: { captured: true },
  });
  expect(transport.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(
    1,
  );
});

test("concurrent initiations reserve a single effect and send only one CREATE", async () => {
  const { flow, transport } = setup();
  const results = await Promise.allSettled([create(flow), create(flow)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    transport.mock.calls.filter(([r]) => r.method === "POST"),
  ).toHaveLength(1);
});
test("lost outcome persistence retains the reference and recovers without HTTP", async () => {
  const { flow, transport } = setup();
  await create(flow);
  const original = db.getMockImplementation()!;
  db.mockImplementation(async (command) => {
    if (
      command instanceof PutItemCommand &&
      ["CONFIRMED", "UNKNOWN_OUTCOME"].includes(
        unmarshall(command.input.Item!).state.status,
      )
    )
      throw new Error("unavailable");
    return original(command);
  });
  await expect(
    flow.confirm(principal, identity, "confirm", { confirm: true }),
  ).rejects.toThrow("FISCAL_OUTCOME_REQUIRES_RECOVERY");
  const state = (await new FiscalAttemptStore().read(identity))!;
  expect(state.status).toBe("CONFIRM_IN_FLIGHT");
  expect(s3.commandCalls(PutObjectCommand)[0].args[0].input.Key).toBe(
    state.diagnostic?.reference,
  );
  db.mockImplementation(original);
  const count = transport.mock.calls.length;
  await flow.recover(principal, identity, state.version);
  expect((await new FiscalAttemptStore().read(identity))?.status).toBe(
    "UNKNOWN_OUTCOME",
  );
  expect(transport).toHaveBeenCalledTimes(count);
});
test("ambiguous transport failure never produces security or repeats confirmation", async () => {
  const { flow, transport } = setup();
  await create(flow);
  transport.mockImplementation(async (request) => {
    if (request.method === "PUT") throw new Error("private network detail");
    return {
      status: 200,
      body: JSON.stringify({ status: true, ifu: config.ifu, nim: config.nim }),
    };
  });
  await flow.confirm(principal, identity, "confirm", { confirm: true });
  expect(await new FiscalAttemptStore().read(identity)).toMatchObject({
    status: "UNKNOWN_OUTCOME",
    diagnostic: { captured: false, category: "TRANSPORT" },
  });
  expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
  expect(transport.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(
    1,
  );
});

test("source fingerprint mismatch is rejected before reservation or provider calls", async () => {
  jest
    .mocked(restaurantBeninPreparation)
    .mockReturnValueOnce(async () => ({
      identity,
      sourceDigest: "b".repeat(64),
      requestDigest: hash(canonical(payload)),
      total: 2000,
      ordinaryVatTotals: { net: 1695, tax: 305 },
      payload,
    }));
  const { flow, transport } = setup();
  await expect(create(flow)).rejects.toThrow("FISCAL_SOURCE_MISMATCH");
  expect(transport).not.toHaveBeenCalled();
  expect(rows.size).toBe(0);
});
test("detailed tax mismatch retains UID and blocks confirmation", async () => {
  const { flow, transport } = setup();
  transport.mockImplementation(async (request) => ({
    status: 200,
    body: JSON.stringify(
      request.method === "POST"
        ? { uid: "provider-uid", ...totals, vab: 999 }
        : { status: true, ifu: config.ifu, nim: config.nim },
    ),
  }));
  await create(flow);
  expect(await new FiscalAttemptStore().read(identity)).toMatchObject({
    status: "CREATED",
    uid: "provider-uid",
    fiscalTotalsVerified: false,
  });
  await expect(
    flow.confirm(principal, identity, "confirm", { confirm: true }),
  ).rejects.toThrow();
  expect(transport.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(
    0,
  );
});
test("security from a different NIM is captured but never certified", async () => {
  const { flow } = setup({ ...security, nim: "foreign-device" });
  await create(flow);
  await flow.confirm(principal, identity, "confirm", { confirm: true });
  expect(await new FiscalAttemptStore().read(identity)).toMatchObject({
    status: "UNKNOWN_OUTCOME",
    diagnostic: { captured: true, category: "RESPONSE_VALIDATION" },
  });
  expect(
    (await new FiscalAttemptStore().read(identity))?.security,
  ).toBeUndefined();
});

test("preflight failure records that confirmation was not sent and still forbids redispatch", async () => {
  const { flow, transport } = setup();
  await create(flow);
  transport.mockImplementation(async () => ({ status: 401, body: "{}" }));
  await flow.confirm(principal, identity, "confirm", { confirm: true });
  expect(await new FiscalAttemptStore().read(identity)).toMatchObject({
    status: "UNKNOWN_OUTCOME",
    diagnostic: {
      mutationMayHaveExecuted: false,
      category: "AUTHENTICATION",
      httpStatus: 401,
    },
  });
  expect(transport.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(
    0,
  );
  const count = transport.mock.calls.length;
  await expect(
    flow.confirm(principal, identity, "confirm", { confirm: true }),
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(count);
});
