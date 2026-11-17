import { z } from "zod";
const id = z.string().uuid();

export const RestaurantFiscalAuthorizationPreparationRequestSchema = z.object({
  scenarioId: z.string().regex(/^([0-9]{2})$/),
  commandId: z.string().uuid(),
}).strict();

const totals = z.object({
  ta: z.number().int().nonnegative(), tb: z.number().int().nonnegative(),
  tc: z.number().int().nonnegative(), td: z.number().int().nonnegative(),
  taa: z.number().int().nonnegative(), tab: z.number().int().nonnegative(),
  tac: z.number().int().nonnegative(), tad: z.number().int().nonnegative(),
  tae: z.number().int().nonnegative(), taf: z.number().int().nonnegative(),
  hab: z.number().int().nonnegative(), had: z.number().int().nonnegative(),
  vab: z.number().int().nonnegative(), vad: z.number().int().nonnegative(),
  aib: z.number().int().nonnegative(), ts: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
}).strict();

export const RestaurantFiscalAuthorizationPreparationResponseSchema = z.object({
  proofId: id,
  proofDigest: z.string().regex(/^[a-f0-9]{64}$/),
  invoiceId: id,
  scenarioId: z.string().regex(/^([0-9]{2})$/),
  fiscalGroups: z.array(z.enum(["A", "B", "C", "D", "E"])).min(1).max(5),
  expectedFiscalTotals: totals,
  operations: z.object({
    CREATE: z.literal(1), GET: z.literal(2), CONFIRM: z.literal(1), CANCEL: z.literal(1),
  }).strict(),
  expiresAt: z.string().datetime(),
  status: z.enum(["PREPARED", "CONSUMED"]),
}).strict();

export type RestaurantFiscalAuthorizationPreparationRequest = z.infer<
  typeof RestaurantFiscalAuthorizationPreparationRequestSchema
>;
export type RestaurantFiscalAuthorizationPreparationResponse = z.infer<
  typeof RestaurantFiscalAuthorizationPreparationResponseSchema
>;
