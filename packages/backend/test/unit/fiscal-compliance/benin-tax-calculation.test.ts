import { calculateBeninSpecificTaxTtcLine } from "@/lambda/domains/fiscal-compliance/providers/benin-emecef/benin-tax-calculation";

describe("Benin DGI TTC and specific-tax calculation", () => {
  test("reproduces the governed DGI group B specific-tax example", () => {
    expect(calculateBeninSpecificTaxTtcLine({
      priceTtc: 25_000,
      specificTax: 3_000,
      vatRateBasisPoints: 1800,
    })).toEqual({
      baseNet: 21_186,
      taxableBase: 24_186,
      vat: 4_354,
      specificTax: 3_000,
      total: 28_540,
    });
  });

  test("does not multiply the full-line specific tax by quantity upstream", () => {
    const linePriceForQuantityThree = 75_000;
    const result = calculateBeninSpecificTaxTtcLine({
      priceTtc: linePriceForQuantityThree,
      specificTax: 3_000,
      vatRateBasisPoints: 1800,
    });
    expect(result.specificTax).toBe(3_000);
    expect(result.taxableBase).toBe(66_559);
    expect(result.vat).toBe(11_981);
    expect(result.total).toBe(78_540);
  });

  test("keeps the established TTC split when no specific tax applies", () => {
    expect(calculateBeninSpecificTaxTtcLine({
      priceTtc: 1_000,
      vatRateBasisPoints: 1800,
    })).toEqual({
      baseNet: 847,
      taxableBase: 847,
      vat: 153,
      specificTax: 0,
      total: 1_000,
    });
  });
});
