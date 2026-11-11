import { randomUUID } from "node:crypto";
import { z } from "zod";
import * as c from "@liass-ohada/shared/restaurants";
import { AppError } from "@/lambda/shared/app-error";
import { canonical, hash } from "@/lambda/shared/authority/integrity";
import {
  adjudicateCapturedConfirmation,
  type FiscalAdjudicationReview,
} from "../fiscal-compliance/core/capture-adjudication";
import { fiscalAdjudicationEnabled } from "../fiscal-compliance/core/test-execution";
import { ConfirmationCapture } from "../fiscal-compliance/persistence/confirmation-capture";
import { FiscalAttemptConflict } from "../fiscal-compliance/core/fiscal-attempt-state";
import { FiscalAttemptStore } from "../fiscal-compliance/persistence/fiscal-attempt-store";
import { RestaurantInvoiceSourceVerifier } from "./invoice-source-verifier";
import { projectRestaurantInvoiceV1 } from "./fiscalizable-invoice-v1";

const configurationSchema = z
  .object({
    orgId: z.string().min(1).max(200),
    outletId: z.string().uuid(),
    sessionId: z.string().uuid(),
    invoiceId: z.string().uuid(),
    reviewerUserId: z.string().uuid(),
    sellerNim: z.string().min(1).max(500),
    captureReference: z.string().regex(/^[a-f0-9]{64}$/),
    authorizationReference: z.string().trim().min(1).max(200),
  })
  .strict();

function configuration() {
  return configurationSchema.parse({
    orgId: process.env.FISCAL_ADJUDICATION_ORG_ID,
    outletId: process.env.FISCAL_ADJUDICATION_OUTLET_ID,
    sessionId: process.env.FISCAL_ADJUDICATION_SESSION_ID,
    invoiceId: process.env.FISCAL_ADJUDICATION_INVOICE_ID,
    reviewerUserId: process.env.FISCAL_ADJUDICATION_REVIEWER_USER_ID,
    sellerNim: process.env.FISCAL_ADJUDICATION_SELLER_NIM,
    captureReference: process.env.FISCAL_ADJUDICATION_CAPTURE_REFERENCE,
    authorizationReference: process.env.FISCAL_ADJUDICATION_AUTHORIZATION_REFERENCE,
  });
}

type Context = { orgId: string; userId: string };

/**
 * A bounded D15 recovery writer. It can read one deployment-pinned evidence
 * object and perform one version-conditional attempt transition. It cannot
 * create, confirm, inspect another provider invoice, or accept caller evidence.
 */
export class RestaurantFiscalAdjudicationService {
  constructor(
    private readonly capture = new ConfirmationCapture(
      process.env.FISCAL_DIAGNOSTIC_BUCKET ?? "",
    ),
  ) {}

  async adjudicate(context: Context, input: unknown) {
    if (!fiscalAdjudicationEnabled())
      throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
    const request = c.RestaurantFiscalSourceRequestSchema.parse(input);
    let config;
    try {
      config = configuration();
    } catch {
      throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
    }
    if (
      context.orgId !== config.orgId ||
      context.userId !== config.reviewerUserId ||
      request.outletId !== config.outletId ||
      request.sessionId !== config.sessionId ||
      request.invoiceId !== config.invoiceId
    )
      throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");

    const scope = { orgId: context.orgId, outletId: request.outletId };
    const source = await RestaurantInvoiceSourceVerifier.verify(
      scope,
      context.userId,
      request.sessionId,
      request.invoiceId,
    );
    if (!source.verified) throw new AppError(409, "FISCAL_SOURCE_UNAVAILABLE");
    let projection;
    try {
      projection = projectRestaurantInvoiceV1(source.evidence);
    } catch {
      throw new AppError(409, "FISCAL_SOURCE_UNAVAILABLE");
    }
    const ifus = projection.document.seller.identifiers.filter(
      (identifier) => identifier.scheme === "IFU" && identifier.issuingCountry === "BJ",
    );
    if (ifus.length !== 1) throw new AppError(409, "FISCAL_SOURCE_UNAVAILABLE");
    const identity = {
      orgId: context.orgId,
      environment: "TEST" as const,
      sourceDomain: "restaurants",
      sourceDocumentType: "INVOICE",
      sourceDocumentId: request.invoiceId,
      jurisdiction: "BJ",
      obligation: "NORMALIZE",
    };
    const store = new FiscalAttemptStore();
    const current = await store.read(identity);
    if (!current) throw new AppError(409, "FISCAL_COMMAND_CONFLICT");
    const now = new Date().toISOString();
    const review: FiscalAdjudicationReview = {
      reviewId: randomUUID(),
      reviewerUserId: context.userId,
      reviewerRole: "FISCAL_COMPLIANCE_REVIEWER",
      authorizationReference: config.authorizationReference,
      reviewedAt: now,
      expectedVersion: current.version,
      captureReference: config.captureReference,
      captureDigest: "0".repeat(64),
      context: {
        orgId: context.orgId,
        outletId: request.outletId,
        sessionId: request.sessionId,
        invoiceId: request.invoiceId,
        sourceDigest: source.evidence.proof.digest,
        sellerIfu: ifus[0].value,
        sellerNim: config.sellerNim,
        providerUid: current.uid ?? "",
        expectedTotal: Number(projection.document.totals.totalMinor),
        providerContextDigest: current.providerContextDigest ?? "",
        fiscalTotalsDigest: current.fiscalTotalsDigest ?? "",
      },
    };
    let capture: unknown;
    try {
      capture = await this.capture.read(config.captureReference);
      review.captureDigest = hash(canonical(capture));
      const adjudication = adjudicateCapturedConfirmation(
        current,
        identity,
        review,
        capture,
        {
          orgId: context.orgId,
          outletId: request.outletId,
          sessionId: request.sessionId,
          invoiceId: request.invoiceId,
          sourceDigest: source.evidence.proof.digest,
          sellerIfu: ifus[0].value,
          sellerNim: config.sellerNim,
          expectedTotal: Number(projection.document.totals.totalMinor),
        },
        now,
      );
      const written = await store.transition(
        identity,
        current.version,
        adjudication.event,
      );
      const state = written.state;
      if (
        state.status !== "CONFIRMED" ||
        state.adjudication?.reviewId !== review.reviewId ||
        state.securityEvidenceOrigin !== "DGI_TEST"
      )
        throw new AppError(409, "FISCAL_COMMAND_CONFLICT");
      return {
        invoiceId: request.invoiceId,
        environment: "TEST" as const,
        execution: "REAL_TEST" as const,
        status: "CONFIRMED" as const,
        confirmed: true,
        legallyNormalized: false as const,
        normalizedInvoice: null,
        securityElements: null,
        total: state.providerTotal ?? null,
        uncertainOperation: null,
        mutationRetryAllowed: false as const,
        resultAvailable: true,
        evidenceOrigin: "DGI_TEST" as const,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof FiscalAttemptConflict)
        throw new AppError(409, "FISCAL_COMMAND_CONFLICT");
      // No raw restricted capture or provider response enters API/log output.
      throw new AppError(409, "FISCAL_CONFIRMATION_UNAVAILABLE");
    }
  }
}
