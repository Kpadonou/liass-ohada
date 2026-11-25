import { prepareRestaurantFiscalInvoice } from "@/lambda/domains/restaurants/fiscal-preparation";
jest.mock("@/lambda/domains/restaurants/fiscal-preparation", () => ({prepareRestaurantFiscalInvoice: jest.fn()}));
import { automaticFiscalEligible, automaticFiscalPolicy, prepareAutomaticFiscalAuthorization } from "@/lambda/domains/restaurants/automatic-fiscal-policy";
import { RestaurantFiscalAuthorizationPreparationService as Preparation } from "@/lambda/domains/restaurants/fiscal-authorization-preparation-service";
import { FiscalTestExecutionAuthorizationService as Authorization } from "@/lambda/shared/services/fiscal-test-execution-authorization-service";
const policy = { orgId: "org", outletId: "11111111-1111-4111-8111-111111111111",
  connectionId: "22222222-2222-4222-8222-222222222222", delegatedBy: "33333333-3333-4333-8333-333333333333",
  activatedAt: "2026-11-24T12:00:00.000Z" };
const work = { ...policy, sessionId: policy.outletId, invoiceId: policy.connectionId,
  actorId: policy.delegatedBy, createdAt: "2026-11-24T12:01:00.000Z" };
beforeEach(() => { jest.mocked(prepareRestaurantFiscalInvoice).mockResolvedValue({ready: true, preparation: {lines: [{fiscal: {taxGroup: "A"}, commercial: {snapshot: {quantity: 2}}}, {fiscal: {taxGroup: "B"}, commercial: {snapshot: {quantity: 3}}}]}} as never); process.env.STAGE = "dev"; process.env.FISCAL_AUTOMATIC_POLICY = JSON.stringify(policy); });
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
  expect(Preparation.prepare).toHaveBeenCalledWith(expect.objectContaining({scenarioId: "03"}));
  expect(approve).toHaveBeenCalledWith(policy, expect.objectContaining({ connectionId: policy.connectionId }), work.createdAt);
});
test("mismatching immutable FINAL time cannot prepare authorization", async () => {
  const prepare = jest.spyOn(Preparation, "prepare");
  await expect(prepareAutomaticFiscalAuthorization(work, policy.activatedAt)).rejects.toThrow("SCOPE_DENIED");
  expect(prepare).not.toHaveBeenCalled();
});
test("policy accepts genuine Cognito subjects without assuming RFC UUID variant bits", () => {
  process.env.FISCAL_AUTOMATIC_POLICY = JSON.stringify({...policy, delegatedBy: "2189c04e-00f1-702c-d8e5-c38569e8974e"});
  expect(automaticFiscalPolicy()?.delegatedBy).toBe("2189c04e-00f1-702c-d8e5-c38569e8974e");
});

test.each([
  { id: "04", lines: [["A", 2.5], ["B", 3.25]] },
  { id: "05", lines: [["A", 2], ["B", 3]], customer: true },
  { id: "07", lines: [["B", 3, "3000"]], customer: true },
  { id: "08", lines: [["A", 2], ["B", 3]], aib: "B" },
  { id: "09", lines: [["A", 2], ["B", 3]], customer: true, aib: "A" },
  { id: "10", lines: [["A", 2], ["B", 3, "3000"]], aib: "B" },
  { id: "12", lines: [["D", 2]] },
  { id: "13", lines: [["D", 2, "3000"]] },
  { id: "14", lines: [["E", 2]] },
  { id: "15", lines: [["E", 2, "3000"]] },
  { id: "16", lines: [["C", 2]] },
  { id: "17", lines: [["A", 2], ["C", 3]] },
])("automatic case $id reaches the existing scoped authorization boundary", async sample => {
  jest.mocked(prepareRestaurantFiscalInvoice).mockResolvedValue({ ready: true, preparation: {
    lines: sample.lines.map(([taxGroup, quantity, taxSpecificMinor]) => ({
      fiscal: { taxGroup, ...(taxSpecificMinor ? { taxSpecificMinor } : {}) },
      commercial: { snapshot: { quantity } },
    })),
    ...("customer" in sample ? { customer: { name: "Declaration fixture", ifu: "fixture-only" } } : {}),
    ...("aib" in sample ? { aib: sample.aib } : {}),
  } } as never);
  const prepare = jest.spyOn(Preparation, "prepare").mockResolvedValue({ proofId: policy.outletId, proofDigest: "a".repeat(64) } as never);
  jest.spyOn(Authorization, "approveAutomaticProof").mockResolvedValue({} as never);
  await prepareAutomaticFiscalAuthorization(work, work.createdAt);
  expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ scenarioId: sample.id, automaticPolicy: true }));
});
