import { realFiscalTestEnabled } from "./test-execution";
import { createHash } from "node:crypto";
import { z } from "zod";
import { FiscalAttemptStore } from "../persistence/fiscal-attempt-store";
import {
  FiscalAttemptState,
  FiscalAttemptConflict,
  FiscalObligationIdentity,
  fiscalAttemptStateSchema,
} from "./fiscal-attempt-state";

export interface FiscalPrincipal {
  orgId: string;
  actorId: string;
}
export interface VerifiedFiscalPreparation {
  identity: FiscalObligationIdentity;
  sourceDigest: string;
  requestDigest: string;
  total: number;
  ordinaryVatTotals?: { net: number; tax: number };
  fiscalGroupTotals?: Partial<Record<"A" | "B" | "C" | "D" | "E", { gross: number; net: number; tax: number }>>;
  fiscalAdditionalTotals?: { aib: number; ts: number };
  /** Owner-verified immutable commercial and provenance evidence; never persisted here. */
  payload: unknown;
}
type Security = NonNullable<
  z.infer<typeof fiscalAttemptStateSchema>["security"]
>;
/** Provider port shared by synthetic execution and explicitly gated real TEST execution. */
export interface MockFiscalProvider {
  readonly kind: "MOCK" | "BENIN_EMECEF_TEST";
  diagnostic?: FiscalAttemptState["diagnostic"];
  createInvoice(
    preparation: VerifiedFiscalPreparation,
  ): Promise<{ uid: string; total: number; reconciled: boolean; fiscalTotalsDigest?: string; providerContextDigest?: string }>;
  confirmInvoice(
    uid: string,
    reservation?: FiscalAttemptState,
    preparation?: VerifiedFiscalPreparation,
  ): Promise<Security>;
  getInvoice(uid: string): Promise<unknown>;
  verifyInvoice?(uid: string, preparation: VerifiedFiscalPreparation, purpose?: "CANCEL"): Promise<unknown>;
  cancelInvoice?(uid: string, reservation: FiscalAttemptState): Promise<Security>;
}
export class DefiniteFiscalRejection extends Error {}
/** Compatibility name retained: one durable lifecycle, with explicit real TEST mode. */
export class SyntheticFiscalOrchestrator {
  constructor(
    private readonly store: FiscalAttemptStore,
    private readonly provider: MockFiscalProvider,
    private readonly authorize: (
      principal: FiscalPrincipal,
      identity: FiscalObligationIdentity,
      action: "CREATE" | "CONFIRM" | "CANCEL" | "READ" | "RECOVER",
    ) => Promise<void>,
    private readonly prepare: (
      principal: FiscalPrincipal,
      identity: FiscalObligationIdentity,
    ) => Promise<VerifiedFiscalPreparation>,
    private readonly real = false,
  ) {}
  private async access(
    p: FiscalPrincipal,
    identity: FiscalObligationIdentity,
    action: "CREATE" | "CONFIRM" | "CANCEL" | "READ" | "RECOVER",
  ) {
    if (
      (this.real ? !realFiscalTestEnabled() : process.env.NODE_ENV !== "test") ||
      !["MOCK", "BENIN_EMECEF_TEST"].includes(this.provider.kind) ||
      (this.real && this.provider.kind !== "BENIN_EMECEF_TEST") ||
      !p.actorId ||
      p.orgId !== identity.orgId ||
      identity.environment !== "TEST"
    )
      throw new FiscalAttemptConflict("SCOPE_DENIED");
    await this.authorize(p, identity, action);
  }
  private intent(operation: string, commandId: string, requestDigest: string) {
    return createHash("sha256")
      .update(JSON.stringify([operation, commandId, requestDigest]))
      .digest("hex");
  }
  async create(
    p: FiscalPrincipal,
    identity: FiscalObligationIdentity,
    attemptId: string,
    commandId: string,
  ) {
    const prepared = await this.prepare(p, identity);
    if (JSON.stringify(prepared.identity) !== JSON.stringify(identity))
      throw new FiscalAttemptConflict("SCOPE_DENIED");
    const fiscalDocumentType = (prepared.payload as { invoice?: { type?: unknown } } | null)?.invoice?.type;
    if (this.real && !["FV", "EV", "FA", "EA"].includes(String(fiscalDocumentType)))
      throw new FiscalAttemptConflict("INVALID_INPUT");
    // Read-only preparation must succeed before consuming the one-use CREATE budget.
    // Access is still required before any durable reservation or provider mutation.
    await this.access(p, identity, "CREATE");
    // Reservation validates the closed identity, digests and exact positive total.
    const state = await this.store.reserve({
      identity,
      attemptId,
      provider: this.provider.kind,
      ...(this.real ? { execution: "REAL_TEST" as const } : {}),
      sourceDigest: prepared.sourceDigest,
      requestDigest: prepared.requestDigest,
      ...(["FV", "EV", "FA", "EA"].includes(String(fiscalDocumentType))
        ? { fiscalDocumentType: fiscalDocumentType as "FV" | "EV" | "FA" | "EA" } : {}),
      expectedTotal: prepared.total,
    });
    const reserved = await this.store.transition(identity, state.version, {
      kind: "RESERVE_MUTATION",
      operation: "CREATE",
      commandId,
      intentDigest: this.intent("CREATE", commandId, prepared.requestDigest),
    });
    if (reserved.replay) throw new FiscalAttemptConflict("TRANSITION_DENIED");
    try {
      const created = await this.provider.createInvoice(prepared);
      const valid = z
        .object({
          uid: z.string().min(1).max(200),
          total: z.number().int().safe(),
          reconciled: this.real ? z.boolean() : z.literal(true),
          providerContextDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
          fiscalTotalsDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        })
        .parse(created);
      if (!this.real && valid.total !== prepared.total) throw new Error("TOTAL_MISMATCH");
      return await this.store.transition(identity, reserved.state.version, {
        kind: "CREATED",
        commandId,
        uid: valid.uid,
        total: valid.total,
        ...(this.real ? { fiscalTotalsVerified: valid.reconciled, fiscalTotalsDigest: valid.fiscalTotalsDigest, providerContextDigest: valid.providerContextDigest } : {}),
      });
    } catch (error) {
      return this.uncertain(identity, reserved.state.version, commandId, error);
    }
  }
  async confirm(
    p: FiscalPrincipal,
    identity: FiscalObligationIdentity,
    commandId: string,
    authorization: { confirm: true },
  ) {
    await this.access(p, identity, "CONFIRM");
    if (authorization?.confirm !== true)
      throw new FiscalAttemptConflict("SCOPE_DENIED");
    const state = await this.store.read(identity);
    if (!state || (state.execution === "REAL_TEST") !== this.real || state.provider !== this.provider.kind || !state.uid)
      throw new FiscalAttemptConflict("UID_REQUIRED");
    const prepared = await this.prepare(p, identity);
    if (
      (this.real && state.execution !== "REAL_TEST") ||
      prepared.sourceDigest !== state.sourceDigest ||
      prepared.requestDigest !== state.requestDigest ||
      prepared.total !== state.expectedTotal
    )
      throw new FiscalAttemptConflict("SCOPE_DENIED");
    const reference = createHash("sha256").update(JSON.stringify([state.obligationId, state.attemptId, commandId, state.uid])).digest("hex");
    const reserved = await this.store.transition(identity, state.version, {
      kind: "RESERVE_MUTATION",
      ...(this.real ? { diagnosticReference: reference } : {}),
      operation: "CONFIRM",
      commandId,
      intentDigest: this.intent("CONFIRM", commandId, state.requestDigest),
    });
    if (reserved.replay) throw new FiscalAttemptConflict("TRANSITION_DENIED");
    try {
      const security = await this.provider.confirmInvoice(
        state.uid,
        reserved.state,
        prepared,
      );
      return await this.store.transition(identity, reserved.state.version, {
        kind: "CONFIRMED",
        commandId,
        security,
        ...(this.real ? { evidenceOrigin: "DGI_TEST" as const, diagnostic: this.provider.diagnostic } : {}),
      });
    } catch (error) {
      return this.uncertain(identity, reserved.state.version, commandId, error);
    }
  }
  private async uncertain(
    identity: FiscalObligationIdentity,
    version: number,
    commandId: string,
    error: unknown,
  ) {
    // A failed outcome write may already have committed. Never overwrite it or retry HTTP.
    try {
      return await this.store.transition(identity, version, {
        kind:
          error instanceof DefiniteFiscalRejection
            ? "DEFINITE_FAILURE"
            : "UNKNOWN",
        commandId,
        ...(this.real ? { diagnostic: this.provider.diagnostic } : {}),
      });
    } catch {
      throw new Error("FISCAL_OUTCOME_REQUIRES_RECOVERY");
    }
  }
  async recover(
    p: FiscalPrincipal,
    identity: FiscalObligationIdentity,
    version: number,
  ) {
    await this.access(p, identity, "RECOVER");
    return this.store.recover(identity, version);
  }
  async reconcile(p: FiscalPrincipal, identity: FiscalObligationIdentity) {
    await this.access(p, identity, "READ");
    const plan = await this.store.reconciliationRead(identity);
    if (plan.provider !== this.provider.kind)
      throw new FiscalAttemptConflict("SCOPE_DENIED");
    const state = await this.store.read(identity);
    const prepared = await this.prepare(p, identity);
    if (!state || prepared.sourceDigest !== state.sourceDigest ||
      prepared.requestDigest !== state.requestDigest ||
      (this.real && (state.execution !== "REAL_TEST" || state.status !== "CREATED")))
      throw new FiscalAttemptConflict("SCOPE_DENIED");
    // Observation only: no response (including error 20) alters durable status.
    try {
      const observation = this.provider.verifyInvoice
        ? await this.provider.verifyInvoice(plan.uid, prepared)
        : await this.provider.getInvoice(plan.uid);
      return {
        statusChanged: false as const,
        observation,
      };
    } catch {
      throw new Error("FISCAL_RECONCILIATION_UNAVAILABLE");
    }
  }
  async cancel(
    p: FiscalPrincipal,
    identity: FiscalObligationIdentity,
    commandId: string,
    authorization: { cancel: true; determination: "VERIFIED_PENDING_TEST" },
  ) {
    await this.access(p, identity, "CANCEL");
    if (!this.real || authorization?.cancel !== true ||
      authorization.determination !== "VERIFIED_PENDING_TEST" ||
      !this.provider.verifyInvoice || !this.provider.cancelInvoice)
      throw new FiscalAttemptConflict("SCOPE_DENIED");
    const state = await this.store.read(identity);
    if (!state || state.execution !== "REAL_TEST" || state.status !== "CREATED" ||
      state.provider !== this.provider.kind || !state.uid ||
      state.providerTotal === undefined)
      throw new FiscalAttemptConflict("TRANSITION_DENIED");
    const prepared = await this.prepare(p, identity);
    if (prepared.sourceDigest !== state.sourceDigest ||
      prepared.requestDigest !== state.requestDigest || prepared.total !== state.expectedTotal)
      throw new FiscalAttemptConflict("SCOPE_DENIED");
    await this.provider.verifyInvoice(state.uid, prepared, "CANCEL");
    const reference = createHash("sha256").update(JSON.stringify([
      state.obligationId, state.attemptId, commandId, state.uid, "CANCEL",
    ])).digest("hex");
    const reserved = await this.store.transition(identity, state.version, {
      kind: "RESERVE_MUTATION", operation: "CANCEL", commandId,
      intentDigest: this.intent("CANCEL", commandId, state.requestDigest),
      diagnosticReference: reference,
    });
    if (reserved.replay) throw new FiscalAttemptConflict("TRANSITION_DENIED");
    try {
      const security = await this.provider.cancelInvoice(state.uid, reserved.state);
      return await this.store.transition(identity, reserved.state.version, {
        kind: "CANCELLED", commandId, security, evidenceOrigin: "DGI_TEST",
        diagnostic: this.provider.diagnostic,
      });
    } catch (error) {
      return this.uncertain(identity, reserved.state.version, commandId, error);
    }
  }
}
