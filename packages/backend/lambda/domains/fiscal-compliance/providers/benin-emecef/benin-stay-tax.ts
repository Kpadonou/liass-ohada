import { BeninStayTaxInputSchema, BeninStayTaxComponentSchema,
  type BeninStayTaxInput, type BeninStayTaxComponent } from "@liass-ohada/shared/fiscal-compliance";

/** CGI Benin 2026 arts 291–293: daily/nightly bands, outside VAT base.
 * DGI rescrit 2487 (17 July 2024): outside AIB base. Caller supplies documented
 * accommodation applicability and period count. No taxSpecific or provider-group
 * mapping is inferred, and no commercial or accounting amounts are rewritten.
 */
export function calculateBeninStayTax(input: BeninStayTaxInput): BeninStayTaxComponent {
  const facts = BeninStayTaxInputSchema.parse(input);
  const tariff = BigInt(facts.accommodationTariffXof);
  const ratePerDayOrNightXof = tariff <= 20_000n ? 500 : tariff <= 100_000n ? 1500 : 2500;
  const amountXof = (BigInt(ratePerDayOrNightXof) * BigInt(facts.daysOrNights)).toString();
  return BeninStayTaxComponentSchema.parse({ ...facts, kind: "STAY_TAX", ratePerDayOrNightXof,
    amountXof, includedInVatBase: false, includedInAibBase: false,
    providerMapping: "REQUIRES_DGI_CLARIFICATION" });
}
