import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { RestaurantFiscalWorkProcessor } from "@/lambda/domains/restaurants/fiscal-work-processor";
import { recoverBlockedFiscalWork, recoverBoundFiscalWork } from "@/lambda/domains/restaurants/fiscal-work-recovery";
import * as boundWorkflow from "@/lambda/domains/restaurants/bound-fiscal-workflow";
import { canonical, hash } from "@/lambda/shared/authority/integrity";
import { handler, realTestFiscalService } from "@/lambda/domains/restaurants/real-test-fiscal-handler";
import { RestaurantFiscalWorkRepository } from "@/lambda/domains/restaurants/fiscal-work-repository";

const request = { type: "RECOVER_FISCAL_WORK_V1", orgId: "org",
  outletId: "00000000-0000-4000-8000-000000000001",
  sessionId: "00000000-0000-4000-8000-000000000002",
  invoiceId: "00000000-0000-4000-8000-000000000003" } as const;
const row = { ...request, PK: K.restaurantBillPK(request.orgId, request.outletId, request.invoiceId),
  SK: K.restaurantFiscalIntentSK(), entityType: "RESTAURANT_FISCAL_INTENT", schemaVersion: 1,
  actorId: "original-actor", createdAt: "2026-11-18T10:00:00.000Z", state: "BLOCKED" };
let readSpy: jest.SpyInstance, processSpy: jest.SpyInstance;
beforeEach(() => {
  process.env.RESTAURANTS_TABLE_NAME = "restaurants";
  readSpy = jest.spyOn(dynamoClient, "send").mockResolvedValue({ Item: marshall(row) } as never);
  processSpy = jest.spyOn(RestaurantFiscalWorkProcessor, "process").mockResolvedValue({ state: "CONFIRMED" });
});
afterEach(() => { jest.restoreAllMocks(); delete process.env.RESTAURANTS_TABLE_NAME; });

test("one BLOCKED intent resumes using persisted actor and creation identity", async () => {
  expect(await handler(request)).toEqual({ state: "CONFIRMED" });
  expect(readSpy.mock.calls[0][0]).toBeInstanceOf(GetItemCommand);
  expect(readSpy.mock.calls[0][0].input.ConsistentRead).toBe(true);
  expect(processSpy).toHaveBeenCalledWith({ orgId: request.orgId, outletId: request.outletId,
    sessionId: request.sessionId, invoiceId: request.invoiceId,
    actorId: row.actorId, createdAt: row.createdAt });
});
test("wrong session, tenant binding or non-BLOCKED state never invokes processor", async () => {
  await expect(recoverBlockedFiscalWork({ ...request, sessionId: "00000000-0000-4000-8000-000000000004" }))
    .rejects.toThrow("identity mismatch");
  readSpy.mockResolvedValueOnce({ Item: marshall({ ...row, state: "UNKNOWN_OUTCOME" }) });
  await expect(recoverBlockedFiscalWork(request)).rejects.toThrow();
  expect(processSpy).not.toHaveBeenCalled();
});
test("missing persisted intent cannot be recovered", async () => {
  readSpy.mockResolvedValueOnce({});
  await expect(recoverBlockedFiscalWork(request)).rejects.toThrow("not found");
  expect(processSpy).not.toHaveBeenCalled();
});
test("duplicate recovery delegates to processor fencing without a second mutation path", async () => {
  processSpy.mockResolvedValueOnce({ state: "BLOCKED" }).mockResolvedValueOnce({ state: "NOT_CLAIMED" });
  expect(await Promise.all([recoverBlockedFiscalWork(request), recoverBlockedFiscalWork(request)]))
    .toEqual([{ state: "BLOCKED" }, { state: "NOT_CLAIMED" }]);
  expect(processSpy).toHaveBeenCalledTimes(2);
});
test("bound recovery requires immutable TEST binding and exact claim version before processor", async () => {
  const fiscalBinding = { environment: "TEST", connectionId: request.outletId,
    issuancePointId: request.outletId, policyVersion: 1 };
  readSpy.mockResolvedValue({ Item: marshall({ ...row, claimVersion: 1, fiscalBinding }) });
  const preflight = jest.spyOn(boundWorkflow, "prepareBoundRestaurantWorkflow").mockResolvedValue({} as never);
  const bound = { ...request, type: "RECOVER_BOUND_FISCAL_WORK_V1" as const,
    expectedClaimVersion: 1, expectedBindingDigest: hash(canonical(fiscalBinding)) };
  await expect(recoverBoundFiscalWork({ ...bound, expectedClaimVersion: 2 })).rejects.toThrow("identity mismatch");
  await expect(recoverBoundFiscalWork({ ...bound, expectedBindingDigest: "a".repeat(64) })).rejects.toThrow("identity mismatch");
  expect(preflight).not.toHaveBeenCalled();
  expect(processSpy).not.toHaveBeenCalled();
  await expect(recoverBoundFiscalWork(bound)).resolves.toEqual({ state: "CONFIRMED" });
  expect(preflight).toHaveBeenCalledWith(expect.objectContaining({ fiscalBinding, invoiceId: request.invoiceId }));
  expect(processSpy).toHaveBeenCalledTimes(1);
});
test("bound recovery preflight failure never claims or invokes provider", async () => {
  const fiscalBinding = { environment: "TEST", connectionId: request.outletId,
    issuancePointId: request.outletId, policyVersion: 1 };
  readSpy.mockResolvedValue({ Item: marshall({ ...row, claimVersion: 1, fiscalBinding }) });
  jest.spyOn(boundWorkflow, "prepareBoundRestaurantWorkflow").mockRejectedValue(new Error("FISCAL_SOURCE_MISMATCH"));
  await expect(recoverBoundFiscalWork({ ...request, type: "RECOVER_BOUND_FISCAL_WORK_V1",
    expectedClaimVersion: 1, expectedBindingDigest: hash(canonical(fiscalBinding)) }))
    .rejects.toThrow("FISCAL_SOURCE_MISMATCH");
  expect(processSpy).not.toHaveBeenCalled();
});
test("local completion uses persisted confirmation without entering execution, including replay", async () => {
  readSpy.mockResolvedValue({ Item: marshall({ ...row, state: "CLAIMED" }) });
  jest.spyOn(realTestFiscalService, "confirmedResult").mockResolvedValue({ confirmed: true,
    status: "CONFIRMED", evidenceOrigin: "DGI_TEST", securityElements: { qrCode: "persisted-qr" } } as never);
  const settle = jest.spyOn(RestaurantFiscalWorkRepository, "settleConfirmed").mockResolvedValue();
  const local = { ...request, type: "COMPLETE_CONFIRMED_FISCAL_WORK_V1" as const };
  expect(await handler(local)).toMatchObject({ workState: "CONFIRMED", securityElements: { qrCode: "persisted-qr" } });
  readSpy.mockResolvedValue({ Item: marshall({ ...row, state: "CONFIRMED" }) });
  expect(await handler(local)).toMatchObject({ workState: "CONFIRMED" });
  expect(settle).toHaveBeenCalledTimes(2);
  expect(processSpy).not.toHaveBeenCalled();
});
test("local completion rejects absent confirmation and cross-tenant identity", async () => {
  readSpy.mockResolvedValue({ Item: marshall({ ...row, state: "CLAIMED" }) });
  jest.spyOn(realTestFiscalService, "confirmedResult").mockResolvedValue({ confirmed: false } as never);
  const settle = jest.spyOn(RestaurantFiscalWorkRepository, "settleConfirmed").mockResolvedValue();
  const local = { ...request, type: "COMPLETE_CONFIRMED_FISCAL_WORK_V1" as const };
  await expect(handler(local)).rejects.toThrow("confirmation required");
  await expect(handler({ ...local, orgId: "foreign" })).rejects.toThrow("identity mismatch");
  expect(settle).not.toHaveBeenCalled();
  expect(processSpy).not.toHaveBeenCalled();
});
