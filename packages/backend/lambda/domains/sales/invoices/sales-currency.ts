import { CurrencyCodeSchema } from "@liass-ohada/shared/sales";
import { AppError } from "@/lambda/shared/app-error";

const supportedCurrencies = new Set(
  (Intl as typeof Intl & { supportedValuesOf(key: "currency"): string[] })
    .supportedValuesOf("currency"),
);

export interface SalesCurrencyMetadata {
  code: string;
  minorUnits: number;
}

export const resolveSalesCurrency = (input: string): SalesCurrencyMetadata => {
  const code = CurrencyCodeSchema.parse(input);
  if (!supportedCurrencies.has(code)) {
    throw new AppError(400, "UNSUPPORTED_CURRENCY", { currency: code });
  }

  const minorUnits =
    new Intl.NumberFormat("en", {
      currency: code,
      style: "currency",
    }).resolvedOptions().maximumFractionDigits ?? -1;

  if (!Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 4) {
    throw new AppError(400, "UNSUPPORTED_CURRENCY", { currency: code });
  }

  return { code, minorUnits };
};
