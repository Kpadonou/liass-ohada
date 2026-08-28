import { z } from "zod";

/** ISO 4217 alpha-code shape without embedding a currency catalogue. */
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

export const SalesSettingsSchema = z
  .object({
    orgId: z.string().min(1),
    defaultCurrency: CurrencyCodeSchema,
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;
export type SalesSettings = z.infer<typeof SalesSettingsSchema>;
