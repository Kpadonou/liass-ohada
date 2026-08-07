import { z } from "zod";
import { AccountingFramework } from "./entry";

export const AccountingSettingsSchema = z
  .object({
    orgId: z.string().min(1),
    accountingFramework: AccountingFramework,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type AccountingSettings = z.infer<typeof AccountingSettingsSchema>;
