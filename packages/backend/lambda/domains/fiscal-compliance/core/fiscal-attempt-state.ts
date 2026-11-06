import { createHash } from "node:crypto";
import { z } from "zod";

// Pure transition model only. D09/D15/G15 do not authorize a new writer.
// A future approved owner must atomically compare version, reserve obligation and
// record command intent BEFORE dispatch. No function here dispatches HTTP.
const id = z.string().min(1).max(200);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const operation = z.enum(["CREATE", "CONFIRM", "CANCEL"]);
const identitySchema = z
  .object({
    orgId: id,
    environment: z.literal("TEST"),
    sourceDomain: id,
    sourceDocumentType: id,
    sourceDocumentId: id,
    jurisdiction: id,
    obligation: id,
  })
  .strict();
const securitySchema = z
  .object({
    dateTime: z.string().min(1).max(500),
    qrCode: z.string().min(1).max(4096),
    codeMECeFDGI: z.string().min(1).max(500),
    counters: z.string().min(1).max(500),
    nim: z.string().min(1).max(500),
  })
  .strict();
const commandSchema = z
  .object({ commandId: id, intentDigest: digest, operation })
  .strict();
export const fiscalAttemptStateSchema = z
  .object({
    identity: identitySchema,
    obligationId: digest,
    attemptId: id,
    provider: id,
    sourceDigest: digest,
    requestDigest: digest,
    expectedTotal: z.number().int().safe().positive(),
    version: z.number().int().safe().positive(),
    status: z.enum([
      "RESERVED",
      "CREATE_IN_FLIGHT",
      "CREATED",
      "CONFIRM_IN_FLIGHT",
      "CONFIRMED",
      "CANCEL_IN_FLIGHT",
      "CANCELLED",
      "UNKNOWN_OUTCOME",
      "FAILED",
    ]),
    commands: z.array(commandSchema).max(100),
    activeCommandId: id.optional(),
    uncertainOperation: operation.optional(),
    failedOperation: operation.optional(),
    uid: id.optional(),
    providerTotal: z.number().int().safe().optional(),
    security: securitySchema.optional(),
    securityEvidenceOrigin: z.literal("SYNTHETIC").optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (
      s.obligationId !== obligationIdentity(s.identity) ||
      new Set(s.commands.map((c) => c.commandId)).size !== s.commands.length ||
      ([
        "CREATED",
        "CONFIRM_IN_FLIGHT",
        "CONFIRMED",
        "CANCEL_IN_FLIGHT",
        "CANCELLED",
      ].includes(s.status) &&
        !s.uid) ||
      (s.status === "CONFIRMED" &&
        (!s.security || s.providerTotal !== s.expectedTotal)) ||
      (s.status.endsWith("_IN_FLIGHT") &&
        !s.commands.some(
          (c) =>
            c.commandId === s.activeCommandId &&
            `${c.operation}_IN_FLIGHT` === s.status,
        )) ||
      (s.status === "UNKNOWN_OUTCOME" && !s.uncertainOperation) ||
      (s.status === "FAILED" && !s.failedOperation)
    ) {
      ctx.addIssue({ code: "custom", message: "Invalid fiscal attempt state" });
    }
  });
export type FiscalAttemptState = z.infer<typeof fiscalAttemptStateSchema>;
export type FiscalObligationIdentity = z.infer<typeof identitySchema>;
export class FiscalAttemptConflict extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "SCOPE_DENIED"
      | "VERSION_CONFLICT"
      | "INTENT_CONFLICT"
      | "TRANSITION_DENIED"
      | "UID_REQUIRED",
  ) {
    super(code);
    this.name = "FiscalAttemptConflict";
  }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new FiscalAttemptConflict("INVALID_INPUT");
  return result.data;
}
/** Internal pure-model identity, not an approved storage key or shared-V1 fingerprint.
 * Caller must supply an authorized jurisdiction/obligation definition, never a UI label.
 * Provider, credential and request/source revisions cannot change effect identity.
 */
export function obligationIdentity(identity: FiscalObligationIdentity): string {
  const s = parse(identitySchema, identity);
  return createHash("sha256")
    .update(
      JSON.stringify([
        "fiscal-attempt-obligation-model-v1",
        s.orgId,
        s.environment,
        s.sourceDomain,
        s.sourceDocumentType,
        s.sourceDocumentId,
        s.jurisdiction,
        s.obligation,
      ]),
    )
    .digest("hex");
}
export function reserveFiscalAttempt(input: {
  identity: FiscalObligationIdentity;
  attemptId: string;
  provider: string;
  sourceDigest: string;
  requestDigest: string;
  expectedTotal: number;
}): FiscalAttemptState {
  // Pure proposal, NOT a successful durable reservation.
  return parse(fiscalAttemptStateSchema, {
    ...input,
    obligationId: obligationIdentity(input.identity),
    version: 1,
    status: "RESERVED",
    commands: [],
  });
}
const eventSchema = z.discriminatedUnion("kind", [
  commandSchema.extend({ kind: z.literal("RESERVE_MUTATION") }).strict(),
  z
    .object({
      kind: z.literal("CREATED"),
      commandId: id,
      uid: id,
      total: z.number().int().safe(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("CONFIRMED"),
      commandId: id,
      security: securitySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("CANCELLED"),
      commandId: id,
      security: securitySchema,
    })
    .strict(),
  z.object({ kind: z.literal("UNKNOWN"), commandId: id }).strict(),
  z.object({ kind: z.literal("DEFINITE_FAILURE"), commandId: id }).strict(),
  z.object({ kind: z.literal("RECOVER_INTERRUPTED") }).strict(),
]);
export type FiscalAttemptEvent = z.infer<typeof eventSchema>;
export function transitionFiscalAttempt(
  state: FiscalAttemptState,
  scope: FiscalObligationIdentity,
  expectedVersion: number,
  event: FiscalAttemptEvent,
): { state: FiscalAttemptState; replay: boolean } {
  const current = parse(fiscalAttemptStateSchema, state);
  if (obligationIdentity(scope) !== current.obligationId)
    throw new FiscalAttemptConflict("SCOPE_DENIED");
  const e = parse(eventSchema, event);
  if (e.kind === "RESERVE_MUTATION") {
    const prior = current.commands.find((c) => c.commandId === e.commandId);
    if (prior) {
      if (
        prior.intentDigest !== e.intentDigest ||
        prior.operation !== e.operation
      )
        throw new FiscalAttemptConflict("INTENT_CONFLICT");
      return { state: current, replay: true }; // Never permission to redispatch.
    }
  }
  if (expectedVersion !== current.version)
    throw new FiscalAttemptConflict("VERSION_CONFLICT");
  const next = structuredClone(current);
  const deny = (): never => {
    throw new FiscalAttemptConflict("TRANSITION_DENIED");
  };
  if (e.kind === "RESERVE_MUTATION") {
    if (
      e.operation === "CREATE"
        ? current.status !== "RESERVED"
        : current.status !== "CREATED"
    )
      deny();
    if (
      e.operation === "CONFIRM" &&
      current.providerTotal !== current.expectedTotal
    )
      deny();
    next.commands.push({
      commandId: e.commandId,
      intentDigest: e.intentDigest,
      operation: e.operation,
    });
    next.activeCommandId = e.commandId;
    next.status = `${e.operation}_IN_FLIGHT`;
  } else if (e.kind === "RECOVER_INTERRUPTED") {
    if (!current.status.endsWith("_IN_FLIGHT")) deny();
    next.status = "UNKNOWN_OUTCOME";
    next.uncertainOperation = operation.parse(
      current.status.replace("_IN_FLIGHT", ""),
    );
  } else {
    if (
      !current.status.endsWith("_IN_FLIGHT") ||
      current.activeCommandId !== e.commandId
    )
      deny();
    const op = operation.parse(current.status.replace("_IN_FLIGHT", ""));
    if (e.kind === "UNKNOWN") {
      next.status = "UNKNOWN_OUTCOME";
      next.uncertainOperation = op;
    } else if (e.kind === "DEFINITE_FAILURE") {
      // Only authoritative definite rejection; timeout/transport errors are UNKNOWN.
      next.status = "FAILED";
      next.failedOperation = op;
    } else if (e.kind === "CREATED") {
      if (op !== "CREATE") deny();
      next.uid = e.uid;
      next.providerTotal = e.total;
      next.status = "CREATED";
    } else {
      if ((e.kind === "CONFIRMED" ? "CONFIRM" : "CANCEL") !== op) deny();
      next.status = e.kind;
      next.security = e.security;
      next.securityEvidenceOrigin = "SYNTHETIC";
    }
  }
  next.version++;
  return { state: parse(fiscalAttemptStateSchema, next), replay: false };
}
/** Read plan only. GET details cannot prove confirmation/cancellation or clear unknown. */
export function fiscalReconciliationRead(
  state: FiscalAttemptState,
  scope: FiscalObligationIdentity,
) {
  const current = parse(fiscalAttemptStateSchema, state);
  if (obligationIdentity(scope) !== current.obligationId)
    throw new FiscalAttemptConflict("SCOPE_DENIED");
  if (!current.uid) throw new FiscalAttemptConflict("UID_REQUIRED");
  return {
    operation: "GET_INVOICE" as const,
    provider: current.provider,
    uid: current.uid,
  };
}
