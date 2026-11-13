import type { MenuItem, RestaurantFiscalTreatmentSchema } from "@liass-ohada/shared/restaurants";
import type { z } from "zod";

type Treatment = z.infer<typeof RestaurantFiscalTreatmentSchema>;
type Exception = { group: "B" | "C" | "D"; evidenceReference: string };

/** Benin DGI groups: A exempt, B ordinary 18%, C export 0%, D exception
 * regime 18%, E TPS 0%, F special taxes (unsupported without a tax schedule).
 * Transaction exceptions require evidence, never a catalog default. */
export function resolveRestaurantFiscalTreatment(input: {
  classification: MenuItem["fiscalClassification"];
  company: { country?: string; selected?: { revision: string }; profile?: { rule: { id: string } } } | undefined;
  exception?: Exception;
}): Treatment {
  const { classification, company, exception: requested } = input;
  if (!classification || !company?.selected || company.country !== classification.country)
    throw new Error("RESTAURANTS_FISCAL_CLASSIFICATION_REQUIRED");
  const regime = company.profile?.rule.id;
  const group = requested?.group ?? classification.group;
  if (regime === "ORDINARY_VAT") {
    if (classification.group === "E" || group === "E") throw new Error("RESTAURANTS_FISCAL_GROUP_REGIME_MISMATCH");
    if (group === "D" && classification.group !== "B")
      throw new Error("RESTAURANTS_FISCAL_EXCEPTION_UNSUPPORTED");
    if (group === "C" || group === "D") {
      if (!requested?.evidenceReference) throw new Error("RESTAURANTS_FISCAL_EXCEPTION_EVIDENCE_REQUIRED");
    } else if (requested) throw new Error("RESTAURANTS_FISCAL_EXCEPTION_UNSUPPORTED");
  } else if (regime === "TPS") {
    if (classification.group !== "E" || !["E", "B"].includes(group))
      throw new Error("RESTAURANTS_FISCAL_GROUP_REGIME_MISMATCH");
    if (group === "B" && !requested?.evidenceReference)
      throw new Error("RESTAURANTS_FISCAL_EXCEPTION_EVIDENCE_REQUIRED");
  } else throw new Error("RESTAURANTS_FISCAL_REGIME_UNSUPPORTED");
  return {
    country: "BJ", catalogGroup: classification.group, effectiveGroup: group,
    regime, regimeRevision: company.selected.revision,
    policyId: "BJ-RESTO-TTC", policyVersion: 1,
    rateBasisPoints: group === "B" || group === "D" ? 1800 : 0,
    rounding: "HALF_UP_LINE",
    ...(requested ? { evidenceReference: requested.evidenceReference } : {}),
  } as Treatment;
}

/** TTC XOF: round VAT to nearest whole franc, ties upward, per accepted line. */
export function calculateRestaurantFiscalAmounts(grossMinor: number, treatment: Treatment) {
  if (!Number.isSafeInteger(grossMinor) || grossMinor < 0)
    throw new Error("NONNEGATIVE_SAFE_GROSS_REQUIRED");
  const gross = BigInt(grossMinor);
  const rate = BigInt(treatment.rateBasisPoints);
  const denominator = 10000n + rate;
  const tax = (gross * rate * 2n + denominator) / (2n * denominator);
  return { netMinor: Number(gross - tax), taxMinor: Number(tax) };
}
