jest.mock("@/lambda/domains/restaurants/fiscal-preparation", () => ({prepareRestaurantFiscalInvoice: jest.fn(async () => ({ready: true, preparation: {lines: [{fiscal: {taxGroup: "A"}}, {fiscal: {taxGroup: "B"}}]}}))}));
import { RestaurantFiscalAuthorizationPreparationService as AutomaticPreparation } from "@/lambda/domains/restaurants/fiscal-authorization-preparation-service";
import { RestaurantFiscalWorkProcessor } from "@/lambda/domains/restaurants/fiscal-work-processor";
import { RestaurantFiscalWorkRepository } from "@/lambda/domains/restaurants/fiscal-work-repository";
import { RestaurantInvoiceSourceVerifier } from "@/lambda/domains/restaurants/invoice-source-verifier";
import { FiscalTestExecutionAuthorizationService } from "@/lambda/shared/services/fiscal-test-execution-authorization-service";
import { realTestFiscalService } from "@/lambda/domains/restaurants/real-test-fiscal-handler";
import * as boundWorkflow from "@/lambda/domains/restaurants/bound-fiscal-workflow";

jest.mock("@/lambda/domains/restaurants/fiscalizable-invoice-v1", () => ({
  projectRestaurantInvoiceV1: jest.fn(() => ({})),
}));

const work = { orgId: "org", outletId: "00000000-0000-4000-8000-000000000001",
  sessionId: "00000000-0000-4000-8000-000000000002",
  invoiceId: "00000000-0000-4000-8000-000000000003",
  actorId: "actor", createdAt: "2026-11-18T10:00:00.000Z" };
const claim = { token: "00000000-0000-4000-8000-000000000004" as const, version: 1,
  until: "2026-11-18T10:01:00.000Z" };
let claimSpy: jest.SpyInstance, blockSpy: jest.SpyInstance, completeSpy: jest.SpyInstance;
let initiateSpy: jest.SpyInstance, reconcileSpy: jest.SpyInstance, confirmSpy: jest.SpyInstance;
let resultSpy: jest.SpyInstance, settleSpy: jest.SpyInstance;
beforeEach(() => {
  process.env.FISCAL_REAL_TEST_ENABLED = "1";
  process.env.FISCAL_EXECUTION_MODE = "REAL_TEST";
  process.env.STAGE = "dev";
  claimSpy = jest.spyOn(RestaurantFiscalWorkRepository, "claim").mockResolvedValue(claim);
  blockSpy = jest.spyOn(RestaurantFiscalWorkRepository, "block").mockResolvedValue(undefined);
  completeSpy = jest.spyOn(RestaurantFiscalWorkRepository, "complete").mockResolvedValue(undefined);
  settleSpy = jest.spyOn(RestaurantFiscalWorkRepository, "settleConfirmed").mockResolvedValue(undefined);
  jest.spyOn(RestaurantInvoiceSourceVerifier, "verify").mockResolvedValue({
    verified: true, evidence: { proof: { digest: "a".repeat(64) } },
  } as never);
  jest.spyOn(FiscalTestExecutionAuthorizationService, "readBound").mockResolvedValue({} as never);
  initiateSpy = jest.spyOn(realTestFiscalService, "initiate").mockResolvedValue({ status: "CREATED" } as never);
  reconcileSpy = jest.spyOn(realTestFiscalService, "recover").mockResolvedValue({ status: "CREATED" } as never);
  confirmSpy = jest.spyOn(realTestFiscalService, "confirm").mockResolvedValue({ status: "CONFIRMED",
    evidenceOrigin: "DGI_TEST", securityElements: { qrCode: "provider-qr" } } as never);
  resultSpy = jest.spyOn(realTestFiscalService, "confirmedResult").mockResolvedValue({ status: "NOT_STARTED" } as never);
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.FISCAL_REAL_TEST_ENABLED;
  delete process.env.FISCAL_EXECUTION_MODE;
  delete process.env.STAGE;
});
test("authorized work uses one stable CREATE, reconciliation and CONFIRM before completion", async () => {
  expect(await RestaurantFiscalWorkProcessor.process(work)).toEqual({ state: "CONFIRMED" });
  expect(initiateSpy).toHaveBeenCalledWith({ orgId: work.orgId, userId: work.actorId },
    expect.objectContaining({ attemptId: `AUTO#${work.invoiceId}`, commandId: `AUTO#${work.invoiceId}#CREATE` }));
  expect(reconcileSpy).toHaveBeenCalledWith(expect.anything(),
    expect.objectContaining({ providerOperation: "RECONCILE" }));
  expect(confirmSpy).toHaveBeenCalledTimes(1);
  expect(completeSpy).toHaveBeenCalledWith(work, claim);
});
test("bound work runs the existing engine without resolving legacy authorization", async () => {
  const bound = { ...work, fiscalBinding: { environment: "TEST" as const, connectionId: work.outletId, policyVersion: 2 } };
  const workflow = {
    create: jest.fn().mockResolvedValue({ state: { status: "CREATED" } }),
    reconcile: jest.fn().mockResolvedValue({}),
    confirm: jest.fn().mockResolvedValue({ state: { status: "CONFIRMED", security: { qrCode: "mock" }, securityEvidenceOrigin: "DGI_TEST" } }),
  };
  const prepare = jest.spyOn(boundWorkflow, "prepareBoundRestaurantWorkflow").mockResolvedValue({ workflow } as never);
  await expect(RestaurantFiscalWorkProcessor.process(bound)).resolves.toEqual({ state: "CONFIRMED" });
  expect(prepare).toHaveBeenCalledWith(bound);
  expect(workflow.create).toHaveBeenCalledTimes(1);
  expect(workflow.reconcile).toHaveBeenCalledTimes(1);
  expect(workflow.confirm).toHaveBeenCalledTimes(1);
  expect(completeSpy).toHaveBeenCalledWith(bound, claim);
  expect(initiateSpy).not.toHaveBeenCalled();
  expect(FiscalTestExecutionAuthorizationService.readBound).not.toHaveBeenCalled();
  claimSpy.mockResolvedValueOnce(undefined);
  await expect(RestaurantFiscalWorkProcessor.process(bound)).resolves.toEqual({ state: "NOT_CLAIMED" });
  expect(workflow.create).toHaveBeenCalledTimes(1);
  await expect(RestaurantFiscalWorkProcessor.process({ ...bound, fiscalBinding: { ...bound.fiscalBinding, environment: "PRODUCTION" } }))
    .resolves.toEqual({ state: "NOT_CLAIMED" });
  expect(prepare).toHaveBeenCalledTimes(1);
});
test.each(["missing authorization", "expired authorization"])("%s stays blocked without provider mutation", async () => {
  jest.spyOn(FiscalTestExecutionAuthorizationService, "readBound").mockRejectedValue(new Error("denied"));
  expect(await RestaurantFiscalWorkProcessor.process(work)).toEqual({ state: "BLOCKED" });
  expect(blockSpy).toHaveBeenCalledWith(work, claim);
  expect(initiateSpy).not.toHaveBeenCalled();
});
test("disabled gate stays blocked without provider mutation", async () => {
  process.env.FISCAL_REAL_TEST_ENABLED = "0";
  expect(await RestaurantFiscalWorkProcessor.process(work)).toEqual({ state: "BLOCKED" });
  expect(blockSpy).toHaveBeenCalledWith(work, claim);
  expect(initiateSpy).not.toHaveBeenCalled();
});
test("duplicate delivery cannot invoke fiscal service without a claim", async () => {
  claimSpy.mockResolvedValue(undefined);
  expect(await RestaurantFiscalWorkProcessor.process(work)).toEqual({ state: "NOT_CLAIMED" });
  expect(initiateSpy).not.toHaveBeenCalled();
});
test("a crash after authentic confirmation settles work without another mutation", async () => {
  claimSpy.mockResolvedValue(undefined);
  resultSpy.mockResolvedValue({ status: "CONFIRMED", evidenceOrigin: "DGI_TEST",
    securityElements: { qrCode: "provider-qr" } } as never);
  expect(await RestaurantFiscalWorkProcessor.process(work)).toEqual({ state: "CONFIRMED" });
  expect(settleSpy).toHaveBeenCalledWith(work);
  expect(initiateSpy).not.toHaveBeenCalled();
  expect(confirmSpy).not.toHaveBeenCalled();
});
test("uncertain CREATE remains unresolved and is never confirmed or completed", async () => {
  initiateSpy.mockResolvedValue({ status: "UNKNOWN_OUTCOME" } as never);
  expect(await RestaurantFiscalWorkProcessor.process(work)).toEqual({ state: "UNKNOWN_OUTCOME" });
  expect(reconcileSpy).not.toHaveBeenCalled();
  expect(confirmSpy).not.toHaveBeenCalled();
  expect(completeSpy).not.toHaveBeenCalled();
});
test("interrupted provider command does not retry inside the processor", async () => {
  initiateSpy.mockRejectedValue(new Error("transport"));
  expect(await RestaurantFiscalWorkProcessor.process(work)).toEqual({ state: "UNRESOLVED" });
  expect(initiateSpy).toHaveBeenCalledTimes(1);
  expect(confirmSpy).not.toHaveBeenCalled();
});
test("known pre-reservation seller failure is fenced BLOCKED with safe diagnostic", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  initiateSpy.mockRejectedValue(new Error("FISCAL_SELLER_IDENTITY_INCOMPLETE"));
  expect(await RestaurantFiscalWorkProcessor.process(work)).toEqual({ state: "BLOCKED" });
  expect(blockSpy).toHaveBeenCalledWith(work, claim);
  expect(confirmSpy).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith(expect.stringContaining("FISCAL_SELLER_IDENTITY_INCOMPLETE"));
});
test("ambiguous reservation or IAM failure remains unresolved without provider retry", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  initiateSpy.mockRejectedValue(new Error("private AccessDeniedException details"));
  expect(await RestaurantFiscalWorkProcessor.process(work)).toEqual({ state: "UNRESOLVED" });
  expect(blockSpy).not.toHaveBeenCalled();
  expect(confirmSpy).not.toHaveBeenCalled();
  expect(JSON.stringify(log.mock.calls)).not.toContain("private");
});
test("a seller error after CREATE cannot downgrade an existing attempt to BLOCKED", async () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  confirmSpy.mockRejectedValue(new Error("FISCAL_SELLER_IDENTITY_INCOMPLETE"));
  expect(await RestaurantFiscalWorkProcessor.process(work)).toEqual({ state: "UNRESOLVED" });
  expect(blockSpy).not.toHaveBeenCalled();
});
test("uncertain CONFIRM leaves work unresolved for authoritative recovery", async () => {
  confirmSpy.mockResolvedValue({ status: "UNKNOWN_OUTCOME" } as never);
  expect(await RestaurantFiscalWorkProcessor.process(work)).toEqual({ state: "UNKNOWN_OUTCOME" });
  expect(confirmSpy).toHaveBeenCalledTimes(1);
  expect(completeSpy).not.toHaveBeenCalled();
  expect(blockSpy).not.toHaveBeenCalled();
});
test("configured pilot discards historical Stream backlog before any claim or provider operation", async () => {
  process.env.FISCAL_AUTOMATIC_POLICY = JSON.stringify({orgId: work.orgId,
    outletId: work.outletId, connectionId: work.invoiceId,
    delegatedBy: work.sessionId, activatedAt: "2026-11-24T13:00:00.000Z"});
  try {
    expect(await RestaurantFiscalWorkProcessor.process(work)).toEqual({state: "NOT_CLAIMED"});
    expect(claimSpy).not.toHaveBeenCalled();
    expect(initiateSpy).not.toHaveBeenCalled();
    expect(reconcileSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  } finally { delete process.env.FISCAL_AUTOMATIC_POLICY; }
});

test("post-cutoff automatic work prepares delegated authority then completes the existing workflow", async () => {
  process.env.FISCAL_AUTOMATIC_POLICY = JSON.stringify({orgId: work.orgId,
    outletId: work.outletId, connectionId: work.invoiceId,
    delegatedBy: work.sessionId, activatedAt: "2026-11-18T09:00:00.000Z"});
  jest.mocked(RestaurantInvoiceSourceVerifier.verify).mockResolvedValue({verified: true,
    evidence: {proof: {digest: "a".repeat(64)}, invoice: {issuedAt: work.createdAt}}} as never);
  jest.spyOn(AutomaticPreparation, "prepare").mockResolvedValue({proofId: work.invoiceId, proofDigest: "a".repeat(64)} as never);
  const approve = jest.spyOn(FiscalTestExecutionAuthorizationService, "approveAutomaticProof").mockResolvedValue({} as never);
  try {
    expect(await RestaurantFiscalWorkProcessor.process(work)).toEqual({state: "CONFIRMED"});
    expect(approve).toHaveBeenCalledTimes(1);
    expect(initiateSpy).toHaveBeenCalledTimes(1);
    expect(reconcileSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(completeSpy).toHaveBeenCalledWith(work, claim);
  } finally { delete process.env.FISCAL_AUTOMATIC_POLICY; }
});
