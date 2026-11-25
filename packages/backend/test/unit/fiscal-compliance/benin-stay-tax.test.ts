import { calculateBeninStayTax } from "@/lambda/domains/fiscal-compliance/providers/benin-emecef/benin-stay-tax";
import { BeninStayTaxInputSchema } from "@liass-ohada/shared/fiscal-compliance";
const facts = { policy: "BJ-STAY-TAX-2026" as const, accommodationTariffXof: "20000",
  daysOrNights: 2, applicabilityEvidence: "Documented accommodation stay" };
test.each([
  ["19999", 500, "1000"], ["20000", 500, "1000"], ["20001", 1500, "3000"],
  ["100000", 1500, "3000"], ["100001", 2500, "5000"],
] as const)("tariff %s uses legal band %s for two days/nights", (accommodationTariffXof, ratePerDayOrNightXof, amountXof) => {
  expect(calculateBeninStayTax({ ...facts, accommodationTariffXof })).toEqual({
    ...facts, accommodationTariffXof, kind: "STAY_TAX", ratePerDayOrNightXof, amountXof,
    includedInVatBase: false, includedInAibBase: false, providerMapping: "REQUIRES_DGI_CLARIFICATION",
  });
});
test("uses exact integer arithmetic beyond Number amount precision", () => {
  expect(calculateBeninStayTax({ ...facts, accommodationTariffXof: "100001", daysOrNights: Number.MAX_SAFE_INTEGER }).amountXof)
    .toBe((2500n * BigInt(Number.MAX_SAFE_INTEGER)).toString());
});
test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid period count %s", daysOrNights => {
  expect(() => calculateBeninStayTax({ ...facts, daysOrNights })).toThrow();
});
test.each(["-1", "20.5", "2e4", "020000"])("rejects noncanonical tariff %s", accommodationTariffXof => {
  expect(() => calculateBeninStayTax({ ...facts, accommodationTariffXof })).toThrow();
});
test("does not accept inferred applicability, provider mapping or tax base overrides", () => {
  expect(BeninStayTaxInputSchema.safeParse({ ...facts, applicabilityEvidence: "" }).success).toBe(false);
  expect(BeninStayTaxInputSchema.safeParse({ ...facts, includedInVatBase: true }).success).toBe(false);
  expect(BeninStayTaxInputSchema.safeParse({ ...facts, taxSpecific: 1000 }).success).toBe(false);
  expect(BeninStayTaxInputSchema.safeParse({ ...facts, policy: "BJ-STAY-TAX-2027" }).success).toBe(false);
});
