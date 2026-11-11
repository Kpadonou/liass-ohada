import {
  adjudicateCapturedConfirmation,
  type FiscalAdjudicationReview,
} from "@/lambda/domains/fiscal-compliance/core/capture-adjudication";
import {
  reserveFiscalAttempt,
  transitionFiscalAttempt,
  type FiscalAttemptState,
} from "@/lambda/domains/fiscal-compliance/core/fiscal-attempt-state";
import { canonical, hash } from "@/lambda/shared/authority/integrity";

const identity = {
  orgId: "org-1",
  environment: "TEST" as const,
  sourceDomain: "restaurants",
  sourceDocumentType: "INVOICE",
  sourceDocumentId: "11111111-1111-4111-8111-111111111111",
  jurisdiction: "BJ",
  obligation: "NORMALIZE",
};
const source = {
  orgId: "org-1",
  outletId: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333",
  invoiceId: identity.sourceDocumentId,
  sourceDigest: "b".repeat(64),
  sellerIfu: "0202113816157",
  sellerNim: "TS01002103",
  expectedTotal: 2360,
};
const capture = {
  schemaVersion: 1 as const,
  environment: "TEST" as const,
  capturedAt: "2026-11-11T06:30:00.000Z",
  expiresAt: "2026-12-11T06:30:00.000Z",
  httpStatus: 200 as const,
  truncated: false as const,
  body: JSON.stringify({
    dateTime: "11/11/2026 06:30:00",
    qrCode: "private-qr",
    codeMECeFDGI: "private-code",
    counters: "1/1 FV",
    nim: source.sellerNim,
    refundWithAibPayment: false,
  }),
};
const captureReference = "a".repeat(64);
const context = {
  ...source,
  providerUid: "provider-uid",
  providerContextDigest: "c".repeat(64),
  fiscalTotalsDigest: "d".repeat(64),
};
const review = (): FiscalAdjudicationReview => ({
  reviewId: "44444444-4444-4444-8444-444444444444",
  reviewerUserId: "reviewer-1",
  reviewerRole: "FISCAL_COMPLIANCE_REVIEWER",
  authorizationReference: "D15-REM-SI-2026-11-11",
  reviewedAt: "2026-11-11T06:31:00.000Z",
  expectedVersion: 5,
  captureReference,
  captureDigest: hash(canonical(capture)),
  context,
});
function unknownState(): FiscalAttemptState {
  let state = reserveFiscalAttempt({
    identity,
    attemptId: "attempt-1",
    provider: "BENIN_EMECEF_TEST",
    execution: "REAL_TEST",
    sourceDigest: source.sourceDigest,
    requestDigest: "e".repeat(64),
    expectedTotal: source.expectedTotal,
  });
  state = transitionFiscalAttempt(state, identity, state.version, {
    kind: "RESERVE_MUTATION",
    operation: "CREATE",
    commandId: "create-1",
    intentDigest: "f".repeat(64),
  }).state;
  state = transitionFiscalAttempt(state, identity, state.version, {
    kind: "CREATED",
    commandId: "create-1",
    uid: context.providerUid,
    total: source.expectedTotal,
    fiscalTotalsVerified: true,
    providerContextDigest: context.providerContextDigest,
    fiscalTotalsDigest: context.fiscalTotalsDigest,
  }).state;
  state = transitionFiscalAttempt(state, identity, state.version, {
    kind: "RESERVE_MUTATION",
    operation: "CONFIRM",
    commandId: "confirm-1",
    intentDigest: "1".repeat(64),
    diagnosticReference: captureReference,
  }).state;
  return transitionFiscalAttempt(state, identity, state.version, {
    kind: "UNKNOWN",
    commandId: "confirm-1",
    diagnostic: {
      reference: captureReference,
      captured: true,
      mutationMayHaveExecuted: true,
      httpStatus: 200,
      category: "RESPONSE_VALIDATION",
    },
  }).state;
}
function adjudicate(
  state = unknownState(),
  input = review(),
  evidence = capture,
) {
  return adjudicateCapturedConfirmation(
    state,
    identity,
    input,
    evidence,
    source,
    "2026-11-11T06:32:00.000Z",
  );
}

test("builds an audited capture-bound confirmation without provider I/O", () => {
  const result = adjudicate();
  expect(result.audit).toMatchObject({
    decision: "CONFIRM_CAPTURED_DGI_TEST",
    evidenceOrigin: "DGI_TEST",
    captureReference,
    context: { sourceDigest: source.sourceDigest, sellerIfu: source.sellerIfu },
  });
  const confirmed = transitionFiscalAttempt(
    unknownState(),
    identity,
    5,
    result.event,
  ).state;
  expect(confirmed).toMatchObject({
    status: "CONFIRMED",
    securityEvidenceOrigin: "DGI_TEST",
    uid: context.providerUid,
    adjudication: { reviewId: review().reviewId },
  });
});
test("rejects tampering, missing evidence, wrong source, and invalid response", () => {
  expect(() =>
    adjudicate(unknownState(), review(), {
      ...capture,
      body: capture.body.replace("private-code", "changed"),
    }),
  ).toThrow();
  expect(() => adjudicate(unknownState(), review(), null as never)).toThrow();
  expect(() =>
    adjudicate(unknownState(), {
      ...review(),
      context: { ...context, sourceDigest: "9".repeat(64) },
    }),
  ).toThrow("FISCAL_ADJUDICATION_BINDING_MISMATCH");
  expect(() =>
    adjudicate(unknownState(), review(), {
      ...capture,
      httpStatus: 201 as never,
    }),
  ).toThrow();
  expect(() =>
    adjudicate(unknownState(), review(), {
      ...capture,
      truncated: true as never,
    }),
  ).toThrow();
  expect(() =>
    adjudicate(unknownState(), {
      ...review(),
      captureDigest: hash(
        canonical({
          ...capture,
          body: capture.body.replace(source.sellerNim, "wrong"),
        }),
      ),
    }, {
      ...capture,
      body: capture.body.replace(source.sellerNim, "wrong"),
    }),
  ).toThrow("FISCAL_ADJUDICATION_RESPONSE_INVALID");
});
test("rejects expired or unauthorized review evidence", () => {
  expect(() =>
    adjudicate(unknownState(), {
      ...review(),
      reviewedAt: "2027-01-01T00:00:00.000Z",
    }),
  ).toThrow("FISCAL_ADJUDICATION_TIME_INVALID");
  expect(() =>
    adjudicate(unknownState(), { ...review(), reviewerRole: "OWNER" as never }),
  ).toThrow();
  expect(() =>
    adjudicate(unknownState(), {
      ...review(),
      captureReference: "9".repeat(64),
    }),
  ).toThrow();
  expect(() =>
    adjudicate(unknownState(), {
      ...review(),
      context: { ...context, providerUid: "other" },
    }),
  ).toThrow();
});
test("stale, concurrent and replayed transitions fail closed", () => {
  const state = unknownState(),
    event = adjudicate(state).event;
  const confirmed = transitionFiscalAttempt(
    state,
    identity,
    state.version,
    event,
  ).state;
  expect(() =>
    transitionFiscalAttempt(state, identity, state.version - 1, event),
  ).toThrow("VERSION_CONFLICT");
  expect(() =>
    transitionFiscalAttempt(confirmed, identity, confirmed.version, event),
  ).toThrow("TRANSITION_DENIED");
});
