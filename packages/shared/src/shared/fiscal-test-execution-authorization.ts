import { z } from "zod";

const id = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);

/** Platform approval accepts only a reference to Restaurants-owned evidence. */
export const ApproveFiscalTestExecutionAuthorizationRequestSchema = z.object({
  proofId: id,
  proofDigest: digest,
  connectionId: id,
  commandId: id,
}).strict();

export const FiscalTestExecutionAuthorizationViewSchema = z.object({
  authorizationId: id,
  proofId: id,
  invoiceId: id,
  scenarioId: z.string().regex(/^([0-9]{2})$/),
  connectionId: id,
  expiresAt: z.string().datetime(),
  operations: z.object({
    CREATE: z.literal(1), GET: z.literal(2), CONFIRM: z.literal(1), CANCEL: z.literal(1),
  }).strict(),
  remaining: z.object({
    CREATE: z.number().int().min(0).max(1),
    GET: z.number().int().min(0).max(2),
    CONFIRM: z.number().int().min(0).max(1),
    CANCEL: z.number().int().min(0).max(1),
  }).strict(),
  status: z.enum(["ACTIVE", "REVOKED"]),
}).strict();

export type ApproveFiscalTestExecutionAuthorizationRequest = z.infer<
  typeof ApproveFiscalTestExecutionAuthorizationRequestSchema
>;
export type FiscalTestExecutionAuthorizationView = z.infer<
  typeof FiscalTestExecutionAuthorizationViewSchema
>;
