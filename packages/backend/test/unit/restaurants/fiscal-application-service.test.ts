import { RestaurantFiscalApplicationService } from "@/lambda/domains/restaurants/fiscal-application-service";
import { RestaurantReceiptService } from "@/lambda/domains/restaurants/receipt-service";
import { RestaurantInvoiceSourceVerifier } from "@/lambda/domains/restaurants/invoice-source-verifier";
import { FiscalAttemptStore } from "@/lambda/domains/fiscal-compliance/persistence/fiscal-attempt-store";
import { restaurantBeninSyntheticWorkflow } from "@/lambda/domains/restaurants/benin-synthetic-workflow";
import {
  reserveFiscalAttempt,
  transitionFiscalAttempt,
  FiscalAttemptState,
} from "@/lambda/domains/fiscal-compliance/core/fiscal-attempt-state";
import { scope, id, digest, provenance } from "./provenance-fixture";
jest.mock("@/lambda/domains/restaurants/benin-synthetic-workflow", () => ({
  restaurantBeninSyntheticWorkflow: jest.fn(),
}));
const context = { orgId: scope.orgId, userId: "synthetic-actor" };
const request = { outletId: id, sessionId: id, invoiceId: id };
const identity = {
  orgId: scope.orgId,
  environment: "TEST" as const,
  sourceDomain: "restaurants",
  sourceDocumentType: "INVOICE",
  sourceDocumentId: id,
  jurisdiction: "BJ",
  obligation: "NORMALIZE",
};
const command = { ...request, attemptId: "attempt", commandId: "create" };
let state: FiscalAttemptState | undefined;
const create = jest.fn();
const confirm = jest.fn();
const settings = jest.fn();
let service: RestaurantFiscalApplicationService;
beforeEach(() => {
  process.env.FISCAL_SYNTHETIC_APPLICATION = "1";
  state = undefined;
  create.mockReset();
  confirm.mockReset();
  settings.mockReset().mockResolvedValue({});
  jest
    .spyOn(RestaurantReceiptService, "authorize")
    .mockResolvedValue({ actions: [], role: "OWNER" });
  jest.spyOn(RestaurantInvoiceSourceVerifier, "verify").mockResolvedValue({
    verified: true,
    evidence: {
      proof: { digest },
      issuanceProvenance: { verified: true, evidence: provenance },
    },
  } as never);
  jest
    .spyOn(FiscalAttemptStore.prototype, "read")
    .mockImplementation(async () => state);
  (restaurantBeninSyntheticWorkflow as jest.Mock).mockReturnValue({
    create,
    confirm,
  });
  create.mockImplementation(async () => {
    state = reserveFiscalAttempt({
      identity,
      attemptId: "attempt",
      provider: "BENIN_EMECEF_TEST",
      sourceDigest: digest,
      requestDigest: digest,
      expectedTotal: 2000,
    });
    state = transitionFiscalAttempt(state, identity, 1, {
      kind: "RESERVE_MUTATION",
      operation: "CREATE",
      commandId: "create",
      intentDigest: digest,
    }).state;
    state = transitionFiscalAttempt(state, identity, 2, {
      kind: "CREATED",
      commandId: "create",
      uid: "private-uid",
      total: 2000,
    }).state;
  });
  service = new RestaurantFiscalApplicationService(settings);
});
afterEach(() => {
  delete process.env.FISCAL_SYNTHETIC_APPLICATION;
  jest.restoreAllMocks();
});
test("initiate and same-command replay dispatch once, while changed intent conflicts", async () => {
  expect((await service.initiate(context, command)).status).toBe("CREATED");
  expect((await service.initiate(context, command)).status).toBe("CREATED");
  expect(create).toHaveBeenCalledTimes(1);
  await expect(
    service.initiate(context, { ...command, commandId: "other" }),
  ).rejects.toThrow();
  expect(create).toHaveBeenCalledTimes(1);
});
test.each(["membership", "entitlement", "source"])(
  "denies missing %s before workflow construction",
  async (reason) => {
    if (reason === "source")
      jest
        .mocked(RestaurantInvoiceSourceVerifier.verify)
        .mockResolvedValueOnce({
          verified: false,
          denial: { code: "ACCESS_DENIED" },
        });
    else
      jest
        .mocked(RestaurantReceiptService.authorize)
        .mockRejectedValueOnce(new Error("denied"));
    await expect(service.initiate(context, command)).rejects.toThrow();
    expect(settings).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  },
);
test("foreign tenant cannot select a stored source or receive fiscal results", async () => {
  jest
    .mocked(RestaurantInvoiceSourceVerifier.verify)
    .mockImplementation(async (scope) => {
      expect(scope.orgId).toBe("foreign");
      return { verified: false, denial: { code: "SOURCE_UNAVAILABLE" } };
    });
  await expect(
    service.status({ ...context, orgId: "foreign" }, request),
  ).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
});
test("unknown outcome is readable and replay never dispatches", async () => {
  await service.initiate(context, command);
  state = transitionFiscalAttempt(state!, identity, 3, {
    kind: "RESERVE_MUTATION",
    operation: "CONFIRM",
    commandId: "confirm",
    intentDigest: digest,
  }).state;
  state = transitionFiscalAttempt(state, identity, 4, {
    kind: "UNKNOWN",
    commandId: "confirm",
  }).state;
  expect(await service.initiate(context, command)).toMatchObject({
    status: "UNKNOWN_OUTCOME",
    uncertainOperation: "CONFIRM",
    mutationRetryAllowed: false,
    securityElements: null,
  });
  expect(create).toHaveBeenCalledTimes(1);
});
test("confirmed result never exposes synthetic security as legal evidence", async () => {
  await service.initiate(context, command);
  state = transitionFiscalAttempt(state!, identity, 3, {
    kind: "RESERVE_MUTATION",
    operation: "CONFIRM",
    commandId: "confirm",
    intentDigest: digest,
  }).state;
  state = transitionFiscalAttempt(state, identity, 4, {
    kind: "CONFIRMED",
    commandId: "confirm",
    security: {
      dateTime: "private-date",
      qrCode: "private-qr",
      codeMECeFDGI: "private-code",
      counters: "private-counter",
      nim: "private-nim",
    },
  }).state;
  const result = await service.confirmedResult(context, request);
  expect(result).toMatchObject({
    resultAvailable: true,
    evidenceOrigin: "SYNTHETIC",
    legallyNormalized: false,
    normalizedInvoice: null,
    securityElements: null,
  });
  expect(JSON.stringify(result)).not.toContain("private-");
});
test("requires explicit confirmation and test application activation", async () => {
  await expect(
    service.confirm(context, {
      ...request,
      commandId: "confirm",
      confirm: false,
    }),
  ).rejects.toThrow();
  expect(confirm).not.toHaveBeenCalled();
  delete process.env.FISCAL_SYNTHETIC_APPLICATION;
  await expect(service.status(context, request)).rejects.toThrow();
});
test("historical absence cannot initiate and source-digest mismatch cannot read", async () => {
  jest.mocked(RestaurantInvoiceSourceVerifier.verify).mockResolvedValueOnce({
    verified: true,
    evidence: {
      proof: { digest },
      issuanceProvenance: {
        verified: false,
        reason: "PROVENANCE_UNAVAILABLE",
      },
    },
  } as never);
  await expect(service.initiate(context, command)).rejects.toThrow();
  await service.initiate(context, command);
  state = { ...state!, sourceDigest: "b".repeat(64) };
  await expect(service.status(context, request)).rejects.toThrow();
});

test("fresh confirmation dispatch is explicit and uncertain state blocks it", async () => {
  await service.initiate(context, command);
  await service.confirm(context, {
    ...request,
    commandId: "confirm",
    confirm: true,
  });
  expect(confirm).toHaveBeenCalledTimes(1);
  state = transitionFiscalAttempt(state!, identity, 3, {
    kind: "RESERVE_MUTATION",
    operation: "CONFIRM",
    commandId: "confirm",
    intentDigest: digest,
  }).state;
  state = transitionFiscalAttempt(state, identity, 4, {
    kind: "UNKNOWN",
    commandId: "confirm",
  }).state;
  await expect(
    service.confirm(context, { ...request, commandId: "again", confirm: true }),
  ).rejects.toThrow();
  expect(confirm).toHaveBeenCalledTimes(1);
});

test.each([undefined, "SYNTHETIC", "AUTHENTIC"] as const)("real application rejects non-authentic source: %s", async origin => {
  Object.assign(process.env, { FISCAL_EXECUTION_MODE: "REAL_TEST", FISCAL_REAL_TEST_ENABLED: "1", STAGE: "dev" });
  try {
    jest.mocked(RestaurantInvoiceSourceVerifier.verify).mockResolvedValue({ verified: true, evidence: {
      proof: { digest }, issuanceProvenance: { verified: true, evidence: { ...provenance, evidenceOrigin: origin } },
    } } as never);
    const real = new RestaurantFiscalApplicationService(settings, true);
    if (origin === "AUTHENTIC") expect(await real.status(context, request)).toMatchObject({ execution: "REAL_TEST", securityElements: null });
    else await expect(real.status(context, request)).rejects.toThrow();
    expect(settings).not.toHaveBeenCalled();
  } finally { delete process.env.FISCAL_EXECUTION_MODE; delete process.env.FISCAL_REAL_TEST_ENABLED; delete process.env.STAGE; }
});

test.each(["CREATE", "CONFIRM"] as const)(
  "only the bound operator can fence an interrupted %s, with no provider call",
  async (operation) => {
    const gate = jest.spyOn(
      await import("@/lambda/domains/fiscal-compliance/core/test-execution"),
      "realFiscalTestEnabled",
    ).mockReturnValue(true);
    try {
      jest.mocked(RestaurantInvoiceSourceVerifier.verify).mockResolvedValue({
        verified: true,
        evidence: {
          proof: { digest },
          issuanceProvenance: { verified: true, evidence: { ...provenance, evidenceOrigin: "AUTHENTIC" } },
        },
      } as never);
      settings.mockResolvedValue({
        realConfiguration: { ...request, orgId: context.orgId, operatorUserId: context.userId, sourceDigest: digest },
      });
      state = reserveFiscalAttempt({
        identity, attemptId: "attempt", provider: "BENIN_EMECEF_TEST", execution: "REAL_TEST",
        sourceDigest: digest, requestDigest: digest, expectedTotal: 2000,
      });
      state = transitionFiscalAttempt(state, identity, state.version, {
        kind: "RESERVE_MUTATION", operation: "CREATE", commandId: "create", intentDigest: digest,
      }).state;
      if (operation === "CONFIRM") {
        state = transitionFiscalAttempt(state, identity, state.version, {
          kind: "CREATED", commandId: "create", uid: "private-uid", total: 2000, fiscalTotalsVerified: true,
        }).state;
        state = transitionFiscalAttempt(state, identity, state.version, {
          kind: "RESERVE_MUTATION", operation, commandId: "confirm", intentDigest: digest,
          diagnosticReference: digest,
        }).state;
      }
      const recover = jest.spyOn(FiscalAttemptStore.prototype, "recover")
        .mockImplementation(async (scope, version) => {
          const result = transitionFiscalAttempt(state!, scope, version, { kind: "RECOVER_INTERRUPTED" });
          state = result.state;
          return result;
        });
      const real = new RestaurantFiscalApplicationService(settings, true);
      const input = { ...request, commandId: operation.toLowerCase(), executionStopped: true };
      await expect(real.recover({ ...context, userId: "other" }, input)).rejects.toMatchObject({ statusCode: 403 });
      await expect(real.recover(context, { ...input, commandId: "other" })).rejects.toMatchObject({ statusCode: 409 });
      expect(recover).not.toHaveBeenCalled();
      expect(await real.recover(context, input)).toMatchObject({
        status: "UNKNOWN_OUTCOME", uncertainOperation: operation, mutationRetryAllowed: false,
      });
      expect(await real.recover(context, input)).toMatchObject({ status: "UNKNOWN_OUTCOME" });
      expect(recover).toHaveBeenCalledTimes(1);
      expect(create).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      gate.mockRestore();
    }
  },
);

test("authorized result retrieves durable DGI TEST security while pending evidence stays hidden", async () => {
  await service.initiate(context, command);
  const security = { dateTime: "2026-11-14 10:00:00", qrCode: "DGI-TEST-QR",
    codeMECeFDGI: "DGI-CODE", counters: "1/1 FV", nim: "TEST-NIM" };
  const base = state!;
  Object.assign(process.env, { FISCAL_EXECUTION_MODE: "REAL_TEST", FISCAL_REAL_TEST_ENABLED: "1", STAGE: "dev" });
  jest.mocked(RestaurantInvoiceSourceVerifier.verify).mockResolvedValue({ verified: true, evidence: {
    proof: { digest }, issuanceProvenance: { verified: true, evidence: { ...provenance, evidenceOrigin: "AUTHENTIC" } },
  } } as never);
  try {
    const real = new RestaurantFiscalApplicationService(settings, true);
    state = { ...base, execution: "REAL_TEST", status: "CONFIRMED", security,
      securityEvidenceOrigin: "DGI_TEST", diagnostic: { captured: true, reference: digest } };
    expect(await real.confirmedResult(context, request)).toMatchObject({
      resultAvailable: true, legallyNormalized: false, securityElements: security,
    });
    state = { ...state, status: "UNKNOWN_OUTCOME", uncertainOperation: "CONFIRM" };
    expect(await real.confirmedResult(context, request)).toMatchObject({
      resultAvailable: false, securityElements: null, mutationRetryAllowed: false,
    });
  } finally {
    delete process.env.FISCAL_EXECUTION_MODE; delete process.env.FISCAL_REAL_TEST_ENABLED; delete process.env.STAGE;
  }
});
