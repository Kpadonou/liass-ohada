export type BeninTtcLineAmounts = Readonly<{
  baseNet: number;
  taxableBase: number;
  vat: number;
  specificTax: number;
  total: number;
}>;

const safe = (value: bigint): number => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("BENIN_FISCAL_AMOUNT_OUT_OF_RANGE");
  return Number(value);
};

const nonnegative = (value: number, name: string): bigint => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`BENIN_FISCAL_${name}_INVALID`);
  return BigInt(value);
};

/** Whole-XOF half-up division, implemented with integers only. */
const halfUp = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n) throw new Error("BENIN_FISCAL_RATE_INVALID");
  return (numerator * 2n + denominator) / (denominator * 2n);
};

/**
 * DGI TTC line calculation for a total specific tax.
 *
 * `priceTtc` is the line price before the specific tax. `specificTax` is the
 * full-line value sent as ItemDto.taxSpecific and is therefore never scaled by
 * quantity. Taxe de séjour is intentionally not inferred from this function:
 * the governed references do not settle its calculation order.
 */
export function calculateBeninSpecificTaxTtcLine(input: {
  priceTtc: number;
  specificTax?: number;
  vatRateBasisPoints: 0 | 1800;
}): BeninTtcLineAmounts {
  const priceTtc = nonnegative(input.priceTtc, "PRICE");
  const specificTax = nonnegative(input.specificTax ?? 0, "SPECIFIC_TAX");
  const rate = BigInt(input.vatRateBasisPoints);
  const denominator = 10000n + rate;
  const ordinaryVat = halfUp(priceTtc * rate, denominator);
  const baseNet = priceTtc - ordinaryVat;
  const taxableBase = baseNet + specificTax;
  // Preserve the exact TTC price while applying VAT to the additional tax.
  // DGI's displayed taxable base is whole-XOF rounded, so VAT is the balancing
  // amount that keeps base + VAT equal to the exact final TTC total.
  const total = priceTtc + specificTax + halfUp(specificTax * rate, 10000n);
  const vat = total - taxableBase;
  return Object.freeze({
    baseNet: safe(baseNet),
    taxableBase: safe(taxableBase),
    vat: safe(vat),
    specificTax: safe(specificTax),
    total: safe(total),
  });
}
