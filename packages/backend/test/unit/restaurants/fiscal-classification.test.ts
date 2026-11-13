import { calculateRestaurantFiscalAmounts, resolveRestaurantFiscalTreatment } from "@/lambda/domains/restaurants/fiscal-treatment";

const company = (regime: "ORDINARY_VAT" | "TPS") => ({
  country: "BJ", selected: { revision: "00000000-0000-4000-8000-000000000001" },
  profile: { rule: { id: regime } },
});
const classification = (group: "A" | "B" | "E") => ({ country: "BJ" as const, group });

test("ordinary VAT accepts A/B defaults, rounds normal XOF prices, and freezes rule identity", () => {
  const a = resolveRestaurantFiscalTreatment({ classification: classification("A"), company: company("ORDINARY_VAT") });
  const b = resolveRestaurantFiscalTreatment({ classification: classification("B"), company: company("ORDINARY_VAT") });
  expect(calculateRestaurantFiscalAmounts(1000, a)).toEqual({ netMinor: 1000, taxMinor: 0 });
  expect(calculateRestaurantFiscalAmounts(1000, b)).toEqual({ netMinor: 847, taxMinor: 153 });
  expect(calculateRestaurantFiscalAmounts(999 * 3, b)).toEqual({ netMinor: 2540, taxMinor: 457 });
  expect(b).toMatchObject({ catalogGroup: "B", effectiveGroup: "B", policyVersion: 1, rounding: "HALF_UP_LINE" });
});

test("TPS defaults to E and only an evidenced state buyer exception can use B", () => {
  expect(resolveRestaurantFiscalTreatment({ classification: classification("E"), company: company("TPS") }).effectiveGroup).toBe("E");
  expect(resolveRestaurantFiscalTreatment({ classification: classification("E"), company: company("TPS"),
    exception: { group: "B", evidenceReference: "STATE-BUYER-1" } })).toMatchObject({ catalogGroup: "E", effectiveGroup: "B", rateBasisPoints: 1800 });
  expect(() => resolveRestaurantFiscalTreatment({ classification: classification("B"), company: company("TPS") })).toThrow();
  expect(() => resolveRestaurantFiscalTreatment({ classification: undefined, company: company("ORDINARY_VAT") })).toThrow();
});

test("export and exception regime are transaction-specific, while F requires a separate tax schedule", () => {
  for (const group of ["C", "D"] as const) {
    expect(resolveRestaurantFiscalTreatment({ classification: classification("B"), company: company("ORDINARY_VAT"),
      exception: { group, evidenceReference: `DOCUMENT-${group}` } }).effectiveGroup).toBe(group);
  }
  expect(() => resolveRestaurantFiscalTreatment({ classification: classification("E"), company: company("ORDINARY_VAT") })).toThrow();
});
