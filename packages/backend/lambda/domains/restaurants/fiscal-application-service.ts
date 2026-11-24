import { restaurantBeninRealTestWorkflow, RealTestConfiguration } from "./benin-real-test-workflow";
import {
  RestaurantFiscalSourceRequestSchema as requestSchema,
  RestaurantFiscalInitiateRequestSchema as commandSchema,
  RestaurantFiscalConfirmRequestSchema,
} from "@liass-ohada/shared/restaurants";
import { z } from "zod";
import { AppError } from "@/lambda/shared/app-error";
import { FiscalAttemptStore } from "../fiscal-compliance/persistence/fiscal-attempt-store";
import { FiscalAttemptConflict, type FiscalAttemptState } from "../fiscal-compliance/core/fiscal-attempt-state";
import { RestaurantInvoiceSourceVerifier } from "./invoice-source-verifier";
import { RestaurantReceiptService } from "./receipt-service";
import { restaurantBeninSyntheticWorkflow } from "./benin-synthetic-workflow";
import { projectRestaurantInvoiceV1 } from "./fiscalizable-invoice-v1";
import { RestaurantCreditNoteFiscalSource } from "./credit-note-fiscal-source";

type Context = { orgId: string; userId: string };
type Request = z.infer<typeof requestSchema>;
const recoveryCommandId = z.string().trim().min(1).max(200);
export const fiscalRecoveryRequest = z.union([
  requestSchema.extend({ commandId: recoveryCommandId, executionStopped: z.literal(true) }).strict(),
  requestSchema.extend({ providerOperation: z.literal("RECONCILE") }).strict(),
  requestSchema.extend({
    providerOperation: z.literal("CANCEL"), commandId: recoveryCommandId,
    cancel: z.literal(true),
    recoveryDetermination: z.literal("VERIFIED_PENDING_TEST"),
  }).strict(),
]);
type Settings = { realConfiguration?: RealTestConfiguration; executionAuthorize?: (action: "CREATE" | "GET" | "CONFIRM" | "CANCEL") => Promise<void> } & Pick<
  Parameters<typeof restaurantBeninSyntheticWorkflow>[0],
  "classifications" | "mapping" | "adapter" | "credential"
>;
/** Internal application boundary only. Context comes from the authenticated
 * application, and mapping settings from trusted test composition, never a body.
 * Real TEST composition is separately gated and accepts only authentic provenance.
 */
export class RestaurantFiscalApplicationService {
  constructor(
    private readonly settings: (
      context: Context,
      request: Request, sourceDigest: string,
    ) => Promise<Settings>,
    private readonly real = false,
  ) {}
  private identity(context: Context, request: Request) {
    return {
      orgId: context.orgId,
      environment: "TEST" as const,
      sourceDomain: "restaurants",
      sourceDocumentType: request.creditNoteId ? "CREDIT_NOTE" : "INVOICE",
      sourceDocumentId: request.creditNoteId ?? request.invoiceId,
      jurisdiction: "BJ",
      obligation: "NORMALIZE",
    };
  }
  private async verify(context: Context, request: Request) {
    if (
      (!this.real && (process.env.NODE_ENV !== "test" ||
      process.env.FISCAL_SYNTHETIC_APPLICATION !== "1")) ||
      !context.orgId ||
      !context.userId
    )
      throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
    const scope = { orgId: context.orgId, outletId: request.outletId };
    // Existing membership, entitlement, role and outlet checks; publication roles
    // OWNER/MANAGER/CASHIER remain subject to product, outlet and operator authorization.
    await RestaurantReceiptService.authorize(scope, context.userId);
    if (request.creditNoteId) {
      const credit = await RestaurantCreditNoteFiscalSource.verify(scope, context.userId,
        request.sessionId, request.invoiceId, request.creditNoteId);
      if (this.real && (!credit.original.issuanceProvenance.verified ||
        credit.original.issuanceProvenance.evidence.evidenceOrigin !== "AUTHENTIC"))
        throw new AppError(409, "PROVENANCE_UNAVAILABLE");
      return { ...credit.original,
        proof: { ...credit.original.proof, digest: credit.sourceDigest },
        originalFiscalReference: credit.originalFiscal.security!.codeMECeFDGI };
    }
    const source = await RestaurantInvoiceSourceVerifier.verify(
      scope, context.userId, request.sessionId, request.invoiceId,
    );
    if (!source.verified) throw new AppError(409, "FISCAL_SOURCE_UNAVAILABLE");
    if (this.real && (!source.evidence.issuanceProvenance.verified ||
      source.evidence.issuanceProvenance.evidence.evidenceOrigin !== "AUTHENTIC"))
      throw new AppError(409, "PROVENANCE_UNAVAILABLE");
    return source.evidence;
  }
  private view(request: Request, state?: FiscalAttemptState, originalFiscalReference?: string) {
    return {
      invoiceId: request.invoiceId,
      ...(request.creditNoteId ? { creditNoteId: request.creditNoteId } : {}),
      ...(originalFiscalReference ? { originalFiscalReference } : {}),
      environment: "TEST" as const,
      execution: this.real ? "REAL_TEST" as const : "SYNTHETIC" as const,
      status: state?.status ?? "NOT_STARTED",
      confirmed: state?.status === "CONFIRMED",
      legallyNormalized: false as const,
      normalizedInvoice: null,
      securityElements: null,
      total: state?.providerTotal ?? null,
      uncertainOperation: state?.uncertainOperation ?? null,
      mutationRetryAllowed: false as const,
    };
  }
  private async readResultState(context: Context, input: unknown) {
    const request = requestSchema.parse(input);
    const source = await this.verify(context, request);
    const state = await new FiscalAttemptStore().read(this.identity(context, request));
    if (state && ((state.execution === "REAL_TEST") !== this.real || state.sourceDigest !== source.proof.digest))
      throw new AppError(409, "FISCAL_SOURCE_MISMATCH");
    const currentSource = await this.verify(context, request);
    if (currentSource.proof.digest !== source.proof.digest)
      throw new AppError(409, "FISCAL_SOURCE_MISMATCH");
    return { request, state, source: currentSource };
  }
  async status(context: Context, input: unknown) {
    const { request, state, source } = await this.readResultState(context, input);
    return this.view(request, state, "originalFiscalReference" in source ? source.originalFiscalReference : undefined);
  }
  async confirmedResult(context: Context, input: unknown) {
    const { request, state, source } = await this.readResultState(context, input);
    const result = this.view(request, state, "originalFiscalReference" in source ? source.originalFiscalReference : undefined);
    // Only persisted, confirmed DGI TEST evidence can enter the receipt document.
    const securityElements = result.confirmed && this.real &&
      state?.status === "CONFIRMED" && state.execution === "REAL_TEST" &&
      state.securityEvidenceOrigin === "DGI_TEST" ? state.security ?? null : null;
    const seller = securityElements && source.issuanceProvenance.verified
      ? source.issuanceProvenance.evidence.seller?.seller ?? null
      : null;
    return {
      ...result,
      securityElements,
      seller,
      normalizedInvoice: securityElements && !request.creditNoteId ? source.invoice ?? null : null,
      resultAvailable: result.confirmed,
      evidenceOrigin: result.confirmed ? (this.real ? "DGI_TEST" as const : "SYNTHETIC" as const) : null,
    };
  }
  /** Fence an interrupted command after the operator confirms execution has stopped. */
  async recover(context: Context, input: unknown) {
    const recovery = fiscalRecoveryRequest.parse(input);
    const request: Request = {
      outletId: recovery.outletId, sessionId: recovery.sessionId,
      invoiceId: recovery.invoiceId,
      ...(recovery.creditNoteId ? { creditNoteId: recovery.creditNoteId } : {}),
    };
    const providerOperation = "providerOperation" in recovery
      ? recovery.providerOperation : undefined;
    if (!this.real) throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
    const source = await this.verify(context, request);
    const { realConfiguration } = await this.settings(context, request, source.proof.digest);
    if (!realConfiguration || realConfiguration.operatorUserId !== context.userId ||
      realConfiguration.orgId !== context.orgId || realConfiguration.outletId !== request.outletId ||
      realConfiguration.sessionId !== request.sessionId || realConfiguration.invoiceId !== request.invoiceId ||
      realConfiguration.creditNoteId !== request.creditNoteId ||
      realConfiguration.sourceDigest !== source.proof.digest)
      throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
    const identity = this.identity(context, request);
    const store = new FiscalAttemptStore();
    const state = await store.read(identity);
    if (providerOperation === "RECONCILE") {
      if (!state || state.execution !== "REAL_TEST" || state.status !== "CREATED" ||
        state.sourceDigest !== source.proof.digest || !state.uid)
        throw new AppError(409, "FISCAL_COMMAND_CONFLICT");
      try {
        await (await this.workflow(context, request, source.proof.digest)).reconcile(
          { orgId: context.orgId, actorId: context.userId }, identity,
        );
        return this.view(request, state);
      } catch { throw new AppError(409, "FISCAL_RECONCILIATION_UNAVAILABLE"); }
    }
    if (providerOperation === "CANCEL" && "recoveryDetermination" in recovery) {
      if (!state || state.execution !== "REAL_TEST" || state.status !== "CREATED" ||
        state.sourceDigest !== source.proof.digest)
        throw new AppError(409, "FISCAL_COMMAND_CONFLICT");
      try {
        const result = await (await this.workflow(context, request, source.proof.digest)).cancel(
          { orgId: context.orgId, actorId: context.userId }, identity,
          recovery.commandId,
          { cancel: true, determination: recovery.recoveryDetermination },
        );
        return this.view(request, result.state);
      } catch (error) {
        if (error instanceof FiscalAttemptConflict)
          throw new AppError(409, "FISCAL_COMMAND_CONFLICT");
        throw new AppError(409, "FISCAL_RECONCILIATION_UNAVAILABLE");
      }
    }
    if (!("executionStopped" in recovery))
      throw new AppError(409, "FISCAL_COMMAND_CONFLICT");
    const commandId = recovery.commandId;
    if (!state || state.execution !== "REAL_TEST" || state.sourceDigest !== source.proof.digest ||
      state.activeCommandId !== commandId ||
      state.uncertainOperation === "CANCEL" ||
      !["CREATE_IN_FLIGHT", "CONFIRM_IN_FLIGHT", "UNKNOWN_OUTCOME"].includes(state.status))
      throw new AppError(409, "FISCAL_COMMAND_CONFLICT");
    await this.verify(context, request);
    if (state.status === "UNKNOWN_OUTCOME") return this.view(request, state);
    try {
      const recovered = await store.recover(identity, state.version);
      return this.view(request, recovered.state);
    } catch (error) {
      if (error instanceof FiscalAttemptConflict) throw new AppError(409, "FISCAL_COMMAND_CONFLICT");
      throw error;
    }
  }
  private async workflow(context: Context, request: Request, sourceDigest: string) {
    const settings = await this.settings(context, request, sourceDigest);
    const authorize: Parameters<typeof restaurantBeninRealTestWorkflow>[1] = async (principal, _identity, action) => {
      if (principal.orgId !== context.orgId || principal.actorId !== context.userId)
        throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
      await this.verify(context, request);
      if (this.real) {
        const operation = action === "READ" ? "GET" : action;
        if (operation === "RECOVER" || !settings.executionAuthorize) throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
        await settings.executionAuthorize(operation);
      }
    };
    if (this.real) {
      if (!settings.realConfiguration) throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
      return restaurantBeninRealTestWorkflow(settings.realConfiguration, authorize);
    }
    return restaurantBeninSyntheticWorkflow({
      ...settings,
      outletId: request.outletId,
      sessionId: request.sessionId,
      originalInvoiceId: request.creditNoteId ? request.invoiceId : undefined,
      authorize: async (principal) => {
        if (
          principal.orgId !== context.orgId ||
          principal.actorId !== context.userId
        )
          throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
        await this.verify(context, request);
      },
    });
  }
  async initiate(context: Context, input: unknown) {
    const { attemptId, commandId, ...request } = commandSchema.parse(input);
    const source = await this.verify(context, request);
    if (!source.issuanceProvenance.verified)
      throw new AppError(409, "PROVENANCE_UNAVAILABLE");
    const identity = this.identity(context, request);
    const existing = await new FiscalAttemptStore().read(identity);
    if (existing) {
      const create = existing.commands.find((c) => c.operation === "CREATE");
      if (
        (existing.execution === "REAL_TEST") !== this.real ||
        existing.sourceDigest !== source.proof.digest ||
        existing.attemptId !== attemptId ||
        (create && create.commandId !== commandId)
      )
        throw new AppError(409, "FISCAL_COMMAND_CONFLICT");
      return this.status(context, request); // replay is a read, never dispatch permission
    }
    await (
      await this.workflow(context, request, source.proof.digest)
    ).create(
      { orgId: context.orgId, actorId: context.userId },
      identity,
      attemptId,
      commandId,
    );
    return this.status(context, request);
  }
  async confirm(context: Context, input: unknown) {
    const schema = RestaurantFiscalConfirmRequestSchema;
    const { commandId, confirm, ...request } = schema.parse(input);
    const source = await this.verify(context, request);
    const state = await new FiscalAttemptStore().read(
      this.identity(context, request),
    );
    if (state?.commands.some(c => c.operation === "CONFIRM" && c.commandId === commandId))
      return this.confirmedResult(context, request);
    if (
      !source.issuanceProvenance.verified ||
      !state ||
      state.status !== "CREATED" ||
      state.sourceDigest !== source.proof.digest
    )
      throw new AppError(409, "FISCAL_CONFIRMATION_UNAVAILABLE");
    if (this.real && !request.creditNoteId) {
      try {
        projectRestaurantInvoiceV1(source);
      } catch {
        throw new AppError(409, "FISCAL_CONFIRMATION_UNAVAILABLE");
      }
    }
    await (
      await this.workflow(context, request, source.proof.digest)
    ).confirm(
      { orgId: context.orgId, actorId: context.userId },
      this.identity(context, request),
      commandId,
      { confirm },
    );
    return this.confirmedResult(context, request);
  }
}
