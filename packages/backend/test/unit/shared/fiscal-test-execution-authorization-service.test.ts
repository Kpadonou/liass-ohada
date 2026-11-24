import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { FiscalTestExecutionAuthorizationService as Service } from "@/lambda/shared/services/fiscal-test-execution-authorization-service";
import { FiscalSourcePreparationProofService } from "@/lambda/shared/services/fiscal-source-preparation-proof-service";
import {
  fiscalConfigurationDigest,
  OrganizationFiscalRepository,
} from "@/lambda/shared/repositories/organization-fiscal-repository";
import { OrganizationLegalIdentityService } from "@/lambda/shared/services/organization-legal-identity-service";
import { EffectiveOrganizationAccessService } from "@/lambda/shared/services/effective-organization-access-service";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { fiscalAttemptStateSchema, obligationIdentity } from "@/lambda/domains/fiscal-compliance/core/fiscal-attempt-state";

const db = mockClient(DynamoDBClient);
const ids = {
  proofId: "78345288-662a-49e7-bcc9-8bcc48f41f1e",
  connectionId: "667da1b5-150e-45d9-8860-37caef3b2287",
  commandId: "fb7ea76f-3b16-4e45-83f2-5fbc90c2d770",
  outletId: "76d54ba2-ee98-4373-8d3f-567920e91a73",
  operatorId: "2189c04e-00f1-402c-98e5-c38569e8974e",
  approverId: "9e7e0aee-a0bf-45c5-a698-ea7f4f01bfa8",
  sessionId: "62f61225-43ce-45bf-8381-8474fd9b8ab9",
  invoiceId: "60a509af-e385-4185-b86c-bf60be6c7b57",
};
const orgId = "org-a";
const principal = {
  stage: "dev" as const,
  issuer: "https://cognito-idp.eu-west-3.amazonaws.com/eu-west-3_verified",
  sub: ids.approverId,
};
const request = () => ({
  proofId: ids.proofId,
  proofDigest: "c".repeat(64),
  connectionId: ids.connectionId,
  commandId: ids.commandId,
});
const totals = {
  ta: 0, tb: 18, tc: 0, td: 18,
  taa: 0, tab: 2360, tac: 0, tad: 0, tae: 0, taf: 0,
  hab: 2000, had: 0, vab: 360, vad: 0,
  aib: 0, ts: 0, total: 2360,
};
const proof = () => ({
  orgId, outletId: ids.outletId, operatorUserId: ids.operatorId,
  sessionId: ids.sessionId, invoiceId: ids.invoiceId,
  sourceDigest: "a".repeat(64), sourceVersion: 7, financialRevision: 2,
  sellerAuthorityDigest: "b".repeat(64), scenarioId: "02",
  fiscalGroups: ["B"],
  fiscalMapping: { environment: "TEST", invoiceType: "FV", priceBasis: "TTC" },
  expectedFiscalTotals: totals,
  operations: { CREATE: 1, GET: 2, CONFIRM: 1, CANCEL: 1 },
  expiresAt: "2026-11-17T10:30:00.000Z",
  proofId: ids.proofId, proofDigest: "c".repeat(64),
  preparedAt: "2026-11-17T10:00:00.000Z", status: "PREPARED",
});
const identity = () => ({
  ifu: "1234567890123",
  binding: {
    reference: "0ac2a3e6-e10c-40a8-9370-33dfb1acf617",
    version: "1", digest: "b".repeat(64), selectionVersion: 4,
  },
  check: {
    ConditionCheck: {
      TableName: "platform-test",
      Key: marshall({ PK: K.orgKey(orgId), SK: "LEGAL_IDENTITY#CURRENT" }),
      ConditionExpression: "#version = :version",
      ExpressionAttributeNames: { "#version": "version" },
      ExpressionAttributeValues: marshall({ ":version": 4 }),
    },
  },
});
const connection = () => {
  const base = {
    PK: K.orgKey(orgId),
    SK: K.organizationFiscalConnectionSK("TEST", ids.connectionId),
    orgId,
    entityType: "PLATFORM_FISCAL_CONNECTION" as const,
    data: {
      environment: "TEST" as const,
      taxpayerIfu: "1234567890123",
      nim: "TEST-NIM",
      label: "Synthetic TEST connection",
      connectionId: ids.connectionId,
      version: 3,
      credentialStatus: "STORED_UNVERIFIED" as const,
      updatedAt: "2026-11-17T09:00:00.000Z",
    },
    secretReference: "/dev/platform/fiscal/redacted/TEST/00000000-0000-4000-8000-000000000000",
  };
  const configurationDigest = fiscalConfigurationDigest(base);
  const binding = {
    orgId, connectionId: ids.connectionId, environment: "TEST" as const,
    configurationVersion: 3, configurationDigest,
    credentialReference: base.secretReference, credentialVersion: 1 as const,
    credentialStorageVersion: 3, identity: identity().binding,
  };
  const result = {
    operationId: "4518dcf2-f4b7-4bc6-9c46-c96858ad29a6",
    environment: "TEST" as const, configurationVersion: 3,
    status: "VERIFIED_TEST" as const,
    startedAt: "2026-11-17T09:00:00.000Z",
    completedAt: "2026-11-17T09:00:02.000Z",
    tokenValidUntil: "2026-11-18T09:00:00.000Z",
    inProgress: false, applicable: true,
    checks: {
      credentialStored: true, technicallyVerified: true, notExpired: true,
      ifuConsistency: "MATCH" as const, nimCorrespondence: "MATCH" as const,
      emcfAssociation: "UNVERIFIED" as const,
      legalSellerAuthority: "APPROVED" as const,
      timezoneAuthority: "UNVERIFIED" as const,
      establishmentBinding: "UNVERIFIED" as const,
      sfeApprovalReferences: "UNVERIFIED" as const,
      sfeVersionApplicability: "UNVERIFIED" as const,
      executionAuthorized: false as const, issuanceEligible: false as const,
      productionEligible: false as const,
    },
  };
  return {
    ...base,
    verification: {
      revision: 1,
      leaseUntil: "2026-11-17T09:01:00.000Z",
      latest: { binding, result }, lastVerified: { binding, result },
    },
  };
};
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-11-17T10:05:00.000Z"));
  jest.restoreAllMocks();
  db.reset();
  db.on(GetItemCommand).resolves({});
  db.on(TransactWriteItemsCommand).resolves({});
  jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockResolvedValue({
    accessMode: "READ_WRITE",
    accessSource: "DIRECT",
    orgId,
    permissions: ["FISCAL_COMPLIANCE_WRITE"],
    role: "OWNER",
    workspaceOrgId: orgId,
  });
  jest.spyOn(OrganizationFiscalRepository, "authorize").mockResolvedValue({ canManage: true });
  jest.spyOn(OrganizationFiscalRepository, "readForVerification").mockResolvedValue(connection());
  jest.spyOn(OrganizationLegalIdentityService, "readFiscalTaxpayerAuthority").mockResolvedValue(identity());
  jest.spyOn(FiscalSourcePreparationProofService, "read").mockResolvedValue(proof() as never);
});
afterEach(() => jest.useRealTimers());

test("atomically consumes verified Restaurants proof and creates its TEST authorization", async () => {
  const result = await Service.approvePreparedProof(principal, orgId, request());
  expect(result).toMatchObject({
    proofId: ids.proofId, invoiceId: ids.invoiceId, scenarioId: "02",
    connectionId: ids.connectionId, operations: proof().operations,
    remaining: proof().operations, status: "ACTIVE",
  });
  const tx = db.commandCalls(TransactWriteItemsCommand)[0].args[0].input.TransactItems!;
  expect(tx).toHaveLength(6);
  expect(tx.slice(0, 4).every((item) => Boolean(item.ConditionCheck))).toBe(true);
  expect(tx[4].Update?.ConditionExpression).toContain("#data = :proof");
  const record = unmarshall(tx[5].Put!.Item!);
  expect(record.data).toMatchObject({
    orgId, outletId: ids.outletId, operatorUserId: ids.operatorId,
    issuedBy: ids.approverId, sourceDigest: "a".repeat(64),
    fiscalMapping: proof().fiscalMapping, expectedFiscalTotals: totals,
    preparationProofId: ids.proofId, preparationProofDigest: "c".repeat(64),
  });
  expect(record.data.operatorUserId).not.toBe(record.data.issuedBy);
});

test("permission or direct-organization denial produces no write", async () => {
  jest.mocked(EffectiveOrganizationAccessService.resolveAccess).mockResolvedValueOnce({
    accessMode: "READ_WRITE",
    accessSource: "DIRECT",
    orgId,
    permissions: ["FISCAL_COMPLIANCE_READ"],
    role: "MEMBER",
    workspaceOrgId: orgId,
  });
  await expect(Service.approvePreparedProof(principal, orgId, request()))
    .rejects.toMatchObject({ messageCode: "DOMAIN_PERMISSION_REQUIRED" });
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);

  jest.mocked(EffectiveOrganizationAccessService.resolveAccess).mockResolvedValueOnce({
    accessMode: "READ_WRITE",
    accessSource: "DIRECT",
    orgId: "org-b",
    permissions: ["FISCAL_COMPLIANCE_WRITE"],
    role: "OWNER",
    workspaceOrgId: "org-b",
  });
  jest.mocked(OrganizationFiscalRepository.authorize).mockRejectedValueOnce(new Error("foreign"));
  await expect(Service.approvePreparedProof(principal, "org-b", request())).rejects.toThrow("foreign");
  expect(FiscalSourcePreparationProofService.read).not.toHaveBeenCalledWith("org-b", ids.proofId);
});

test("PRODUCTION principal cannot approve a TEST proof", async () => {
  await expect(Service.approvePreparedProof(
    { ...principal, stage: "prod" }, orgId, request(),
  )).rejects.toMatchObject({ statusCode: 403, messageCode: "DOMAIN_PERMISSION_REQUIRED" });
  expect(FiscalSourcePreparationProofService.read).not.toHaveBeenCalled();
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});

test.each([
  [{ proofDigest: "d".repeat(64) }, "FISCAL_COMMAND_CONFLICT"],
  [{ status: "CONSUMED" }, "FISCAL_COMMAND_CONFLICT"],
  [{ expiresAt: "2026-11-17T10:04:59.000Z" }, "FISCAL_COMMAND_CONFLICT"],
  [{ expiresAt: "2026-11-17T10:35:00.001Z" }, "FISCAL_COMMAND_CONFLICT"],
  [{ operations: { CREATE: 2, GET: 2, CONFIRM: 1, CANCEL: 1 } }, "FISCAL_COMMAND_CONFLICT"],
  [{ fiscalMapping: { environment: "PRODUCTION", invoiceType: "FV", priceBasis: "TTC" } }, "FISCAL_COMMAND_CONFLICT"],
] as const)("rejects invalid, stale, over-budget, or non-TEST proof %#", async (change, code) => {
  jest.mocked(FiscalSourcePreparationProofService.read).mockResolvedValueOnce({
    ...proof(), ...change,
  } as never);
  await expect(Service.approvePreparedProof(principal, orgId, request()))
    .rejects.toMatchObject({ messageCode: code });
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});

test("rejects tampered proof evidence before connection selection", async () => {
  jest.mocked(FiscalSourcePreparationProofService.read).mockRejectedValueOnce(
    Object.assign(new Error("conflict"), { messageCode: "FISCAL_COMMAND_CONFLICT" }),
  );
  await expect(Service.approvePreparedProof(principal, orgId, request()))
    .rejects.toMatchObject({ messageCode: "FISCAL_COMMAND_CONFLICT" });
  expect(OrganizationFiscalRepository.readForVerification).not.toHaveBeenCalled();
});

test.each(["connection", "seller", "stale"])(
  "rejects %s binding mismatch without consuming proof",
  async (variant) => {
    if (variant === "connection")
      jest.mocked(OrganizationFiscalRepository.readForVerification).mockResolvedValueOnce(undefined);
    if (variant === "seller")
      jest.mocked(OrganizationLegalIdentityService.readFiscalTaxpayerAuthority).mockResolvedValueOnce({
        ...identity(), binding: { ...identity().binding, digest: "e".repeat(64) },
      });
    if (variant === "stale") {
      const stale = connection();
      stale.data.version = 4;
      jest.mocked(OrganizationFiscalRepository.readForVerification).mockResolvedValueOnce(stale);
    }
    await expect(Service.approvePreparedProof(principal, orgId, request()))
      .rejects.toMatchObject({ messageCode: "PLATFORM_FISCAL_CREDENTIAL_INVALID" });
    expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  },
);

test("exact replay returns the established result and conflicting replay is rejected", async () => {
  await Service.approvePreparedProof(principal, orgId, request());
  const record = db.commandCalls(TransactWriteItemsCommand)[0].args[0].input.TransactItems![5].Put!.Item!;
  db.reset();
  db.on(GetItemCommand).resolves({ Item: record });
  const replayed = await Service.approvePreparedProof(principal, orgId, request());
  expect(replayed.proofId).toBe(ids.proofId);
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  await expect(Service.approvePreparedProof(principal, orgId, {
    ...request(), commandId: "2fc54c83-7a27-4790-9714-5b1bf1b88ae8",
  })).rejects.toMatchObject({ messageCode: "FISCAL_COMMAND_CONFLICT" });
});

test("an ambiguous concurrent commit resolves only the exact durable authorization", async () => {
  db.on(TransactWriteItemsCommand).callsFake((input) => {
    const record = input.TransactItems![5].Put!.Item!;
    db.on(GetItemCommand).resolves({ Item: record });
    throw new Error("timeout");
  });
  await expect(Service.approvePreparedProof(principal, orgId, request()))
    .resolves.toMatchObject({ proofId: ids.proofId, status: "ACTIVE" });
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(1);
});

test("unknown failure without a committed authorization remains unavailable", async () => {
  db.on(TransactWriteItemsCommand).rejects(new Error("timeout"));
  await expect(Service.approvePreparedProof(principal, orgId, request()))
    .rejects.toMatchObject({ statusCode: 503, messageCode: "PLATFORM_FISCAL_UNAVAILABLE" });
});

const exhaustedAuthorizationRecord = () => marshall({
  PK: K.orgKey(orgId), SK: K.fiscalExecutionAuthorizationSK("TEST", ids.invoiceId), orgId,
  entityType: "PLATFORM_FISCAL_EXECUTION_AUTHORIZATION",
  data: {
    orgId, connectionId: ids.connectionId, outletId: ids.outletId,
    operatorUserId: ids.operatorId, sessionId: ids.sessionId, invoiceId: ids.invoiceId,
    sourceDigest: "a".repeat(64), scenarioId: "02", fiscalMapping: proof().fiscalMapping,
    expectedFiscalTotals: totals, operations: proof().operations,
    expiresAt: "2026-11-17T10:00:00.000Z",
    authorizationId: "2f4d3917-7e43-45b7-8c90-73c1bb1de569",
    issuedAt: "2026-11-17T09:30:00.000Z",
    issuedBy: ids.approverId, status: "ACTIVE",
    remaining: { CREATE: 0, GET: 0, CONFIRM: 1, CANCEL: 1 },
    preparationProofId: ids.proofId, preparationProofDigest: "c".repeat(64),
  },
}, { removeUndefinedValues: true });
const createdAttemptRecord = () => {
  const identity = { orgId, environment: "TEST" as const, sourceDomain: "restaurants",
    sourceDocumentType: "INVOICE" as const, sourceDocumentId: ids.invoiceId,
    jurisdiction: "BJ", obligation: "NORMALIZE" };
  const state = fiscalAttemptStateSchema.parse({ identity,
    obligationId: obligationIdentity(identity), attemptId: `AUTO#${ids.invoiceId}`,
    execution: "REAL_TEST", provider: "BENIN_EMECEF_TEST",
    sourceDigest: "a".repeat(64), requestDigest: "d".repeat(64), expectedTotal: 1000,
    fiscalDocumentType: "FV", version: 3, status: "CREATED",
    commands: [{ commandId: `AUTO#${ids.invoiceId}#CREATE`, intentDigest: "e".repeat(64), operation: "CREATE" }],
    activeCommandId: `AUTO#${ids.invoiceId}#CREATE`, uid: "2cb8c7af-e179-49fd-8435-1a5aedf195c2",
    providerTotal: 1000, fiscalTotalsVerified: true,
    providerContextDigest: "f".repeat(64), fiscalTotalsDigest: "1".repeat(64),
  });
  return marshall({ PK: K.orgKey(orgId),
    SK: K.fiscalAttemptEffectSK("TEST", obligationIdentity(identity)), orgId,
    entityType: "FISCAL_ATTEMPT_EFFECT", schemaVersion: 1, version: 3, state });
};
const extensionRequest = () => ({ kind: "GET_RECONCILIATION_EXTENSION" as const,
  authorizationId: "2f4d3917-7e43-45b7-8c90-73c1bb1de569", invoiceId: ids.invoiceId,
  providerUid: "2cb8c7af-e179-49fd-8435-1a5aedf195c2", expectedAttemptVersion: 3,
  commandId: "9b66a7dd-a0e0-49af-a188-c87f0dad31c6" });

test("creates one audited GET-only extension without changing exhausted budgets", async () => {
  db.on(GetItemCommand).callsFake((input) => {
    const sk = unmarshall(input.Key!).SK;
    if (sk === K.fiscalExecutionAuthorizationSK("TEST", ids.invoiceId))
      return { Item: exhaustedAuthorizationRecord() };
    if (sk === K.fiscalAttemptEffectSK("TEST", obligationIdentity({ orgId,
      environment: "TEST", sourceDomain: "restaurants", sourceDocumentType: "INVOICE",
      sourceDocumentId: ids.invoiceId, jurisdiction: "BJ", obligation: "NORMALIZE" })))
      return { Item: createdAttemptRecord() };
    return {};
  });
  const view = await Service.extendGetReconciliation(principal, orgId, extensionRequest());
  expect(view).toMatchObject({ authorizationId: extensionRequest().authorizationId,
    invoiceId: ids.invoiceId, providerUid: extensionRequest().providerUid,
    expectedAttemptVersion: 3, operation: "GET", remaining: 1, status: "ACTIVE" });
  const tx = db.commandCalls(TransactWriteItemsCommand)[0].args[0].input.TransactItems!;
  expect(tx).toHaveLength(5);
  expect(tx[2].ConditionCheck?.ConditionExpression).toContain("#data.#remaining.#get = :zero");
  expect(tx[3].ConditionCheck?.ConditionExpression).toContain("#state.uid = :uid");
  const extension = unmarshall(tx[4].Put!.Item!);
  expect(extension.entityType).toBe("PLATFORM_FISCAL_GET_AUTHORIZATION_EXTENSION");
  expect(extension.data).toMatchObject({ operation: "GET", remaining: 1,
    authorizationId: extensionRequest().authorizationId, issuedBy: principal.sub });
  expect(unmarshall(exhaustedAuthorizationRecord()).data.remaining).toEqual(
    { CREATE: 0, GET: 0, CONFIRM: 1, CANCEL: 1 });
});

test("replays the same GET extension command without creating another audit record", async () => {
  db.on(GetItemCommand).callsFake((input) => {
    const sk = unmarshall(input.Key!).SK;
    if (sk === K.fiscalExecutionAuthorizationSK("TEST", ids.invoiceId))
      return { Item: exhaustedAuthorizationRecord() };
    if (sk.startsWith("FISCAL_ATTEMPT_EFFECT#")) return { Item: createdAttemptRecord() };
    return {};
  });
  const first = await Service.extendGetReconciliation(principal, orgId, extensionRequest());
  const extension = db.commandCalls(TransactWriteItemsCommand)[0].args[0].input.TransactItems![4].Put!.Item!;
  db.reset();
  db.on(GetItemCommand).callsFake((input) => {
    const sk = unmarshall(input.Key!).SK;
    if (sk === K.fiscalExecutionAuthorizationSK("TEST", ids.invoiceId))
      return { Item: exhaustedAuthorizationRecord() };
    if (sk === K.fiscalGetAuthorizationExtensionSK("TEST", ids.invoiceId))
      return { Item: extension };
    return {};
  });
  await expect(Service.extendGetReconciliation(principal, orgId, extensionRequest()))
    .resolves.toEqual(first);
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});

test("renews an unused expired GET extension while preserving its audit history", async () => {
  db.on(GetItemCommand).callsFake((input) => {
    const sk = unmarshall(input.Key!).SK;
    if (sk === K.fiscalExecutionAuthorizationSK("TEST", ids.invoiceId))
      return { Item: exhaustedAuthorizationRecord() };
    if (sk.startsWith("FISCAL_ATTEMPT_EFFECT#")) return { Item: createdAttemptRecord() };
    return {};
  });
  await Service.extendGetReconciliation(principal, orgId, extensionRequest());
  const firstItem = unmarshall(db.commandCalls(TransactWriteItemsCommand)[0].args[0].input.TransactItems![4].Put!.Item!);
  firstItem.data.expiresAt = "2020-01-01T00:00:00.000Z";
  db.reset();
  db.on(GetItemCommand).callsFake((input) => {
    const sk = unmarshall(input.Key!).SK;
    if (sk === K.fiscalExecutionAuthorizationSK("TEST", ids.invoiceId))
      return { Item: exhaustedAuthorizationRecord() };
    if (sk === K.fiscalGetAuthorizationExtensionSK("TEST", ids.invoiceId))
      return { Item: marshall(firstItem) };
    if (sk.startsWith("FISCAL_ATTEMPT_EFFECT#")) return { Item: createdAttemptRecord() };
    return {};
  });
  const renewed = await Service.extendGetReconciliation(principal, orgId, {
    ...extensionRequest(), commandId: "bfda4655-a443-41cd-87a5-0cd10d4804c0",
  });
  expect(renewed).toMatchObject({ operation: "GET", remaining: 1, status: "ACTIVE" });
  expect(renewed.extensionId).not.toBe(firstItem.data.extensionId);
  const renewal = db.commandCalls(TransactWriteItemsCommand)[0].args[0].input.TransactItems![4].Update!;
  expect(renewal.UpdateExpression).toContain("list_append");
  const values = unmarshall(renewal.ExpressionAttributeValues!);
  expect(values[":previous"]).toEqual([firstItem.data]);
  expect(values[":data"].commandId).toBe("bfda4655-a443-41cd-87a5-0cd10d4804c0");
});

test("rejects an extension when CREATED attempt UID or version does not match", async () => {
  db.on(GetItemCommand).callsFake((input) => {
    const sk = unmarshall(input.Key!).SK;
    if (sk === K.fiscalExecutionAuthorizationSK("TEST", ids.invoiceId))
      return { Item: exhaustedAuthorizationRecord() };
    if (sk.startsWith("FISCAL_ATTEMPT_EFFECT#")) return { Item: createdAttemptRecord() };
    return {};
  });
  await expect(Service.extendGetReconciliation(principal, orgId, {
    ...extensionRequest(), providerUid: "f50de72d-6964-41c4-8bce-17fd75fce284",
  })).rejects.toMatchObject({ messageCode: "FISCAL_COMMAND_CONFLICT" });
  await expect(Service.extendGetReconciliation(principal, orgId, {
    ...extensionRequest(), expectedAttemptVersion: 4,
  })).rejects.toMatchObject({ messageCode: "FISCAL_COMMAND_CONFLICT" });
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});

test("consumes the extension only for GET and fences it against the exact CREATED attempt", async () => {
  db.on(GetItemCommand).callsFake((input) => {
    const sk = unmarshall(input.Key!).SK;
    if (sk === K.fiscalExecutionAuthorizationSK("TEST", ids.invoiceId))
      return { Item: exhaustedAuthorizationRecord() };
    if (sk.startsWith("FISCAL_ATTEMPT_EFFECT#")) return { Item: createdAttemptRecord() };
    return {};
  });
  await Service.extendGetReconciliation(principal, orgId, extensionRequest());
  const extension = db.commandCalls(TransactWriteItemsCommand)[0].args[0].input.TransactItems![4].Put!.Item!;
  db.reset();
  db.on(GetItemCommand).callsFake((input) => {
    const sk = unmarshall(input.Key!).SK;
    if (sk === K.fiscalExecutionAuthorizationSK("TEST", ids.invoiceId))
      return { Item: exhaustedAuthorizationRecord() };
    if (sk === K.fiscalGetAuthorizationExtensionSK("TEST", ids.invoiceId))
      return { Item: extension };
    return {};
  });
  const binding = { orgId, outletId: ids.outletId, operatorUserId: ids.operatorId,
    sessionId: ids.sessionId, invoiceId: ids.invoiceId, sourceDigest: "a".repeat(64) };
  await expect(Service.resolveAndConsume(binding, "GET")).resolves.toMatchObject({
    authorizationId: extensionRequest().authorizationId,
    remaining: { CREATE: 0, GET: 0, CONFIRM: 1, CANCEL: 1 },
  });
  const consume = db.commandCalls(TransactWriteItemsCommand)[0].args[0].input.TransactItems!;
  expect(consume).toHaveLength(2);
  expect(consume[0].Update?.UpdateExpression).toContain("#data.#remaining = :zero");
  expect(consume[1].ConditionCheck?.ConditionExpression).toContain("#state.uid = :uid");
  expect(unmarshall(exhaustedAuthorizationRecord()).data.remaining.GET).toBe(0);
  db.resetHistory();
  await expect(Service.resolveAndConsume(binding, "CONFIRM"))
    .rejects.toMatchObject({ messageCode: "DOMAIN_PERMISSION_REQUIRED" });
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});

test("live-condition failure cannot expose a partial authorization", async () => {
  db.on(TransactWriteItemsCommand).rejects(Object.assign(new Error("changed"), {
    name: "TransactionCanceledException",
    CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }],
  }));
  await expect(Service.approvePreparedProof(principal, orgId, request()))
    .rejects.toMatchObject({ statusCode: 409, messageCode: "FISCAL_COMMAND_CONFLICT" });
  expect(db.commandCalls(GetItemCommand)).toHaveLength(2);
});
