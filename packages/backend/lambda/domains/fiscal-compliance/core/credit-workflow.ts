import { canonical } from "@/lambda/shared/authority/integrity";
import type { FiscalIssuanceBinding } from "@liass-ohada/shared/shared";
import { confirmedCreditOriginal } from "./credit-original";
import type { FiscalAttemptState } from "./fiscal-attempt-state";

/** Shared admission for credit consumers. Business owners retain cumulative
 * credit limits and atomic issuance. A frozen policy is authorization to prepare,
 * never evidence that an unverified provider encoding may be dispatched. */
export function authorizeCreditPreparation(input: {
  orgId: string; sourceDomain: string; originalInvoiceId: string; originalSourceDigest: string;
  creditSourceDigest: string; fiscalBinding: FiscalIssuanceBinding; original: FiscalAttemptState;
}) {
  if (input.fiscalBinding.environment !== "TEST" || !/^[a-f0-9]{64}$/.test(input.creditSourceDigest))
    throw new Error("FISCAL_CREDIT_SCOPE_DENIED");
  if (!input.original.fiscalBinding || canonical(input.original.fiscalBinding) !== canonical(input.fiscalBinding))
    throw new Error("FISCAL_CREDIT_BINDING_MISMATCH");
  const original = confirmedCreditOriginal(input.original, { orgId: input.orgId,
    sourceDomain: input.sourceDomain, sourceDocumentId: input.originalInvoiceId, sourceDigest: input.originalSourceDigest });
  return { environment: "TEST" as const, sourceDigest: input.creditSourceDigest,
    fiscalBinding: structuredClone(input.fiscalBinding), original,
    status: "BLOCKED" as const, reason: "PROVIDER_CREDIT_WIRE_SEMANTICS_UNVERIFIED" as const,
    providerMutationAllowed: false as const };
}

export function assertCreditProviderExecutionEnabled() {
  // Candidate mapping tests are local only. No deployed sign/reference contract
  // has been verified for FA/EA, including raw 24-character original codes.
  if (process.env.NODE_ENV !== "test") throw new Error("FISCAL_CREDIT_WIRE_SEMANTICS_UNVERIFIED");
}
