import { FiscalSourcePreparationProofService } from "@/lambda/shared/services/fiscal-source-preparation-proof-service";
import { RestaurantInvoiceSourceVerifier } from "@/lambda/domains/restaurants/invoice-source-verifier";
import { RestaurantStaffService } from "@/lambda/domains/restaurants/staff-service";
import { RestaurantFiscalAuthorizationPreparationService as Service } from "@/lambda/domains/restaurants/fiscal-authorization-preparation-service";
import * as preparationModule from "@/lambda/domains/restaurants/fiscal-preparation";
import * as mapperModule from "@/lambda/domains/restaurants/benin-fiscal-request-mapper";

const ids = {
  outletId: "76d54ba2-ee98-4373-8d3f-567920e91a73",
  actorId: "2189c04e-00f1-402c-98e5-c38569e8974e",
  sessionId: "62f61225-43ce-45bf-8381-8474fd9b8ab9",
  invoiceId: "60a509af-e385-4185-b86c-bf60be6c7b57",
  commandId: "fb7ea76f-3b16-4e45-83f2-5fbc90c2d770",
};
const request = () => ({ orgId: "org-a", ...ids, scenarioId: "02" });
const source = {
  verified: true,
  evidence: {
    issuanceProvenance: { verified: true, evidence: { evidenceOrigin: "AUTHENTIC" } },
  },
} as never;
const prepared = {
  ready: true,
  preparation: {
    source: { orgId: "org-a", outletId: ids.outletId, guestSessionId: ids.sessionId,
      invoiceId: ids.invoiceId, sourceVersion: 7, financialRevision: 2 },
    commercialRootDigest: "a".repeat(64),
    provenance: { seller: { identityDigest: "b".repeat(64) } },
    paidByMethodMinor: { CASH: 2360, MOBILE_MONEY: 0, CARD: 0 },
    lines: [{
      fiscal: { taxGroup: "B", classificationEvidence: "verified-tax" },
      commercial: { snapshot: { quantity: 1 } },
    }],
  },
};
const mapped = {
  sourceDigest: "a".repeat(64), total: 2360,
  fiscalGroupTotals: { B: { gross: 2360, net: 2000, tax: 360 } },
  fiscalAdditionalTotals: { aib: 0, ts: 0 },
};
const proof = {
  proofId: "78345288-662a-49e7-bcc9-8bcc48f41f1e", proofDigest: "c".repeat(64),
  invoiceId: ids.invoiceId, scenarioId: "02", fiscalGroups: ["B"],
  expectedFiscalTotals: { ta: 0, tb: 18, tc: 0, td: 18, taa: 0, tab: 2360,
    tac: 0, tad: 0, tae: 0, taf: 0, hab: 2000, had: 0, vab: 360, vad: 0,
    aib: 0, ts: 0, total: 2360 },
  operations: { CREATE: 1, GET: 2, CONFIRM: 1, CANCEL: 1 },
  expiresAt: "2026-11-17T10:30:00.000Z", status: "PREPARED",
} as const;

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-11-17T10:00:00.000Z"));
  jest.restoreAllMocks();
  jest.spyOn(RestaurantInvoiceSourceVerifier, "verify").mockResolvedValue(source);
  jest.spyOn(preparationModule, "prepareRestaurantFiscalInvoice").mockResolvedValue(prepared as never);
  jest.spyOn(RestaurantStaffService, "get").mockResolvedValue({} as never);
  jest.spyOn(RestaurantStaffService, "dto").mockResolvedValue({
    displayName: "Opérateur vérifié", status: "ACTIVE", organizationMembershipActive: true,
    version: 3,
  } as never);
  jest.spyOn(mapperModule, "mapRestaurantBeninRequest").mockReturnValue(mapped as never);
  jest.spyOn(FiscalSourcePreparationProofService, "create").mockResolvedValue(proof as never);
});
afterEach(() => jest.useRealTimers());

test("authorized commercial actor prepares a server-derived scenario 02 proof", async () => {
  const result = await Service.prepare(request());
  expect(result).toEqual(proof);
  expect(RestaurantInvoiceSourceVerifier.verify).toHaveBeenCalledWith(
    { orgId: "org-a", outletId: ids.outletId }, ids.actorId, ids.sessionId, ids.invoiceId,
  );
  expect(FiscalSourcePreparationProofService.create).toHaveBeenCalledWith(
    expect.objectContaining({
      orgId: "org-a", operatorUserId: ids.actorId, sourceDigest: "a".repeat(64),
      sourceVersion: 7, financialRevision: 2, sellerAuthorityDigest: "b".repeat(64),
      scenarioId: "02", fiscalGroups: ["B"], commandId: ids.commandId,
    }),
  );
  expect(mapperModule.mapRestaurantBeninRequest).toHaveBeenCalledWith(
    expect.anything(), expect.anything(), expect.anything(), expect.anything(), "AUTHORIZATION_PROOF",
  );
});

test("ordinary group B specific-tax invoice needs no case 07 customer or certification proof", async () => {
  jest.mocked(preparationModule.prepareRestaurantFiscalInvoice).mockResolvedValueOnce({
    ...prepared, preparation: { ...prepared.preparation, lines: [{
      fiscal: { taxGroup: "B", taxSpecificMinor: 2000, classificationEvidence: "verified-tax" },
      commercial: { snapshot: { quantity: 2 } },
    }] },
  } as never);
  const result = await Service.prepareGeneralMapping(request());
  expect(result.mapping).toMatchObject({ invoiceType: "FV", taxGroups: ["B"] });
  expect(result.scenarioId).toBeUndefined();
  expect(mapperModule.mapRestaurantBeninRequest).toHaveBeenCalledWith(
    expect.anything(), expect.anything(), expect.anything(), expect.anything(), "AUTHORIZATION_PROOF",
  );
  expect(FiscalSourcePreparationProofService.create).not.toHaveBeenCalled();
});

test.each([
  [{ verified: false, denial: { code: "ACCESS_DENIED" } }, "FISCAL_SOURCE_UNAVAILABLE"],
  [{ verified: false, denial: { code: "NOT_FINAL" } }, "FISCAL_SOURCE_UNAVAILABLE"],
  [{ verified: false, denial: { code: "SOURCE_INTEGRITY" } }, "FISCAL_SOURCE_UNAVAILABLE"],
] as const)("rejects unauthorized, non-final or stale source %#", async (verification, code) => {
  jest.mocked(RestaurantInvoiceSourceVerifier.verify).mockResolvedValueOnce(verification as never);
  await expect(Service.prepare(request())).rejects.toMatchObject({ statusCode: 409, messageCode: code });
  expect(FiscalSourcePreparationProofService.create).not.toHaveBeenCalled();
});

test("rejects cross-scenario fiscal groups without persisting a proof", async () => {
  await expect(Service.prepare({ ...request(), scenarioId: "01" }))
    .rejects.toMatchObject({ statusCode: 409, messageCode: "FISCAL_SCENARIO_SOURCE_MISMATCH" });
  expect(FiscalSourcePreparationProofService.create).not.toHaveBeenCalled();
});

test("rejects a source whose server-derived quantities do not match the scenario", async () => {
  jest.mocked(preparationModule.prepareRestaurantFiscalInvoice).mockResolvedValueOnce({
    ...prepared, preparation: { ...prepared.preparation, lines: [{
      fiscal: { taxGroup: "B", classificationEvidence: "verified-tax" },
      commercial: { snapshot: { quantity: 3 } },
    }] },
  } as never);
  await expect(Service.prepare(request()))
    .rejects.toMatchObject({ statusCode: 409, messageCode: "FISCAL_SCENARIO_SOURCE_MISMATCH" });
  expect(FiscalSourcePreparationProofService.create).not.toHaveBeenCalled();
});

test("rejects a scenario requiring server-verified customer, AIB, or specific tax facts", async () => {
  jest.mocked(preparationModule.prepareRestaurantFiscalInvoice).mockResolvedValueOnce({
    ...prepared, preparation: { ...prepared.preparation, lines: [{
      fiscal: { taxGroup: "B", classificationEvidence: "verified-tax" },
      commercial: { snapshot: { quantity: 3 } },
    }] },
  } as never);
  await expect(Service.prepare({ ...request(), scenarioId: "07" }))
    .rejects.toMatchObject({ statusCode: 409, messageCode: "FISCAL_SCENARIO_SOURCE_MISMATCH" });
  expect(FiscalSourcePreparationProofService.create).not.toHaveBeenCalled();
});

test("rejects missing authentic issuance provenance", async () => {
  jest.mocked(RestaurantInvoiceSourceVerifier.verify).mockResolvedValueOnce({
    verified: true, evidence: { issuanceProvenance: { verified: false } },
  } as never);
  await expect(Service.prepare(request()))
    .rejects.toMatchObject({ statusCode: 409, messageCode: "PROVENANCE_UNAVAILABLE" });
});

test("passes the stable command identity so Phase 1 owns replay and concurrency", async () => {
  await Promise.all([Service.prepare(request()), Service.prepare(request())]);
  expect(FiscalSourcePreparationProofService.create).toHaveBeenCalledTimes(2);
  expect(jest.mocked(FiscalSourcePreparationProofService.create).mock.calls
    .every(([value]) => (value as { commandId: string }).commandId === ids.commandId)).toBe(true);
});
