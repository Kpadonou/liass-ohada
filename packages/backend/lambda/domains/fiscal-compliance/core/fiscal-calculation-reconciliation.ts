import { z } from "zod";

const amount = z.number().int().safe().nonnegative();
const fields = ["ta", "tb", "tc", "td", "taa", "tab", "tac", "tad", "tae", "taf",
  "hab", "had", "vab", "vad", "aib", "ts", "total"] as const;
export const fiscalCalculationFieldSchema = z.enum(fields);
export const fiscalCalculationDifferenceSchema = z.object({
  field: fiscalCalculationFieldSchema,
  expected: amount,
  actual: amount.nullable(),
}).strict();
export const fiscalCalculationReconciliationSchema = z.object({
  status: z.enum(["MATCH", "MISMATCH"]),
  phase: z.enum(["CREATE", "GET"]),
  differences: z.array(fiscalCalculationDifferenceSchema).max(fields.length),
}).strict().refine(v => (v.status === "MATCH") === (v.differences.length === 0));
export type FiscalCalculationReconciliation = z.infer<typeof fiscalCalculationReconciliationSchema>;
export type FiscalCalculationTotals = Record<(typeof fields)[number], number>;

/** Whole-XOF values are compared exactly. The commercial source has already
 * applied its line-level HALF_UP policy; this boundary never rounds a provider
 * result, adds a tolerance, or replaces a source value. Missing fields differ.
 */
export function reconcileFiscalCalculations(
  expected: FiscalCalculationTotals,
  observed: Partial<FiscalCalculationTotals>,
): FiscalCalculationReconciliation {
  const differences = fields.flatMap(field => {
    const value = amount.parse(expected[field]);
    const actual = observed[field];
    return actual === value ? [] : [{ field, expected: value,
      actual: actual === undefined ? null : amount.parse(actual) }];
  });
  return fiscalCalculationReconciliationSchema.parse({
    status: differences.length ? "MISMATCH" : "MATCH", phase: "CREATE", differences,
  });
}
