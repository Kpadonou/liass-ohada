import {
  SalesIssuanceAuthoritySnapshotSchema,
  SalesIssuedInvoice,
  SalesCalculationBinding,
} from "@liass-ohada/shared/sales";
import { OrganizationLegalIdentityService } from "@/lambda/shared/services/organization-legal-identity-service";
import { SalesTimezoneService } from "./sales-timezone-service";
import { assertCalculationBinding } from "./commercial-policy";
import {
  admission,
  canonical,
  clean,
  hash,
} from "@/lambda/shared/authority/integrity";
import { AppError } from "@/lambda/shared/app-error";
export function authorityDigest(snapshot: unknown): string {
  return hash(canonical(clean(snapshot)));
}
export function verifyIssuedAuthority(
  source: {
    status: string;
    id: string;
    version: number;
    issuedAt?: string;
    issueDate?: string;
    currency: string;
    calculationBinding?: SalesCalculationBinding;
    issuanceAuthoritySnapshot?: unknown;
    issuanceAuthorityDigest?: string;
  },
  orgId?: string,
): void {
  if (
    !source.issuanceAuthoritySnapshot ||
    !source.issuanceAuthorityDigest ||
    !source.calculationBinding
  )
    throw new AppError(409, "SALES_ISSUANCE_AUTHORITY_REQUIRED");
  admission(
    {
      issuanceAuthoritySnapshot: source.issuanceAuthoritySnapshot,
      issuanceAuthorityDigest: source.issuanceAuthorityDigest,
    },
    131072,
  );
  admission(
    {
      issuanceAuthoritySnapshot: source.issuanceAuthoritySnapshot,
      issuanceAuthorityDigest: source.issuanceAuthorityDigest,
      calculationBinding: source.calculationBinding,
    },
    135168,
  );
  const s = SalesIssuanceAuthoritySnapshotSchema.parse(
    source.issuanceAuthoritySnapshot,
  );
  assertCalculationBinding(source.calculationBinding, source.currency);
  if (
    source.status !== "ISSUED" ||
    s.documentId !== source.id ||
    s.issuedSourceVersion !== source.version ||
    s.issuedAt !== source.issuedAt ||
    s.issueDate !== source.issueDate ||
    (orgId && s.orgId !== orgId) ||
    canonical(s.calculationBinding) !== canonical(source.calculationBinding) ||
    authorityDigest(s) !== source.issuanceAuthorityDigest
  )
    throw new AppError(409, "SALES_ISSUANCE_AUTHORITY_INTEGRITY");
}
export class SalesIssuanceAuthorityService {
  static async capture(input: {
    orgId: string;
    documentType: "INVOICE" | "CREDIT_NOTE";
    documentId: string;
    issuedSourceVersion: number;
    issuedAt: string;
    issueDate: string;
    currency: string;
    calculationBinding: unknown;
    original?: SalesIssuedInvoice;
  }) {
    const binding = assertCalculationBinding(
      input.calculationBinding,
      input.currency,
    );
    const [seller, timezone] = await Promise.all([
      OrganizationLegalIdentityService.readSellerIssuanceAuthority(input.orgId),
      SalesTimezoneService.readIssuanceAuthority(input.orgId),
    ]);
    if (input.original) {
      verifyIssuedAuthority(input.original, input.orgId);
      if (
        input.original.issuanceAuthoritySnapshot!.sellerAuthority
          .legalEntityReference !==
          seller.sellerAuthority.legalEntityReference ||
        canonical(input.original.calculationBinding) !== canonical(binding)
      )
        throw new AppError(409, "SALES_CREDIT_AUTHORITY_CONTINUITY");
    }
    const reference = input.original
      ? `${input.original.id}:${input.original.issuanceAuthorityDigest}`
      : undefined;
    const snapshot = SalesIssuanceAuthoritySnapshotSchema.parse(
      clean({
        schemaVersion: 1,
        orgId: input.orgId,
        documentType: input.documentType,
        documentId: input.documentId,
        issuedSourceVersion: input.issuedSourceVersion,
        issuedAt: input.issuedAt,
        issueDate: input.issueDate,
        issuanceEventReference: `${input.documentType}:${input.documentId}:${input.issuedSourceVersion}`,
        sellerAuthority: seller.sellerAuthority,
        timezoneAuthority: timezone.timezoneAuthority,
        calculationBinding: binding,
        capturedAt: input.issuedAt,
        ...(reference
          ? {
              originalSellerEvidenceReference: reference,
              originalCalculationBindingReference: reference,
            }
          : {}),
      }),
    );
    const digest = authorityDigest(snapshot);
    admission(
      { issuanceAuthoritySnapshot: snapshot, issuanceAuthorityDigest: digest },
      131072,
    );
    admission(
      {
        issuanceAuthoritySnapshot: snapshot,
        issuanceAuthorityDigest: digest,
        calculationBinding: binding,
      },
      135168,
    );
    return {
      issuanceAuthoritySnapshot: snapshot,
      issuanceAuthorityDigest: digest,
      checks: [seller.check, timezone.check],
    };
  }
}
