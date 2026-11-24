import { automaticFiscalEligible, automaticFiscalPolicy, prepareAutomaticFiscalAuthorization } from "@/lambda/domains/restaurants/automatic-fiscal-policy";
import { RestaurantFiscalAuthorizationPreparationService as Preparation } from "@/lambda/domains/restaurants/fiscal-authorization-preparation-service";
import { FiscalTestExecutionAuthorizationService as Authorization } from "@/lambda/shared/services/fiscal-test-execution-authorization-service";
const policy = { orgId: "org", outletId: "11111111-1111-4111-8111-111111111111",
  connectionId: "22222222-2222-4222-8222-222222222222", delegatedBy: "33333333-3333-4333-8333-333333333333",
  activatedAt: "2026-11-24T12:00:00.000Z" };
const work = { ...policy, sessionId: policy.outletId, invoiceId: policy.connectionId,
  actorId: policy.delegatedBy, createdAt: "2026-11-24T12:01:00.000Z" };
beforeEach(() => { process.env.STAGE = "dev"; process.env.FISCAL_AUTOMATIC_POLICY = JSON.stringify(policy); });
afterEach(() => { delete process.env.STAGE; delete process.env.FISCAL_AUTOMATIC_POLICY; jest.restoreAllMocks(); });
test("only post-cutoff invoices in the exact tenant and outlet are eligible", () => {
  expect(automaticFiscalEligible(work)).toBe(true);
  expect(automaticFiscalEligible({ ...work, createdAt: policy.activatedAt })).toBe(false);
  expect(automaticFiscalEligible({ ...work, orgId: "other" })).toBe(false);
  expect(automaticFiscalEligible({ ...work, outletId: policy.connectionId })).toBe(false);
  process.env.STAGE = "prod";
  expect(automaticFiscalPolicy()).toBeUndefined();
});
test("authorized preparation reuses proof and existing scoped approval", async () => {
  jest.spyOn(Preparation, "prepare").mockResolvedValue({ proofId: policy.outletId, proofDigest: "a".repeat(64) } as never);
  const approve = jest.spyOn(Authorization, "approveAutomaticProof").mockResolvedValue({} as never);
  await prepareAutomaticFiscalAuthorization(work, work.createdAt);
  expect(approve).toHaveBeenCalledWith(policy, expect.objectContaining({ connectionId: policy.connectionId }), work.createdAt);
});
test("mismatching immutable FINAL time cannot prepare authorization", async () => {
  const prepare = jest.spyOn(Preparation, "prepare");
  await expect(prepareAutomaticFiscalAuthorization(work, policy.activatedAt)).rejects.toThrow("SCOPE_DENIED");
  expect(prepare).not.toHaveBeenCalled();
});
