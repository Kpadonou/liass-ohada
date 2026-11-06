import { calculationBinding } from "@/lambda/domains/sales/authority/commercial-policy";
import { canonical, hash } from "@/lambda/shared/authority/integrity";
import { authorityDigest } from "@/lambda/domains/sales/authority/sales-issuance-authority-service";
import {
  tzdbVersion,
  tzdbDigest,
  identifierDigest,
} from "@/lambda/domains/sales/authority/iana-artifacts";
import { OrganizationLegalIdentityService } from "@/lambda/shared/services/organization-legal-identity-service";
import { SalesTimezoneService } from "@/lambda/domains/sales/authority/sales-timezone-service";
import { SalesIssuedInvoice } from "@liass-ohada/shared/sales";
export const id = "11111111-1111-4111-8111-111111111111";
export const artifact = (
  reference: string,
  version: string,
  value: unknown,
) => {
  const bytes = canonical(value);
  return {
    reference,
    version,
    format: "LIASS-AUTHORITY-JSON-1",
    bytes,
    digest: hash(bytes),
  };
};
export function legal(orgId = "org-123", selectionBaseVersion = 0) {
  const identity = {
    orgId,
    legalEntityReference: "synthetic-entity",
    authorityReference: "PLATFORM_LEGAL_IDENTITY_REVIEW",
    authorityVersion: "1",
    identityReference: id,
    identityVersion: "1",
    seller: { name: "Synthetic seller", identifiers: [] },
    subjectBindingState: "VERIFIED" as const,
    evidenceReference: id,
    factStates: [
      {
        fieldPath: "name",
        state: "VERIFIED" as const,
        evidenceReference: "acceptance",
      },
    ],
  };
  const proof = artifact(id, "1", identity);
  const acceptance = artifact("acceptance", "1", {
    orgId,
    identityReference: id,
    identityVersion: "1",
    identityDigest: proof.digest,
    decision: "ACCEPTED",
    reviewedByUserId: "reviewer",
    selectionBaseVersion,
  });
  return {
    ...identity,
    identityDigest: proof.digest,
    acceptanceReference: "acceptance",
    acceptanceVersion: "1",
    evidenceArtifacts: [proof, acceptance],
  };
}
export function timezone(orgId = "org-123", selectionBaseVersion = 0) {
  const a = {
    orgId,
    reference: id,
    version: "1",
    timezone: "Africa/Porto-Novo",
    tzdbVersion,
    tzdbArtifactDigest: tzdbDigest,
    acceptedIdentifierArtifactDigest: identifierDigest,
    approvalReference: "timezone-approval",
  };
  const c = artifact(id, "1", a);
  const approval = artifact("timezone-approval", "1", {
    orgId,
    reference: id,
    version: "1",
    configurationDigest: c.digest,
    decision: "ACCEPTED",
    reviewedByUserId: "reviewer",
    selectionBaseVersion,
  });
  return { ...a, evidenceArtifacts: [c, approval] };
}
export function mockAuthorities() {
  jest
    .spyOn(OrganizationLegalIdentityService, "readSellerIssuanceAuthority")
    .mockImplementation(async (orgId) => {
      const { evidenceArtifacts, ...sellerAuthority } = legal(orgId);
      return {
        sellerAuthority,
        check: {
          ConditionCheck: {
            TableName: "test",
            Key: { PK: { S: "opaque-platform-check" } },
            ConditionExpression: "#version = :v",
            ExpressionAttributeNames: { "#version": "version" },
            ExpressionAttributeValues: { ":v": { N: "1" } },
          },
        },
      };
    });
  jest
    .spyOn(SalesTimezoneService, "readIssuanceAuthority")
    .mockImplementation(async (orgId) => {
      const { evidenceArtifacts, ...timezoneAuthority } = timezone(orgId);
      return {
        timezoneAuthority,
        check: {
          ConditionCheck: {
            TableName: "test",
            Key: { PK: { S: "opaque-timezone-check" } },
            ConditionExpression: "#version = :v",
            ExpressionAttributeNames: { "#version": "version" },
            ExpressionAttributeValues: { ":v": { N: "1" } },
          },
        },
      };
    });
}
export function withIssuedAuthority<T extends SalesIssuedInvoice>(
  invoice: T,
  orgId = "org-123",
): T &
  Pick<
    SalesIssuedInvoice,
    | "calculationBinding"
    | "issuanceAuthoritySnapshot"
    | "issuanceAuthorityDigest"
  > {
  const { evidenceArtifacts: _, ...sellerAuthority } = legal(orgId);
  const { evidenceArtifacts: __, ...timezoneAuthority } = timezone(orgId);
  const binding = calculationBinding(invoice.currency);
  const snapshot = {
    schemaVersion: 1 as const,
    orgId,
    documentType: "INVOICE" as const,
    documentId: invoice.id,
    issuedSourceVersion: invoice.version,
    issuedAt: invoice.issuedAt,
    issueDate: invoice.issueDate,
    issuanceEventReference: `INVOICE:${invoice.id}:${invoice.version}`,
    sellerAuthority,
    timezoneAuthority,
    calculationBinding: binding,
    capturedAt: invoice.issuedAt,
  };
  return {
    ...invoice,
    calculationBinding: binding,
    issuanceAuthoritySnapshot: snapshot,
    issuanceAuthorityDigest: authorityDigest(snapshot),
  };
}
export const opaqueChecks = () =>
  ["legal", "timezone"].map((name) => ({
    ConditionCheck: {
      TableName: "test",
      Key: { PK: { S: name } },
      ConditionExpression: "#v = :v",
      ExpressionAttributeNames: { "#v": "version" },
      ExpressionAttributeValues: { ":v": { N: "1" } },
    },
  }));
export function withCreditAuthority<
  T extends {
    id: string;
    currency: string;
    version: number;
    issueDate: string;
    issuedAt: string;
  },
>(
  note: T,
): T & {
  calculationBinding: ReturnType<typeof calculationBinding>;
  issuanceAuthoritySnapshot: ReturnType<
    typeof withIssuedAuthority
  >["issuanceAuthoritySnapshot"];
  issuanceAuthorityDigest: string;
} {
  const original = withIssuedAuthority({
    id: note.id,
    status: "ISSUED",
    currency: note.currency,
    version: note.version,
    issueDate: note.issueDate,
    issuedAt: note.issuedAt,
    invoiceNumber: "1",
    lines: [],
    lineCount: 0,
    subtotal: "0",
    taxTotal: "0",
    total: "0",
    createdAt: note.issuedAt,
    updatedAt: note.issuedAt,
  });
  const snapshot = {
    ...original.issuanceAuthoritySnapshot!,
    documentType: "CREDIT_NOTE" as const,
    originalSellerEvidenceReference: "SINV-1:" + "a".repeat(64),
    originalCalculationBindingReference: "SINV-1:" + "a".repeat(64),
  };
  return {
    ...note,
    calculationBinding: original.calculationBinding!,
    issuanceAuthoritySnapshot: snapshot,
    issuanceAuthorityDigest: authorityDigest(snapshot),
  };
}
