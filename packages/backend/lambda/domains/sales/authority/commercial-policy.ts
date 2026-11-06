import {
  SalesCalculationBinding,
  SalesCalculationBindingSchema,
} from "@liass-ohada/shared/sales";
import { AppError } from "@/lambda/shared/app-error";
import {
  admission,
  canonical,
  hash,
} from "@/lambda/shared/authority/integrity";
import { registryBytes, policyBytes } from "./commercial-policy-artifacts";
export const POLICY_ID = "LIASS-SALES-LINE-HT-HALFUP";
export const REGISTRY_ID = "LIASS-SALES-CURRENCY-COMPAT-2026-11-04";
export const REGISTRY_DIGEST =
  "2d36e30d0f270a52306de2e95ce3bb2b978e45b99d9a4cdb41796724c86cc1b0";
export const DEFINITION_DIGEST =
  "440a482a247d581a1790c7f16c891acd117bbca6d28b2c28c4abfb0bd1e8e7f8";
export const DEFINITION_FINGERPRINT =
  "c8d38f0350cab6a590e67aa1a02e831b3aa2f6ad780b0d4fa595d3a3eb0882c2";
const approvalReference = "D03-2026-11-04-COMMERCIAL-COMPATIBILITY";
export function readCommercialRegistry(
  registry = registryBytes,
  definition = policyBytes,
): Readonly<Record<string, number>> {
  if (
    hash(registry) !== REGISTRY_DIGEST ||
    hash(definition) !== DEFINITION_DIGEST
  )
    throw new AppError(422, "SALES_POLICY_ARTIFACT_MISMATCH");
  return Object.freeze(JSON.parse(registry) as Record<string, number>);
}
export function calculationBinding(
  currencyCode: string,
): SalesCalculationBinding {
  const minorUnitScale = readCommercialRegistry()[currencyCode];
  if (minorUnitScale === undefined)
    throw new AppError(400, "UNSUPPORTED_CURRENCY");
  return SalesCalculationBindingSchema.parse({
    policyId: POLICY_ID,
    policyVersion: "1",
    definitionBytesDigest: DEFINITION_DIGEST,
    currencyRegistryId: REGISTRY_ID,
    currencyRegistryVersion: "1",
    currencyRegistryDigest: REGISTRY_DIGEST,
    calculationDefinitionFingerprint: DEFINITION_FINGERPRINT,
    currencyCode,
    minorUnitScale,
    approvalReference,
  });
}
export function assertCalculationBinding(
  value: unknown,
  currencyCode: string,
): SalesCalculationBinding {
  const binding = SalesCalculationBindingSchema.parse(value);
  admission(binding, 4096);
  if (canonical(binding) !== canonical(calculationBinding(currencyCode)))
    throw new AppError(409, "SALES_CALCULATION_BINDING_CONFLICT");
  return binding;
}
