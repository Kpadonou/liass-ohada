import { resolveFiscalProfile } from "@/lambda/shared/authority/fiscal-profiles/profile";
import { calculateRestaurantPilotTax } from "@/lambda/domains/restaurants/pilot-tax-calculation";

const ordinary = { country: "BJ", declaration: { regime: "ORDINARY_VAT" }, currency: "XOF" };

test("one-unit ordinary TTC pilot has an exact and reproducible split", () => {
  const amounts = calculateRestaurantPilotTax({ ...ordinary, grossMinor: 2360 });
  expect(amounts).toMatchObject({ netMinor: 2000, taxMinor: 360, grossMinor: 2360 });
  expect(amounts.netMinor + amounts.taxMinor).toBe(amounts.grossMinor);
  expect(amounts.netMinor * 18).toBe(amounts.taxMinor * 100);
  expect(amounts.policyDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(calculateRestaurantPilotTax({ ...ordinary, grossMinor: 118 }).policyDigest).toBe(amounts.policyDigest);
  expect(Object.isFrozen(amounts.policy.profile.rule)).toBe(true);
});

test.each([2000, 2359, 2361])("rejects fractional TTC split for %s", (grossMinor) => {
  expect(() => calculateRestaurantPilotTax({ ...ordinary, grossMinor })).toThrow("FRACTIONAL_XOF_TAX_SPLIT");
});

test.each([0, -2360, Number.MAX_SAFE_INTEGER + 1])("rejects invalid gross %s", (grossMinor) => {
  expect(() => calculateRestaurantPilotTax({ ...ordinary, grossMinor })).toThrow("POSITIVE_SAFE_GROSS_REQUIRED");
});

test("lists the declared margin rule separately and excludes it from the ordinary pilot", () => {
  const declaration = { regime: "RESTAURANT_VAT_ON_MARGIN" };
  expect(resolveFiscalProfile("BJ", declaration).rule).toMatchObject({
    basis: "PERIOD_NET_SALES", marginBasisPoints: 3310,
  });
  expect(() => calculateRestaurantPilotTax({ ...ordinary, declaration, grossMinor: 2360 }))
    .toThrow("UNSUPPORTED_RESTAURANT_PILOT_TAX_CASE");
});

test("does not allow customers to override rates or select an unsupported regime", () => {
  expect(() => resolveFiscalProfile("BJ", { ...ordinary.declaration, taxRateBasisPoints: 1 })).toThrow();
  expect(() => resolveFiscalProfile("BJ", { regime: "constructor" })).toThrow("UNSUPPORTED_FISCAL_REGIME");
  expect(() => resolveFiscalProfile("FR", ordinary.declaration)).toThrow("UNSUPPORTED_FISCAL_COUNTRY");
});
