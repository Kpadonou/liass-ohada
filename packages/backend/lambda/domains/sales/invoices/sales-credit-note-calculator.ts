import {
  SalesCreditNoteLine,
  SalesCreditNoteLineSchema,
  SalesInvoiceLine,
  SalesInvoiceQuantitySchema,
} from "@liass-ohada/shared/sales";
import { AppError } from "@/lambda/shared/app-error";
import { SalesInvoiceCalculator } from "./sales-invoice-calculator";

const decimal = (value: string): { coefficient: bigint; scale: number } => {
  const [whole, fraction = ""] = value.split(".");
  return { coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length };
};

const normalize = (coefficient: bigint, scale: number): string => {
  if (scale === 0) return coefficient.toString();
  const digits = coefficient.toString().padStart(scale + 1, "0");
  const result = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
  return result;
};

const align = (left: string, right: string) => {
  const a = decimal(left);
  const b = decimal(right);
  const scale = Math.max(a.scale, b.scale);
  return {
    left: a.coefficient * 10n ** BigInt(scale - a.scale),
    right: b.coefficient * 10n ** BigInt(scale - b.scale),
    scale,
  };
};

export class SalesCreditNoteCalculator {
  static calculateLine(input: {
    currency: string;
    id: string;
    originalLine: SalesInvoiceLine;
    position: number;
    quantity: string;
    timestamp: string;
  }): SalesCreditNoteLine {
    SalesInvoiceQuantitySchema.parse(input.quantity);
    if (this.compareQuantity(input.quantity, input.originalLine.quantity) > 0) {
      throw new AppError(409, "SALES_CREDIT_NOTE_QUANTITY_EXCEEDS_SOURCE");
    }
    const calculated = SalesInvoiceCalculator.calculateLine(input.currency, {
      id: input.id,
      position: input.position,
      description: input.originalLine.description,
      unit: input.originalLine.unit,
      quantity: input.quantity,
      unitPrice: input.originalLine.unitPrice,
      taxRate: input.originalLine.taxRate,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    });
    return SalesCreditNoteLineSchema.parse({
      ...calculated,
      originalInvoiceLineId: input.originalLine.id,
    });
  }

  static addQuantities(left: string, right: string): string {
    const values = align(left, right);
    return normalize(values.left + values.right, values.scale);
  }

  static compareQuantity(left: string, right: string): number {
    const values = align(left, right);
    return values.left < values.right ? -1 : values.left > values.right ? 1 : 0;
  }
}
