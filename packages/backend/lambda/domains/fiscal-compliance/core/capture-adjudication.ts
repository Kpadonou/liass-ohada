import { z } from "zod";
import { canonical, hash } from "@/lambda/shared/authority/integrity";
import type {
  FiscalAttemptState,
  FiscalObligationIdentity,
} from "./fiscal-attempt-state";
import { SecurityElementsDtoSchema } from "../providers/benin-emecef/invoice-dtos";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().trim().min(1).max(200);

export const confirmationCaptureEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    environment: z.literal("TEST"),
    capturedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    httpStatus: z.literal(200),
    truncated: z.literal(false),
    body: z
      .string()
      .min(2)
      .max(64 * 1024),
  })
  .strict();

const reviewContextSchema = z
  .object({
    orgId: id,
    outletId: z.string().uuid(),
    sessionId: z.string().uuid(),
    invoiceId: z.string().uuid(),
    sourceDigest: digest,
    sellerIfu: id,
    sellerNim: id,
    providerUid: id,
    expectedTotal: z.number().int().positive().safe(),
    providerContextDigest: digest,
    fiscalTotalsDigest: digest,
  })
  .strict();
export const immutableFiscalSourceBindingSchema = reviewContextSchema
  .pick({
    orgId: true,
    outletId: true,
    sessionId: true,
    invoiceId: true,
    sourceDigest: true,
    sellerIfu: true,
    sellerNim: true,
    expectedTotal: true,
  })
  .strict();
export type ImmutableFiscalSourceBinding = z.infer<
  typeof immutableFiscalSourceBindingSchema
>;

export const fiscalAdjudicationReviewSchema = z
  .object({
    reviewId: z.string().uuid(),
    reviewerUserId: id,
    reviewerRole: z.literal("FISCAL_COMPLIANCE_REVIEWER"),
    authorizationReference: id,
    reviewedAt: z.string().datetime({ offset: true }),
    expectedVersion: z.number().int().positive().safe(),
    captureReference: digest,
    captureDigest: digest,
    context: reviewContextSchema,
  })
  .strict();
export type FiscalAdjudicationReview = z.infer<
  typeof fiscalAdjudicationReviewSchema
>;

export const fiscalAdjudicationAuditSchema = fiscalAdjudicationReviewSchema
  .extend({
    decision: z.literal("CONFIRM_CAPTURED_DGI_TEST"),
    responseDigest: digest,
    evidenceOrigin: z.literal("DGI_TEST"),
  })
  .strict();
export type FiscalAdjudicationAudit = z.infer<
  typeof fiscalAdjudicationAuditSchema
>;

export function adjudicateCapturedConfirmation(
  state: FiscalAttemptState,
  scope: FiscalObligationIdentity,
  reviewInput: FiscalAdjudicationReview,
  captureInput: unknown,
  sourceInput: ImmutableFiscalSourceBinding,
  now = new Date().toISOString(),
) {
  const review = fiscalAdjudicationReviewSchema.parse(reviewInput);
  const capture = confirmationCaptureEnvelopeSchema.parse(captureInput);
  const source = immutableFiscalSourceBindingSchema.parse(sourceInput);
  const current = new Date(now).getTime();
  if (
    !Number.isFinite(current) ||
    Date.parse(review.reviewedAt) > current ||
    Date.parse(capture.capturedAt) > Date.parse(review.reviewedAt) ||
    Date.parse(review.reviewedAt) > Date.parse(capture.expiresAt)
  )
    throw new Error("FISCAL_ADJUDICATION_TIME_INVALID");
  if (
    state.status !== "UNKNOWN_OUTCOME" ||
    state.uncertainOperation !== "CONFIRM" ||
    state.execution !== "REAL_TEST" ||
    state.provider !== "BENIN_EMECEF_TEST" ||
    !state.uid ||
    state.uid !== review.context.providerUid ||
    !state.diagnostic?.captured ||
    state.diagnostic.reference !== review.captureReference ||
    state.diagnostic.httpStatus !== 200 ||
    state.diagnostic.mutationMayHaveExecuted !== true ||
    state.identity.orgId !== scope.orgId ||
    state.identity.sourceDocumentId !== scope.sourceDocumentId ||
    state.identity.sourceDomain !== "restaurants" ||
    state.identity.sourceDocumentType !== "INVOICE" ||
    state.identity.jurisdiction !== "BJ" ||
    state.sourceDigest !== review.context.sourceDigest ||
    state.expectedTotal !== review.context.expectedTotal ||
    source.orgId !== review.context.orgId ||
    source.outletId !== review.context.outletId ||
    source.sessionId !== review.context.sessionId ||
    source.invoiceId !== review.context.invoiceId ||
    source.sourceDigest !== review.context.sourceDigest ||
    source.sellerIfu !== review.context.sellerIfu ||
    source.sellerNim !== review.context.sellerNim ||
    source.expectedTotal !== review.context.expectedTotal ||
    state.providerContextDigest !== review.context.providerContextDigest ||
    state.fiscalTotalsDigest !== review.context.fiscalTotalsDigest ||
    review.expectedVersion !== state.version ||
    review.captureReference !== state.diagnostic.reference ||
    hash(canonical(capture)) !== review.captureDigest
  )
    throw new Error("FISCAL_ADJUDICATION_BINDING_MISMATCH");
  const parsed = SecurityElementsDtoSchema.parse(JSON.parse(capture.body));
  if (
    !parsed.dateTime ||
    !parsed.qrCode ||
    !parsed.codeMECeFDGI ||
    !parsed.counters ||
    !parsed.nim ||
    parsed.nim !== review.context.sellerNim ||
    parsed.errorCode ||
    parsed.errorDesc
  )
    throw new Error("FISCAL_ADJUDICATION_RESPONSE_INVALID");
  const security = {
    dateTime: parsed.dateTime,
    qrCode: parsed.qrCode,
    codeMECeFDGI: parsed.codeMECeFDGI,
    counters: parsed.counters,
    nim: parsed.nim,
  };
  const audit = fiscalAdjudicationAuditSchema.parse({
    ...review,
    decision: "CONFIRM_CAPTURED_DGI_TEST",
    responseDigest: hash(canonical(security)),
    evidenceOrigin: "DGI_TEST",
  });
  return {
    event: {
      kind: "ADJUDICATED_CONFIRMED" as const,
      security,
      diagnostic: state.diagnostic,
      adjudication: audit,
    },
    audit,
  };
}
