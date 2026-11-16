import { resolveFiscalProfile } from "@/lambda/shared/authority/fiscal-profiles/profile";
import { canonical, hash } from "@/lambda/shared/authority/integrity";
import {
  calculateRestaurantFiscalAmounts,
  calculateRestaurantFiscalLine,
} from "./fiscal-treatment";

/** Exact TTC pilot calculation. Margin is a period basis and cannot enter this
 * ordinary invoice path. Persist the returned facts together if admitted. */
export function calculateRestaurantPilotTax(input: {
  country: string;
  declaration: unknown;
  currency: string;
  grossMinor: number;
}) {
  const profile = resolveFiscalProfile(input.country, input.declaration);
  if (profile.rule.basis !== "NET_SALE" || input.currency !== "XOF")
    throw new Error("UNSUPPORTED_RESTAURANT_PILOT_TAX_CASE");
  if (!Number.isSafeInteger(input.grossMinor) || input.grossMinor <= 0)
    throw new Error("POSITIVE_SAFE_GROSS_REQUIRED");
  const gross = BigInt(input.grossMinor);
  const netNumerator = gross * 10000n;
  const denominator = 10000n + BigInt(profile.rule.taxRateBasisPoints);
  if (netNumerator % denominator !== 0n)
    throw new Error("FRACTIONAL_XOF_TAX_SPLIT");
  const net = netNumerator / denominator;
  const policy = Object.freeze({
    id: "RESTO-EXACT-TTC",
    version: 1,
    currency: "XOF",
    minorUnitScale: 0,
    priceBasis: "INCLUDING_TAX",
    rounding: "EXACT",
    profile,
  } as const);
  return Object.freeze({
    policy,
    policyDigest: hash(canonical(policy)),
    netMinor: Number(net),
    taxMinor: Number(gross - net),
    grossMinor: input.grossMinor,
  });
}

type SaleTaxAmounts = {
  subtotalMinor: number;
  grossMinor: number;
  lineTotalMinor: number;
  taxMinor: number;
  specificTaxMinor?: number;
  specificTaxKind?: "SPECIFIC" | "ACCOMMODATION";
  currency: string;
  ordinaryTax?: NonNullable<import("@liass-ohada/shared/restaurants").RestaurantOrderItem["snapshot"]>["ordinaryTax"];
  fiscalTreatment?: NonNullable<import("@liass-ohada/shared/restaurants").RestaurantOrderItem["snapshot"]>["fiscalTreatment"];
};

/** Historical verification uses only frozen facts. */
export function validRestaurantSaleTax(snapshot: SaleTaxAmounts): boolean {
  const { ordinaryTax, subtotalMinor, taxMinor } = snapshot;
  const frozen = snapshot.fiscalTreatment;
  if (frozen) {
    const specificTax = snapshot.specificTaxMinor ?? 0;
    if ((snapshot.specificTaxMinor === undefined) !== (snapshot.specificTaxKind === undefined) ||
        !Number.isSafeInteger(specificTax) || specificTax < 0) return false;
    const ordinary = frozen.regime === "ORDINARY_VAT" &&
      (frozen.catalogGroup === "A" && frozen.effectiveGroup === "A" ||
       frozen.catalogGroup === "B" && ["B", "C", "D"].includes(frozen.effectiveGroup));
    const tps = frozen.regime === "TPS" && frozen.catalogGroup === "E" &&
      ["E", "B"].includes(frozen.effectiveGroup);
    const exception = frozen.effectiveGroup === "C" || frozen.effectiveGroup === "D" ||
      frozen.regime === "TPS" && frozen.effectiveGroup === "B";
    if (ordinaryTax || frozen.policyId !== "BJ-RESTO-TTC" || ![1, 2].includes(frozen.policyVersion) ||
        frozen.rounding !== "HALF_UP_LINE" || snapshot.currency !== "XOF" ||
        (!ordinary && !tps) || (exception && !frozen.evidenceReference) ||
        (frozen.effectiveGroup === "B" || frozen.effectiveGroup === "D") !== (frozen.rateBasisPoints === 1800)) return false;
    if (frozen.policyVersion === 1) {
      if (snapshot.grossMinor !== snapshot.lineTotalMinor || specificTax >= snapshot.grossMinor)
        return false;
      const expected = calculateRestaurantFiscalAmounts(snapshot.grossMinor - specificTax, frozen);
      return expected.netMinor === subtotalMinor && expected.taxMinor === taxMinor;
    }
    if (snapshot.specificTaxKind === "ACCOMMODATION") return false;
    const expected = calculateRestaurantFiscalLine({
      priceTtcMinor: snapshot.grossMinor,
      specificTaxMinor: snapshot.specificTaxMinor,
      treatment: frozen,
    });
    return expected.netMinor === subtotalMinor &&
      expected.taxMinor === taxMinor &&
      expected.totalMinor === snapshot.lineTotalMinor;
  }
  if (snapshot.specificTaxMinor !== undefined || snapshot.specificTaxKind !== undefined) return false;
  if (!ordinaryTax)
    return snapshot.grossMinor === snapshot.lineTotalMinor &&
      taxMinor === 0 && subtotalMinor === snapshot.grossMinor;
  const { policy, policyDigest } = ordinaryTax;
  return snapshot.currency === policy.currency &&
    policyDigest === hash(canonical(policy)) &&
    subtotalMinor > 0 && taxMinor > 0 &&
    BigInt(subtotalMinor) + BigInt(taxMinor) === BigInt(snapshot.grossMinor) &&
    BigInt(subtotalMinor) * BigInt(policy.profile.rule.taxRateBasisPoints) === BigInt(taxMinor) * 10000n;
}
