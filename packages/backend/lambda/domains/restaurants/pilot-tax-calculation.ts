import { resolveFiscalProfile } from "@/lambda/shared/authority/fiscal-profiles/profile";
import { canonical, hash } from "@/lambda/shared/authority/integrity";
import { calculateRestaurantFiscalAmounts } from "./fiscal-treatment";

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
  currency: string;
  ordinaryTax?: NonNullable<import("@liass-ohada/shared/restaurants").RestaurantOrderItem["snapshot"]>["ordinaryTax"];
  fiscalTreatment?: NonNullable<import("@liass-ohada/shared/restaurants").RestaurantOrderItem["snapshot"]>["fiscalTreatment"];
};

/** Historical verification uses only frozen facts. */
export function validRestaurantSaleTax(snapshot: SaleTaxAmounts): boolean {
  if (snapshot.grossMinor !== snapshot.lineTotalMinor) return false;
  const { ordinaryTax, subtotalMinor, taxMinor } = snapshot;
  const frozen = snapshot.fiscalTreatment;
  if (frozen) {
    if (ordinaryTax || frozen.policyId !== "BJ-RESTO-TTC" || frozen.policyVersion !== 1 ||
        frozen.rounding !== "HALF_UP_LINE" || snapshot.currency !== "XOF" ||
        (frozen.effectiveGroup === "B" || frozen.effectiveGroup === "D") !== (frozen.rateBasisPoints === 1800)) return false;
    const expected = calculateRestaurantFiscalAmounts(snapshot.grossMinor, frozen);
    return expected.netMinor === subtotalMinor && expected.taxMinor === taxMinor;
  }
  if (!ordinaryTax) return taxMinor === 0 && subtotalMinor === snapshot.grossMinor;
  const { policy, policyDigest } = ordinaryTax;
  return snapshot.currency === policy.currency &&
    policyDigest === hash(canonical(policy)) &&
    subtotalMinor > 0 && taxMinor > 0 &&
    BigInt(subtotalMinor) + BigInt(taxMinor) === BigInt(snapshot.grossMinor) &&
    BigInt(subtotalMinor) * BigInt(policy.profile.rule.taxRateBasisPoints) === BigInt(taxMinor) * 10000n;
}
