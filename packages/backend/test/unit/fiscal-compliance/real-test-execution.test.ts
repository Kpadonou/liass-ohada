import { RestaurantFiscalApplicationService } from "@/lambda/domains/restaurants/fiscal-application-service";
import { RestaurantReceiptService } from "@/lambda/domains/restaurants/receipt-service";
import { RestaurantInvoiceSourceVerifier } from "@/lambda/domains/restaurants/invoice-source-verifier";
import { RestaurantFiscalResultResponseSchema } from "@liass-ohada/shared/restaurants";
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
      fiscalGroupTotals: { B: { gross: 2000, net: 1695, tax: 305 } },
      fiscalAdditionalTotals: { aib: 0, ts: 0 },
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
function setup(body: unknown = security, status = 200, options?: {
  fiscalTotals?: typeof totals;
  configuration?: RealTestConfiguration;
}) {
  const fiscalTotals = options?.fiscalTotals ?? totals;
  const configuration = options?.configuration ?? config;
  let postedInvoice: unknown;
  const transport = jest.fn(async (request: { method: string; body?: string; url: string }) => ({
    status: request.method === "PUT" ? status : 200,
    body: JSON.stringify(
      request.method === "POST"
        ? (postedInvoice = JSON.parse(request.body!), { uid: "provider-uid", ...fiscalTotals })
        : request.method === "PUT"
          ? { ...(body as object), refundWithAibPayment: false }
          : request.url.endsWith("/api/invoice")
            ? { pendingRequestsCount: 1, pendingRequestsList: [
                { date: "2026-11-17T10:00:00Z", uid: "provider-uid" },
              ] }
          : request.url.includes("/api/invoice/")
            ? postedInvoice
            : { status: true, ifu: configuration.ifu, nim: configuration.nim },
    ),
  }));
  const authorize = jest.fn(async () => undefined);
  const flow = restaurantBeninRealTestWorkflow(
    configuration,
    authorize,
    new ConfirmationCapture("private-bucket"),
    transport,
  );
  return { flow, transport, authorize };
}
test("bound commands preserve the immutable policy through durable confirmation", async () => {
  const fiscalBinding = { environment: "TEST" as const, connectionId: config.outletId, policyVersion: 4 };
  const { flow, transport } = setup(security, 200, { configuration: { ...config, fiscalBinding } });
  await create(flow);
  await flow.reconcile(principal, identity);
  const other = setup(security, 200, { configuration: { ...config, fiscalBinding: { ...fiscalBinding, policyVersion: 5 } } });
  await expect(other.flow.confirm(principal, identity, "wrong-policy", { confirm: true })).rejects.toThrow();
  expect(other.transport).not.toHaveBeenCalled();
  await flow.confirm(principal, identity, "confirm", { confirm: true });
  expect(await new FiscalAttemptStore().read(identity)).toMatchObject({ status: "CONFIRMED", fiscalBinding,
    uid: "provider-uid", securityEvidenceOrigin: "DGI_TEST" });
  expect(transport.mock.calls.filter(([request]) => request.method === "POST")).toHaveLength(1);
});
test("classified A and B lines complete the durable real TEST journey without the legacy single-line projection", async () => {
  const mixedTotals = { ...totals, taa: 1000, tab: 2000, total: 3000 };
  const mixedPayload = {
    invoice: {
      ...payload.invoice,
      items: [
        { name: "Exempt meal", quantity: 1, price: 1000, taxGroup: "A" },
        { name: "Taxable meal", quantity: 2, price: 1000, taxGroup: "B" },
      ],
      payment: [{ name: "ESPECES", amount: 3000 }],
    },
    expected: { itemTotals: [1000, 2000], total: 3000 },
  };
  jest.mocked(restaurantBeninPreparation).mockReturnValue(async () => ({
    identity,
    sourceDigest: config.sourceDigest,
    requestDigest: hash(canonical(mixedPayload)),
    total: 3000,
    fiscalGroupTotals: {
      A: { gross: 1000, net: 1000, tax: 0 },
      B: { gross: 2000, net: 1695, tax: 305 },
    },
    fiscalAdditionalTotals: { aib: 0, ts: 0 },
    payload: mixedPayload,
  }));
  const { flow, transport } = setup(security, 200, {
    fiscalTotals: mixedTotals,
    configuration: { ...config, expectedFiscalTotals: mixedTotals },
  });
  expect((await create(flow)).state.status).toBe("CREATED");
  await flow.confirm(principal, identity, "confirm", { confirm: true });
  expect(await new FiscalAttemptStore().read(identity)).toMatchObject({
    status: "CONFIRMED",
    fiscalTotalsVerified: true,
    securityEvidenceOrigin: "DGI_TEST",
  });
  expect(transport.mock.calls.filter(([request]) => request.method === "POST")).toHaveLength(1);
  expect(transport.mock.calls.filter(([request]) => request.method === "PUT")).toHaveLength(1);
});
test.each([
  { scenario: "16", groups: ["C"] as const, quantities: [2] },
  { scenario: "17", groups: ["A", "C"] as const, quantities: [2, 3] },
  { scenario: "19", groups: ["E"] as const, quantities: [2] },
])("DGI scenario $scenario: EV completes durable CREATE/CONFIRM with exact groups and quantities", async ({ scenario, groups, quantities }) => {
  const items = groups.map((group, index) => ({
    name: `Export ${group}`,
    quantity: quantities[index],
    price: 1000,
    taxGroup: group,
  }));
  const total = quantities.reduce((sum, quantity) => sum + quantity * 1000, 0);
  const exportPayload = {
    invoice: { ...payload.invoice, type: "EV", items,
      payment: [{ name: "ESPECES", amount: total }] },
    expected: { itemTotals: quantities.map(quantity => quantity * 1000), total },
  };
  const expectedFiscalTotals = { ...totals, tab: 0, hab: 0, vab: 0,
    taa: groups.includes("A" as never) ? 2000 : 0,
    tac: groups.includes("C" as never) ? quantities[groups.indexOf("C" as never)] * 1000 : 0,
    tae: groups.includes("E" as never) ? 2000 : 0,
    total };
  jest.mocked(restaurantBeninPreparation).mockReturnValue(async () => ({
    identity: { ...identity, sourceDocumentId: id },
    sourceDigest: config.sourceDigest,
    requestDigest: hash(canonical(exportPayload)),
    total,
    fiscalGroupTotals: Object.fromEntries(groups.map((group, index) => [group,
      { gross: quantities[index] * 1000, net: quantities[index] * 1000, tax: 0 }])),
    fiscalAdditionalTotals: { aib: 0, ts: 0 },
    payload: exportPayload,
  }));
  const { flow, transport } = setup({ ...security, counters: `1/1 EV ${scenario}` }, 200, {
    fiscalTotals: expectedFiscalTotals,
    configuration: { ...config, expectedFiscalTotals },
  });
  expect((await create(flow)).state.status).toBe("CREATED");
  await flow.confirm(principal, identity, `confirm-${scenario}`, { confirm: true });
  expect(await new FiscalAttemptStore().read(identity)).toMatchObject({
    status: "CONFIRMED", fiscalTotalsVerified: true, securityEvidenceOrigin: "DGI_TEST",
  });
  expect(JSON.parse(transport.mock.calls.find(([request]) => request.method === "POST")![0].body!))
    .toMatchObject(exportPayload.invoice);
  expect(transport.mock.calls.filter(([request]) => request.method === "POST")).toHaveLength(1);
  expect(transport.mock.calls.filter(([request]) => request.method === "PUT")).toHaveLength(1);
});
test.each([
  { scenario: "06", type: "FA" as const, groups: ["A", "B"] as const,
    quantities: [2, 3], prices: [1000, 1180], originalType: "FV" as const },
  { scenario: "18", type: "EA" as const, groups: ["C"] as const,
    quantities: [2], prices: [1000], originalType: "EV" as const },
  { scenario: "20", type: "EA" as const, groups: ["E"] as const,
    quantities: [2], prices: [1000], originalType: "EV" as const },
])("scenario $scenario stores a distinct confirmed $type attempt and original reference", async (v) => {
  const total = v.quantities.reduce((sum, quantity, index) => sum + quantity * v.prices[index], 0);
  const creditIdentity = { ...identity, sourceDocumentType: "CREDIT_NOTE", sourceDocumentId: id };
  const creditPayload = { invoice: { ifu: config.ifu, type: v.type,
    reference: "A".repeat(24), operator: { name: "operator" },
    client: { name: "Client identifié", ifu: "1234567890123" },
    items: v.groups.map((group, index) => ({ name: `Credit ${group}`,
      price: v.prices[index], quantity: v.quantities[index], taxGroup: group })) },
    expected: { itemTotals: v.quantities.map((quantity, index) => quantity * v.prices[index]), total } };
  const groupTotals = Object.fromEntries(v.groups.map((group, index) => {
    const gross = v.quantities[index] * v.prices[index];
    const tax = group === "B" ? 540 : 0;
    return [group, { gross, net: gross - tax, tax }];
  }));
  const expectedFiscalTotals = { ...totals, taa: groupTotals.A?.gross ?? 0,
    tab: groupTotals.B?.gross ?? 0, tac: groupTotals.C?.gross ?? 0,
    tae: groupTotals.E?.gross ?? 0, hab: groupTotals.B?.net ?? 0,
    vab: groupTotals.B?.tax ?? 0, total };
  jest.mocked(restaurantBeninPreparation).mockReturnValue(async () => ({
    identity: creditIdentity, sourceDigest: config.sourceDigest,
    requestDigest: hash(canonical(creditPayload)), total, fiscalGroupTotals: groupTotals,
    fiscalAdditionalTotals: { aib: 0, ts: 0 }, payload: creditPayload,
  }));
  const { flow, transport } = setup({ ...security, codeMECeFDGI: "C".repeat(24) }, 200, {
    fiscalTotals: expectedFiscalTotals,
    configuration: { ...config, creditNoteId: id, expectedFiscalTotals },
  });
  expect((await flow.create(principal, creditIdentity, `attempt-${v.scenario}`, `create-${v.scenario}`)).state)
    .toMatchObject({ status: "CREATED", fiscalDocumentType: v.type });
  await flow.confirm(principal, creditIdentity, `confirm-${v.scenario}`, { confirm: true });
  expect(await new FiscalAttemptStore().read(creditIdentity)).toMatchObject({
    status: "CONFIRMED", fiscalDocumentType: v.type,
    securityEvidenceOrigin: "DGI_TEST", security: { codeMECeFDGI: "C".repeat(24) },
  });
  expect(JSON.parse(transport.mock.calls.find(([request]) => request.method === "POST")![0].body!))
    .toMatchObject({ type: v.type, reference: "A".repeat(24), client: { ifu: "1234567890123" } });
  expect(transport.mock.calls.filter(([request]) => request.method === "POST")).toHaveLength(1);
  expect(transport.mock.calls.filter(([request]) => request.method === "PUT")).toHaveLength(1);
});
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
  const access = jest.spyOn(RestaurantReceiptService, "authorize").mockResolvedValue({ actions: [], role: "OWNER" });
  const source = jest.spyOn(RestaurantInvoiceSourceVerifier, "verify").mockResolvedValue({ verified: true,
    evidence: { proof: { digest: config.sourceDigest }, issuanceProvenance: { verified: true,
      evidence: { evidenceOrigin: "AUTHENTIC" } } } } as never);
  try {
    const application = new RestaurantFiscalApplicationService(async () => { throw new Error("No provider settings needed for reads"); }, true);
    const result = RestaurantFiscalResultResponseSchema.parse(await application.confirmedResult(
      { orgId: config.orgId, userId: config.operatorUserId },
      { outletId: config.outletId, sessionId: config.sessionId, invoiceId: config.invoiceId },
    ));
    expect(result.securityElements).toEqual(security);
    expect(result.legallyNormalized).toBe(false);
  } finally { access.mockRestore(); source.mockRestore(); }
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
      body: JSON.stringify(request.url.includes("/api/invoice/")
        ? payload.invoice : { status: true, ifu: config.ifu, nim: config.nim }),
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
      fiscalGroupTotals: { B: { gross: 2000, net: 1695, tax: 305 } },
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
    calculationReconciliation: { status: "MISMATCH", phase: "CREATE",
      differences: [{ field: "vab", expected: 305, actual: 999 }] },
  });
  await expect(
    flow.confirm(principal, identity, "confirm", { confirm: true }),
  ).rejects.toThrow();
  expect(transport.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(
    0,
  );
});
test("provider GET field mismatch is durable before any CONFIRM reservation", async () => {
  const { flow, transport } = setup();
  await create(flow);
  transport.mockImplementation(async request => ({ status: 200, body: JSON.stringify(
    request.url.includes("/api/invoice/provider-uid")
      ? { ...payload.invoice, items: [{ ...payload.invoice.items[0], taxGroup: "A" }] }
      : { status: true, ifu: config.ifu, nim: config.nim },
  ) }));
  await expect(flow.confirm(principal, identity, "confirm", { confirm: true }))
    .rejects.toThrow();
  expect(await new FiscalAttemptStore().read(identity)).toMatchObject({
    status: "CREATED", uid: "provider-uid", fiscalTotalsVerified: false,
    detailMismatchFields: ["items[0].taxGroup"],
  });
  expect(transport.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(0);
  expect(transport.mock.calls.filter(([r]) => r.method === "POST")).toHaveLength(1);
});
test("authorized reconciliation verifies the owned pending UID without changing durable state", async () => {
  const { flow, transport } = setup();
  await create(flow);
  const result = await flow.reconcile(principal, identity);
  expect(result.statusChanged).toBe(false);
  expect(await new FiscalAttemptStore().read(identity)).toMatchObject({
    status: "CREATED", uid: "provider-uid",
  });
  expect(transport.mock.calls.filter(([r]) => r.method === "GET" &&
    r.url.includes("/api/invoice/provider-uid"))).toHaveLength(1);
  expect(transport.mock.calls.filter(([r]) => r.method === "GET" &&
    r.url.endsWith("/api/invoice"))).toHaveLength(0);
  expect(transport.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(0);
});
test("reconciliation rejects mismatched provider details and wrong ownership without mutation", async () => {
  const { flow, transport, authorize } = setup();
  await create(flow);
  transport.mockImplementation(async (request) => ({ status: 200, body: JSON.stringify(
    request.url.endsWith("/api/invoice") ? { pendingRequestsCount: 1,
      pendingRequestsList: [{ date: "2026-11-17T10:00:00Z", uid: "provider-uid" }] } :
    request.url.includes("/api/invoice/") ? { ...payload.invoice, reference: "foreign" } :
      { status: true, ifu: config.ifu, nim: config.nim },
  ) }));
  await expect(flow.reconcile(principal, identity)).rejects.toThrow("FISCAL_RECONCILIATION_UNAVAILABLE");
  authorize.mockRejectedValueOnce(new Error("denied"));
  await expect(flow.reconcile(principal, identity)).rejects.toThrow("denied");
  expect((await new FiscalAttemptStore().read(identity))?.status).toBe("CREATED");
  expect(transport.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(0);
});
test("provider GET failure leaves the attempt unchanged and cannot unlock cancellation", async () => {
  const diagnostic = jest.spyOn(console, "error").mockImplementation(() => {});
  const { flow, transport } = setup();
  await create(flow);
  transport.mockImplementation(async (request) => {
    if (request.url.includes("/api/invoice/"))
      return { status: 503, body: "{}" };
    return { status: 200, body: JSON.stringify({ status: true, ifu: config.ifu, nim: config.nim }) };
  });
  await expect(flow.reconcile(principal, identity)).rejects.toThrow("FISCAL_RECONCILIATION_UNAVAILABLE");
  expect(diagnostic).toHaveBeenCalledWith(JSON.stringify({
    event: "FISCAL_TEST_RECONCILIATION_FAILED", invoiceId: config.invoiceId,
    environment: "TEST", code: "UNEXPECTED_HTTP_STATUS", httpStatus: 503,
  }));
  await expect(flow.cancel(principal, identity, "cancel-after-read-error", {
    cancel: true, determination: "VERIFIED_PENDING_TEST",
  })).rejects.toThrow();
  expect((await new FiscalAttemptStore().read(identity))?.status).toBe("CREATED");
  expect(transport.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(0);
  diagnostic.mockRestore();
});
test("missing or ambiguous provider pending ownership blocks cancellation", async () => {
  const { flow, transport } = setup();
  await create(flow);
  transport.mockImplementation(async (request) => ({ status: 200, body: JSON.stringify(
    request.url.endsWith("/api/invoice") ? { pendingRequestsCount: 1,
      pendingRequestsList: [{ date: "2026-11-17T10:00:00Z", uid: "foreign-uid" }] } :
      request.url.includes("/api/invoice/") ? payload.invoice :
      { status: true, ifu: config.ifu, nim: config.nim },
  ) }));
  await expect(flow.cancel(principal, identity, "cancel-not-pending", {
    cancel: true, determination: "VERIFIED_PENDING_TEST",
  })).rejects.toThrow();
  expect((await new FiscalAttemptStore().read(identity))?.status).toBe("CREATED");
  expect(transport.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(0);
});
test("revoked or foreign operator ownership rejects cancellation before provider reads or mutation", async () => {
  const { flow, transport, authorize } = setup();
  await create(flow);
  const calls = transport.mock.calls.length;
  authorize.mockRejectedValueOnce(new Error("denied"));
  await expect(flow.cancel(principal, identity, "cancel-denied", {
    cancel: true, determination: "VERIFIED_PENDING_TEST",
  })).rejects.toThrow("denied");
  expect((await new FiscalAttemptStore().read(identity))?.status).toBe("CREATED");
  expect(transport).toHaveBeenCalledTimes(calls);
});
test("verified pending TEST invoice is cancelled once with captured DGI evidence", async () => {
  const { flow, transport } = setup();
  await create(flow);
  const result = await flow.cancel(principal, identity, "cancel", {
    cancel: true, determination: "VERIFIED_PENDING_TEST",
  });
  expect(result.state).toMatchObject({ status: "CANCELLED", uid: "provider-uid",
    securityEvidenceOrigin: "DGI_TEST", diagnostic: { captured: true }, security });
  expect(transport.mock.calls.filter(([r]) => r.method === "PUT" &&
    r.url.endsWith("/cancel"))).toHaveLength(1);
  await expect(flow.cancel(principal, identity, "cancel", {
    cancel: true, determination: "VERIFIED_PENDING_TEST",
  })).rejects.toThrow();
  expect(transport.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(1);
});
test("verified owned pending invoice with provider total mismatch can be cancelled but not confirmed", async () => {
  const mismatch = setup();
  mismatch.transport.mockImplementation(async (request) => ({ status: 200,
    body: JSON.stringify(request.method === "POST" ? { uid: "provider-uid", ...totals, total: 999 } :
      request.method === "PUT" ? { ...security, refundWithAibPayment: false } :
      request.url.endsWith("/api/invoice") ? { pendingRequestsCount: 1,
        pendingRequestsList: [{ date: "2026-11-17T10:00:00Z", uid: "provider-uid" }] } :
      request.url.includes("/api/invoice/") ? payload.invoice :
      { status: true, ifu: config.ifu, nim: config.nim }) }));
  await create(mismatch.flow);
  await expect(mismatch.flow.confirm(principal, identity, "confirm-mismatch", {
    confirm: true,
  })).rejects.toThrow();
  const cancelled = await mismatch.flow.cancel(principal, identity, "cancel-mismatch", {
    cancel: true, determination: "VERIFIED_PENDING_TEST",
  });
  expect(cancelled.state).toMatchObject({ status: "CANCELLED", providerTotal: 999,
    expectedTotal: 2000, fiscalTotalsVerified: false, securityEvidenceOrigin: "DGI_TEST" });
  expect(mismatch.transport.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(1);
});

test("cancellation rejects confirmed attempts before provider cleanup", async () => {
  rows.clear();
  payload.invoice.reference = `confirmed-before-cancel-${++sequence}`;
  const confirmed = setup();
  await create(confirmed.flow);
  await confirmed.flow.confirm(principal, identity, "confirm-first", { confirm: true });
  await expect(confirmed.flow.cancel(principal, identity, "cancel-confirmed", {
    cancel: true, determination: "VERIFIED_PENDING_TEST",
  })).rejects.toThrow();
  expect(confirmed.transport.mock.calls.filter(([r]) => r.url.endsWith("/cancel"))).toHaveLength(0);
});
test("uncertain cancellation is fenced as UNKNOWN_OUTCOME and never retried", async () => {
  const { flow, transport } = setup();
  await create(flow);
  transport.mockImplementation(async (request) => {
    if (request.url.endsWith("/cancel")) throw new Error("private timeout");
    return { status: 200, body: JSON.stringify(request.url.endsWith("/api/invoice")
      ? { pendingRequestsCount: 1, pendingRequestsList: [
          { date: "2026-11-17T10:00:00Z", uid: "provider-uid" },
        ] }
      : request.url.includes("/api/invoice/") ? payload.invoice
      : { status: true, ifu: config.ifu, nim: config.nim }) };
  });
  await flow.cancel(principal, identity, "cancel-timeout", {
    cancel: true, determination: "VERIFIED_PENDING_TEST",
  });
  expect(await new FiscalAttemptStore().read(identity)).toMatchObject({
    status: "UNKNOWN_OUTCOME", uncertainOperation: "CANCEL",
    diagnostic: { captured: false, mutationMayHaveExecuted: true, category: "TRANSPORT" },
  });
  const mutations = transport.mock.calls.filter(([r]) => r.method === "PUT").length;
  await expect(flow.cancel(principal, identity, "cancel-timeout", {
    cancel: true, determination: "VERIFIED_PENDING_TEST",
  })).rejects.toThrow();
  expect(transport.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(mutations);
});
test("provider cancellation error is captured and remains an uncertain non-retryable outcome", async () => {
  const { flow, transport } = setup({}, 503);
  await create(flow);
  await flow.cancel(principal, identity, "cancel-provider-error", {
    cancel: true, determination: "VERIFIED_PENDING_TEST",
  });
  expect(await new FiscalAttemptStore().read(identity)).toMatchObject({
    status: "UNKNOWN_OUTCOME", uncertainOperation: "CANCEL",
    diagnostic: { captured: true, httpStatus: 503, category: "HTTP" },
  });
  expect(transport.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(1);
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

test("read-only preflight failure leaves CREATED UID without a CONFIRM reservation", async () => {
  const { flow, transport } = setup();
  await create(flow);
  transport.mockImplementation(async () => ({ status: 401, body: "{}" }));
  await expect(flow.confirm(principal, identity, "confirm", { confirm: true })).rejects.toThrow();
  expect(await new FiscalAttemptStore().read(identity)).toMatchObject({
    status: "CREATED", uid: "provider-uid", fiscalTotalsVerified: true,
  });
  expect(transport.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(
    0,
  );
  expect(transport.mock.calls.filter(([r]) => r.method === "POST")).toHaveLength(1);
});
