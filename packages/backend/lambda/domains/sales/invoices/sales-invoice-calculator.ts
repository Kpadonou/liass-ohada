import {
  SalesInvoiceLine,
  SalesInvoiceQuantitySchema,
  SalesInvoiceTaxRateSchema,
  SalesInvoiceUnitPriceSchema,
} from "@liass-ohada/shared/sales";
import { resolveSalesCurrency } from "./sales-currency";

interface DecimalValue {
  coefficient: bigint;
  scale: number;
}

const powerOfTen = (exponent: number): bigint => 10n ** BigInt(exponent);

const parseDecimal = (value: string): DecimalValue => {
  const [whole, fraction = ""] = value.split(".");
  return {
    coefficient: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
};

const normalizeDecimal = (value: string): string => {
  const [whole, fraction = ""] = value.split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
};

const roundHalfUp = (
  coefficient: bigint,
  sourceScale: number,
  targetScale: number,
): bigint => {
  if (sourceScale <= targetScale) {
    return coefficient * powerOfTen(targetScale - sourceScale);
  }
  const divisor = powerOfTen(sourceScale - targetScale);
  const quotient = coefficient / divisor;
  const remainder = coefficient % divisor;
  return quotient + (remainder * 2n >= divisor ? 1n : 0n);
};

const formatMinorUnits = (minor: bigint, scale: number): string => {
  if (scale === 0) return minor.toString();
  const digits = minor.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
};

const moneyToMinorUnits = (value: string, scale: number): bigint => {
  const decimal = parseDecimal(value);
  if (decimal.scale > scale) {
    throw new Error("Calculated money exceeds the currency scale");
  }
  return decimal.coefficient * powerOfTen(scale - decimal.scale);
};

export interface CalculateSalesInvoiceLineInput {
  catalogItemId?: string;
  createdAt: string;
  description: string;
  id: string;
  position: number;
  quantity: string;
  taxRate: string;
  unit?: string;
  unitPrice: string;
  updatedAt: string;
}

export class SalesInvoiceCalculator {
  static calculateLine(
    currency: string,
    input: CalculateSalesInvoiceLineInput,
  ): SalesInvoiceLine {
    const { minorUnits } = resolveSalesCurrency(currency);
    const quantity = normalizeDecimal(
      SalesInvoiceQuantitySchema.parse(input.quantity),
    );
    const unitPrice = normalizeDecimal(
      SalesInvoiceUnitPriceSchema.parse(input.unitPrice),
    );
    const taxRate = normalizeDecimal(
      SalesInvoiceTaxRateSchema.parse(input.taxRate),
    );
    const quantityDecimal = parseDecimal(quantity);
    const unitPriceDecimal = parseDecimal(unitPrice);
    const subtotalMinor = roundHalfUp(
      quantityDecimal.coefficient * unitPriceDecimal.coefficient,
      quantityDecimal.scale + unitPriceDecimal.scale,
      minorUnits,
    );
    const taxDecimal = parseDecimal(taxRate);
    const taxMinor = roundHalfUp(
      subtotalMinor * taxDecimal.coefficient,
      taxDecimal.scale + 2,
      0,
    );

    return {
      ...input,
      quantity,
      unitPrice,
      taxRate,
      subtotal: formatMinorUnits(subtotalMinor, minorUnits),
      taxAmount: formatMinorUnits(taxMinor, minorUnits),
      total: formatMinorUnits(subtotalMinor + taxMinor, minorUnits),
    };
  }

  static calculateTotals(
    currency: string,
    lines: readonly SalesInvoiceLine[],
  ): { subtotal: string; taxTotal: string; total: string } {
    const { minorUnits } = resolveSalesCurrency(currency);
    const sums = lines.reduce(
      (result, line) => ({
        subtotal: result.subtotal + moneyToMinorUnits(line.subtotal, minorUnits),
        taxTotal: result.taxTotal + moneyToMinorUnits(line.taxAmount, minorUnits),
        total: result.total + moneyToMinorUnits(line.total, minorUnits),
      }),
      { subtotal: 0n, taxTotal: 0n, total: 0n },
    );
    return {
      subtotal: formatMinorUnits(sums.subtotal, minorUnits),
      taxTotal: formatMinorUnits(sums.taxTotal, minorUnits),
      total: formatMinorUnits(sums.total, minorUnits),
    };
  }

  static toMinorUnits(currency: string, value: string): string {
    return moneyToMinorUnits(
      value,
      resolveSalesCurrency(currency).minorUnits,
    ).toString();
  }

  static fromMinorUnits(currency: string, value: string): string {
    return formatMinorUnits(
      BigInt(value),
      resolveSalesCurrency(currency).minorUnits,
    );
  }
}
