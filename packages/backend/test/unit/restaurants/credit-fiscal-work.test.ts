import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { creditFiscalIntentWrite, processCreditFiscalIntent } from "@/lambda/domains/restaurants/credit-fiscal-work";
import { RestaurantCreditNoteFiscalSource as Source } from "@/lambda/domains/restaurants/credit-note-fiscal-source";
import { authorizeCreditPreparation } from "@/lambda/domains/fiscal-compliance/core/credit-workflow";
const id = "00000000-0000-4000-8000-000000000001";
const binding = { environment: "TEST" as const, connectionId: id, policyVersion: 1 };
const input = { orgId: "org", outletId: id, sessionId: id, invoiceId: id, creditNoteId: id,
  actorId: "actor", createdAt: "2026-11-25T18:00:00.000Z", sourceReceiptDigest: "a".repeat(64), fiscalBinding: binding };
const original = { identity: { orgId: "org", sourceDomain: "restaurants", sourceDocumentId: id,
  sourceDocumentType: "INVOICE", environment: "TEST" }, sourceDigest: "b".repeat(64),
  status: "CONFIRMED", execution: "REAL_TEST", securityEvidenceOrigin: "DGI_TEST", fiscalDocumentType: "FV",
  fiscalBinding: binding, obligationId: "original", security: { codeMECeFDGI: "TEST-PRXJ-LKWL-HYMQ-PXGO-MH5Z",
    nim: "TS01002103", counters: "162/174 FV", qrCode: "original-qr", dateTime: "provider-time" } } as never;
const source = { credit: { data: { sourceReceiptDigest: input.sourceReceiptDigest } },
  original: { proof: { digest: "b".repeat(64) } }, sourceDigest: "c".repeat(64), originalFiscal: original } as never;
const row = () => unmarshall(creditFiscalIntentWrite(input).Put!.Item!);
beforeEach(() => {
  process.env.STAGE = "dev"; process.env.FISCAL_EXECUTION_MODE = "REAL_TEST"; process.env.FISCAL_REAL_TEST_ENABLED = "1";
  jest.spyOn(Source, "verify").mockResolvedValue(source);
  jest.spyOn(dynamoClient, "send").mockResolvedValue({} as never);
});
afterEach(() => { jest.restoreAllMocks(); delete process.env.STAGE; delete process.env.FISCAL_EXECUTION_MODE; delete process.env.FISCAL_REAL_TEST_ENABLED; });
test("intent uses credit partition, conditional create, frozen original policy", () => {
  const write = creditFiscalIntentWrite(input).Put!;
  expect(write.ConditionExpression).toBe("attribute_not_exists(PK)");
  expect(row()).toMatchObject({ PK: K.restaurantCreditNotePK("org", id, id), state: "PENDING", fiscalBinding: binding });
});
test("automatic preparation durably blocks unknown wire semantics without any provider attempt", async () => {
  await processCreditFiscalIntent(row());
  const calls = jest.mocked(dynamoClient.send).mock.calls;
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBeInstanceOf(UpdateItemCommand);
  const command = calls[0][0] as UpdateItemCommand;
  expect(unmarshall(command.input.ExpressionAttributeValues!)).toMatchObject({
    ":reason": "PROVIDER_CREDIT_WIRE_SEMANTICS_UNVERIFIED", ":digest": "c".repeat(64), ":binding": binding,
  });
  expect(command.input.ConditionExpression).toContain("#state = :pending");
});
test("settled delivery is a read-only no-op", async () => {
  await processCreditFiscalIntent({ ...row(), state: "BLOCKED", reason: "PROVIDER_CREDIT_WIRE_SEMANTICS_UNVERIFIED" });
  expect(Source.verify).not.toHaveBeenCalled(); expect(dynamoClient.send).not.toHaveBeenCalled();
});
test("transient source failures retry without settling or dispatch", async () => {
  jest.mocked(Source.verify).mockRejectedValue(new Error("network unavailable"));
  await expect(processCreditFiscalIntent(row())).rejects.toThrow("network unavailable");
  expect(dynamoClient.send).not.toHaveBeenCalled();
});
test("production and disabled execution never processes a credit", async () => {
  process.env.FISCAL_REAL_TEST_ENABLED = "0";
  await processCreditFiscalIntent(row()); expect(Source.verify).not.toHaveBeenCalled();
  process.env.FISCAL_REAL_TEST_ENABLED = "1";
  await processCreditFiscalIntent({ ...row(), fiscalBinding: { ...binding, environment: "PRODUCTION" } });
  expect(Source.verify).not.toHaveBeenCalled();
});
test("authorization binds original tenant, immutable policy and source digest", () => {
  const args = { orgId: "org", sourceDomain: "restaurants", originalInvoiceId: id,
    originalSourceDigest: "b".repeat(64), creditSourceDigest: "c".repeat(64), fiscalBinding: binding, original };
  expect(authorizeCreditPreparation(args).providerMutationAllowed).toBe(false);
  expect(() => authorizeCreditPreparation({ ...args, orgId: "other" })).toThrow();
  expect(() => authorizeCreditPreparation({ ...args, fiscalBinding: { ...binding, policyVersion: 2 } })).toThrow();
});

test("application authorization reads the bound credit and returns a typed blocked result", async () => {
  const { prepareCreditFiscalAuthorization } = await import("@/lambda/domains/restaurants/credit-fiscal-work");
  jest.mocked(Source.verify).mockResolvedValue({ ...(source as object),
    credit: { data: { sourceReceiptDigest: input.sourceReceiptDigest }, lines: [
      { orderId: "o", itemId: "a" }, { orderId: "o", itemId: "b" }] },
    original: { proof: { digest: "b".repeat(64) }, invoice: { customer: { name: "Frozen buyer", ifu: "fixture" } },
      lines: [{ coordinate: { orderId: "o", itemId: "a" }, line: { snapshot: { fiscalTreatment: { effectiveGroup: "A" } } } },
        { coordinate: { orderId: "o", itemId: "b" }, line: { snapshot: { fiscalTreatment: { effectiveGroup: "B" } } } }] },
  } as never);
  jest.mocked(dynamoClient.send).mockResolvedValue({ Item: marshall(row()) } as never);
  const result = await prepareCreditFiscalAuthorization({ ...input, scenarioId: "06" });
  expect(result).toMatchObject({ creditNoteId: id, status: "BLOCKED", providerMutationAllowed: false,
    originalPrintedReference: "TS01002103 - 174" });
  await expect(prepareCreditFiscalAuthorization({ ...input, scenarioId: "20" })).rejects.toThrow("SCENARIO_SOURCE_MISMATCH");
});
test("historical unbound credit cannot acquire preparation authorization", async () => {
  const { prepareCreditFiscalAuthorization } = await import("@/lambda/domains/restaurants/credit-fiscal-work");
  jest.mocked(dynamoClient.send).mockResolvedValue({} as never);
  await expect(prepareCreditFiscalAuthorization({ ...input, scenarioId: "06" })).rejects.toThrow("AUTHORIZATION_REQUIRED");
});
test("deployed candidate credit mapping is blocked even for raw 24-character references", async () => {
  const { assertCreditProviderExecutionEnabled } = await import("@/lambda/domains/fiscal-compliance/core/credit-workflow");
  const previous = process.env.NODE_ENV;
  try { process.env.NODE_ENV = "production"; expect(() => assertCreditProviderExecutionEnabled()).toThrow("WIRE_SEMANTICS_UNVERIFIED"); }
  finally { process.env.NODE_ENV = previous; }
});
