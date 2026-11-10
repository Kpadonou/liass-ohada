import { z } from "zod";
import { BENIN_FISCAL_REGIMES } from "./benin";

const fiscalRegimesByCountry = Object.freeze({ BJ: BENIN_FISCAL_REGIMES });
export function listFiscalRegimes(country: string | undefined) {
  if (country === undefined || !Object.hasOwn(fiscalRegimesByCountry, country))
    return [];
  return Object.values(
    fiscalRegimesByCountry[country as keyof typeof fiscalRegimesByCountry],
  );
}
const declaration = z
  .object({
    regime: z.string().min(1).max(100),
  })
  .strict();

/** The country is supplied by the organization authority, never the declaration body. */
export function resolveFiscalProfile(country: string, input: unknown) {
  const { regime } = declaration.parse(input);
  if (!Object.hasOwn(fiscalRegimesByCountry, country))
    throw new Error("UNSUPPORTED_FISCAL_COUNTRY");
  const regimes =
    fiscalRegimesByCountry[country as keyof typeof fiscalRegimesByCountry];
  if (!Object.hasOwn(regimes, regime))
    throw new Error("UNSUPPORTED_FISCAL_REGIME");
  return Object.freeze({
    country,
    rule: regimes[regime as keyof typeof regimes],
  });
}
