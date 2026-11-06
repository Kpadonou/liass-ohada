import { SalesCalculationBinding } from "@liass-ohada/shared/sales";
import { assertCalculationBinding } from "../authority/commercial-policy";
import { CurrencyCodeSchema } from "@liass-ohada/shared/sales";
import { AppError } from "@/lambda/shared/app-error";

let supportedCurrencies: Set<string> | undefined;

export interface SalesCurrencyMetadata {
  code: string;
  minorUnits: number;
}

export const resolveSalesCurrency = (
  input: string,
  binding?: SalesCalculationBinding,
): SalesCurrencyMetadata => {
  if (binding) {
    const pinned = assertCalculationBinding(binding, input);
    return { code: input, minorUnits: pinned.minorUnitScale };
  }
  const code = CurrencyCodeSchema.parse(input);
  supportedCurrencies ??= new Set(
    (
      Intl as typeof Intl & { supportedValuesOf(key: "currency"): string[] }
    ).supportedValuesOf("currency"),
  );
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
