import { createHash } from "node:crypto";
import { z } from "zod";
import { FiscalAttemptStore } from "../persistence/fiscal-attempt-store";
import {
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
  /** Owner-verified immutable commercial and provenance evidence; never persisted here. */
  payload: unknown;
}
type Security = NonNullable<
  z.infer<typeof fiscalAttemptStateSchema>["security"]
>;
/** Synthetic port: no credentials, transport, endpoint or provider dispatch implementation. */
export interface MockFiscalProvider {
  readonly kind: "MOCK";
  createInvoice(
    preparation: VerifiedFiscalPreparation,
  ): Promise<{ uid: string; total: number; reconciled: boolean }>;
  confirmInvoice(uid: string): Promise<Security>;
  getInvoice(uid: string): Promise<unknown>;
}
export class DefiniteFiscalRejection extends Error {}
export class SyntheticFiscalOrchestrator {
  constructor(
    private readonly store: FiscalAttemptStore,
    private readonly provider: MockFiscalProvider,
    private readonly authorize: (
      principal: FiscalPrincipal,
      identity: FiscalObligationIdentity,
      action: "CREATE" | "CONFIRM" | "READ" | "RECOVER",
    ) => Promise<void>,
    private readonly prepare: (
      principal: FiscalPrincipal,
      identity: FiscalObligationIdentity,
    ) => Promise<VerifiedFiscalPreparation>,
  ) {}
  private async access(
    p: FiscalPrincipal,
    identity: FiscalObligationIdentity,
    action: "CREATE" | "CONFIRM" | "READ" | "RECOVER",
  ) {
    if (
      process.env.NODE_ENV !== "test" ||
      this.provider.kind !== "MOCK" ||
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
    await this.access(p, identity, "CREATE");
    const prepared = await this.prepare(p, identity);
    if (JSON.stringify(prepared.identity) !== JSON.stringify(identity))
      throw new FiscalAttemptConflict("SCOPE_DENIED");
    // Reservation validates the closed identity, digests and exact positive total.
    const state = await this.store.reserve({
      identity,
      attemptId,
      provider: "MOCK",
      sourceDigest: prepared.sourceDigest,
      requestDigest: prepared.requestDigest,
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
          reconciled: z.literal(true),
        })
        .parse(created);
      if (valid.total !== prepared.total) throw new Error("TOTAL_MISMATCH");
      return await this.store.transition(identity, reserved.state.version, {
        kind: "CREATED",
        commandId,
        uid: valid.uid,
        total: valid.total,
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
    if (!state || state.provider !== "MOCK" || !state.uid)
      throw new FiscalAttemptConflict("UID_REQUIRED");
    const reserved = await this.store.transition(identity, state.version, {
      kind: "RESERVE_MUTATION",
      operation: "CONFIRM",
      commandId,
      intentDigest: this.intent("CONFIRM", commandId, state.requestDigest),
    });
    if (reserved.replay) throw new FiscalAttemptConflict("TRANSITION_DENIED");
    try {
      const security = await this.provider.confirmInvoice(state.uid);
      return await this.store.transition(identity, reserved.state.version, {
        kind: "CONFIRMED",
        commandId,
        security,
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
    if (plan.provider !== "MOCK")
      throw new FiscalAttemptConflict("SCOPE_DENIED");
    // Observation only: no response (including error 20) alters durable status.
    try {
      return {
        statusChanged: false as const,
        observation: await this.provider.getInvoice(plan.uid),
      };
    } catch {
      throw new Error("FISCAL_RECONCILIATION_UNAVAILABLE");
    }
  }
}
