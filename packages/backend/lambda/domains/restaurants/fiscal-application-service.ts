import {
  RestaurantFiscalSourceRequestSchema as requestSchema,
  RestaurantFiscalInitiateRequestSchema as commandSchema,
  RestaurantFiscalConfirmRequestSchema,
} from "@liass-ohada/shared/restaurants";
import { z } from "zod";
import { AppError } from "@/lambda/shared/app-error";
import { FiscalAttemptStore } from "../fiscal-compliance/persistence/fiscal-attempt-store";
import type { FiscalAttemptState } from "../fiscal-compliance/core/fiscal-attempt-state";
import { RestaurantInvoiceSourceVerifier } from "./invoice-source-verifier";
import { RestaurantReceiptService } from "./receipt-service";
import { restaurantBeninSyntheticWorkflow } from "./benin-synthetic-workflow";

type Context = { orgId: string; userId: string };
type Request = z.infer<typeof requestSchema>;
type Settings = Pick<
  Parameters<typeof restaurantBeninSyntheticWorkflow>[0],
  "classifications" | "mapping" | "adapter" | "credential"
>;
/** Internal application boundary only. Context comes from the authenticated
 * application, and mapping settings from trusted test composition, never a body.
 * No registered route or real-data execution is enabled.
 */
export class RestaurantFiscalApplicationService {
  constructor(
    private readonly settings: (
      context: Context,
      request: Request,
    ) => Promise<Settings>,
  ) {}
  private identity(context: Context, request: Request) {
    return {
      orgId: context.orgId,
      environment: "TEST" as const,
      sourceDomain: "restaurants",
      sourceDocumentType: "INVOICE",
      sourceDocumentId: request.invoiceId,
      jurisdiction: "BJ",
      obligation: "NORMALIZE",
    };
  }
  private async verify(context: Context, request: Request) {
    if (
      process.env.NODE_ENV !== "test" ||
      process.env.FISCAL_SYNTHETIC_APPLICATION !== "1" ||
      !context.orgId ||
      !context.userId
    )
      throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
    const scope = { orgId: context.orgId, outletId: request.outletId };
    // Existing membership, entitlement, role and outlet checks; publication roles
    // OWNER/MANAGER/CASHIER are reused for this synthetic-only capability.
    await RestaurantReceiptService.authorize(scope, context.userId);
    const source = await RestaurantInvoiceSourceVerifier.verify(
      scope,
      context.userId,
      request.sessionId,
      request.invoiceId,
    );
    if (!source.verified) throw new AppError(409, "FISCAL_SOURCE_UNAVAILABLE");
    return source.evidence;
  }
  private view(request: Request, state?: FiscalAttemptState) {
    return {
      invoiceId: request.invoiceId,
      environment: "TEST" as const,
      execution: "SYNTHETIC" as const,
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
  async status(context: Context, input: unknown) {
    const request = requestSchema.parse(input);
    const source = await this.verify(context, request);
    const state = await new FiscalAttemptStore().read(
      this.identity(context, request),
    );
    if (state && state.sourceDigest !== source.proof.digest)
      throw new AppError(409, "FISCAL_SOURCE_MISMATCH");
    await this.verify(context, request);
    return this.view(request, state);
  }
  async confirmedResult(context: Context, input: unknown) {
    const result = await this.status(context, input);
    return {
      ...result,
      resultAvailable: result.confirmed,
      evidenceOrigin: result.confirmed ? ("SYNTHETIC" as const) : null,
    };
  }
  private async workflow(context: Context, request: Request) {
    const settings = await this.settings(context, request);
    return restaurantBeninSyntheticWorkflow({
      ...settings,
      outletId: request.outletId,
      sessionId: request.sessionId,
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
        existing.sourceDigest !== source.proof.digest ||
        existing.attemptId !== attemptId ||
        (create && create.commandId !== commandId)
      )
        throw new AppError(409, "FISCAL_COMMAND_CONFLICT");
      return this.status(context, request); // replay is a read, never dispatch permission
    }
    await (
      await this.workflow(context, request)
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
    if (
      !source.issuanceProvenance.verified ||
      !state ||
      state.status !== "CREATED" ||
      state.sourceDigest !== source.proof.digest
    )
      throw new AppError(409, "FISCAL_CONFIRMATION_UNAVAILABLE");
    await (
      await this.workflow(context, request)
    ).confirm(
      { orgId: context.orgId, actorId: context.userId },
      this.identity(context, request),
      commandId,
      { confirm },
    );
    return this.confirmedResult(context, request);
  }
}
