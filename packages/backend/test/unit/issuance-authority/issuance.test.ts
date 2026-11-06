import { SalesInvoiceService } from "@/lambda/domains/sales/invoices/sales-invoice-service";
import {
  SalesInvoiceRepository,
  SalesInvoiceIssueTransactionError,
} from "@/lambda/domains/sales/invoices/sales-invoice-repository";
import { OrganizationLegalIdentityService } from "@/lambda/shared/services/organization-legal-identity-service";
import { SalesTimezoneService } from "@/lambda/domains/sales/authority/sales-timezone-service";
import {
  SalesIssuanceAuthorityService,
  verifyIssuedAuthority,
  authorityDigest,
} from "@/lambda/domains/sales/authority/sales-issuance-authority-service";
import { calculationBinding } from "@/lambda/domains/sales/authority/commercial-policy";
import { SalesInvoiceSchema } from "@liass-ohada/shared/sales";
import { mockAuthorities, withIssuedAuthority } from "./fixtures";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const timestamp = "2026-11-04T12:00:00.000Z";
const draft = () =>
  SalesInvoiceSchema.parse({
    id: "SINV-1",
    status: "DRAFT",
    currency: "EUR",
    calculationBinding: calculationBinding("EUR"),
    lines: [
      {
        id: "line",
        position: 1,
        description: "Synthetic",
        quantity: "1",
        unitPrice: "10",
        taxRate: "0",
        subtotal: "10",
        taxAmount: "0",
        total: "10",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    subtotal: "10",
    taxTotal: "0",
    total: "10",
    lineCount: 1,
    version: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
const request = {
  expectedVersion: 2,
  clientRequestId: "22222222-2222-4222-8222-222222222222",
  issueDate: "2026-10-01",
};
beforeEach(() => {
  jest.restoreAllMocks();
  mockAuthorities();
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(SalesInvoiceRepository, "get").mockResolvedValue(draft());
  jest
    .spyOn(SalesInvoiceRepository, "getIssueIdempotency")
    .mockResolvedValue(undefined);
  jest
    .spyOn(SalesInvoiceRepository, "getSequence")
    .mockResolvedValue({ exists: true, lastValue: "8" });
  jest.spyOn(SalesInvoiceRepository, "issueAtomically").mockResolvedValue();
});
test("issuance freezes authority/policy and backdated date; replay uses receipt and original evidence only", async () => {
  const issued = await SalesInvoiceService.issue(
    "org-123",
    "actor",
    "SINV-1",
    request,
  );
  expect(issued.status).toBe("ISSUED");
  if (issued.status !== "ISSUED") throw Error();
  expect(issued.issueDate).toBe("2026-10-01");
  expect(issued.issuanceAuthoritySnapshot).toMatchObject({
    orgId: "org-123",
    documentId: "SINV-1",
    issuedSourceVersion: 3,
    issueDate: "2026-10-01",
    sellerAuthority: { seller: { name: "Synthetic seller" } },
    timezoneAuthority: { timezone: "Africa/Porto-Novo" },
    calculationBinding: calculationBinding("EUR"),
  });
  expect(issued.issuanceAuthoritySnapshot!.capturedAt).toBe(issued.issuedAt);
  verifyIssuedAuthority(issued, "org-123");
  const saved = structuredClone(issued);
  jest.mocked(SalesInvoiceRepository.get).mockResolvedValue(issued);
  jest.mocked(SalesInvoiceRepository.getIssueIdempotency).mockResolvedValue({
    entityType: "SALES_INVOICE_ISSUE_IDEMPOTENCY",
    orgId: "org-123",
    clientRequestId: request.clientRequestId,
    invoiceId: issued.id,
    issueDate: issued.issueDate,
    invoiceNumber: issued.invoiceNumber,
    originalExpectedVersion: 2,
    createdAt: issued.issuedAt,
    issuanceAuthorityDigest: issued.issuanceAuthorityDigest,
    PK: "test",
    SK: "test",
  });
  jest
    .mocked(OrganizationLegalIdentityService.readSellerIssuanceAuthority)
    .mockRejectedValue(Error("authority changed"));
  jest
    .mocked(SalesTimezoneService.readIssuanceAuthority)
    .mockRejectedValue(Error("timezone changed"));
  const replay = await SalesInvoiceService.issue(
    "org-123",
    "actor",
    "SINV-1",
    request,
  );
  expect(replay).toEqual(saved);
  expect(
    OrganizationLegalIdentityService.readSellerIssuanceAuthority,
  ).toHaveBeenCalledTimes(1);
  expect(SalesInvoiceRepository.issueAtomically).toHaveBeenCalledTimes(1);
  const receipt = await SalesInvoiceRepository.getIssueIdempotency(
    "org-123",
    request.clientRequestId,
  );
  jest
    .mocked(SalesInvoiceRepository.getIssueIdempotency)
    .mockResolvedValue({ ...receipt!, issuanceAuthorityDigest: undefined });
  await expect(
    SalesInvoiceService.issue("org-123", "actor", "SINV-1", request),
  ).rejects.toMatchObject({
    messageCode: "SALES_INVOICE_IDEMPOTENCY_INTEGRITY_ERROR",
  });
});
test("authority conflict is not sequence contention and cannot silently recapture another authority", async () => {
  jest
    .mocked(SalesInvoiceRepository.issueAtomically)
    .mockRejectedValue(
      new SalesInvoiceIssueTransactionError("AUTHORITY_CONFLICT"),
    );
  await expect(
    SalesInvoiceService.issue("org-123", "actor", "SINV-1", request),
  ).rejects.toThrow();
  expect(
    OrganizationLegalIdentityService.readSellerIssuanceAuthority,
  ).toHaveBeenCalledTimes(1);
  expect(SalesInvoiceRepository.issueAtomically).toHaveBeenCalledTimes(1);
});
test("legacy draft read does not stamp a policy and cannot issue or calculate without explicit transition", async () => {
  const { calculationBinding: _, ...legacy } = draft();
  jest.mocked(SalesInvoiceRepository.get).mockResolvedValue(legacy);
  const read = await SalesInvoiceService.get("org-123", "SINV-1");
  expect(read).not.toHaveProperty("calculationBinding");
  await expect(
    SalesInvoiceService.issue("org-123", "actor", "SINV-1", request),
  ).rejects.toThrow();
  expect(SalesInvoiceRepository.issueAtomically).not.toHaveBeenCalled();
});
test("legacy issued sources remain unmodified and ineligible; tampered receipts/snapshots fail integrity", () => {
  const legacy = {
    ...draft(),
    status: "ISSUED" as const,
    invoiceNumber: "1",
    issueDate: request.issueDate,
    issuedAt: timestamp,
  };
  expect(() => verifyIssuedAuthority(legacy, "org-123")).toThrow();
  const bound = withIssuedAuthority(legacy);
  expect(() =>
    verifyIssuedAuthority(
      { ...bound, issuanceAuthorityDigest: "a".repeat(64) },
      "org-123",
    ),
  ).toThrow();
  expect(() =>
    verifyIssuedAuthority(
      {
        ...bound,
        issuanceAuthoritySnapshot: {
          ...bound.issuanceAuthoritySnapshot!,
          issueDate: "2026-11-02",
        },
      },
      "org-123",
    ),
  ).toThrow();
  expect(() => verifyIssuedAuthority(bound, "other-org")).toThrow();
  expect(legacy).not.toHaveProperty("issuanceAuthoritySnapshot");
});
test("credit gets its own publication evidence, preserves original references and rejects entity/policy discontinuity", async () => {
  const original = withIssuedAuthority({
    ...draft(),
    status: "ISSUED",
    invoiceNumber: "1",
    issueDate: request.issueDate,
    issuedAt: timestamp,
  });
  const input = {
    orgId: "org-123",
    documentType: "CREDIT_NOTE" as const,
    documentId: "SCN-1",
    issuedSourceVersion: 2,
    issuedAt: "2026-11-05T12:00:00.000Z",
    issueDate: "2026-11-05",
    currency: "EUR",
    calculationBinding: calculationBinding("EUR"),
    original,
  };
  const c = await SalesIssuanceAuthorityService.capture(input);
  expect(c.issuanceAuthoritySnapshot.originalSellerEvidenceReference).toBe(
    `${original.id}:${original.issuanceAuthorityDigest}`,
  );
  expect(c.issuanceAuthoritySnapshot.issuedAt).not.toBe(original.issuedAt);
  const source =
    await OrganizationLegalIdentityService.readSellerIssuanceAuthority(
      "org-123",
    );
  jest
    .mocked(OrganizationLegalIdentityService.readSellerIssuanceAuthority)
    .mockResolvedValue({
      ...source,
      sellerAuthority: {
        ...source.sellerAuthority,
        legalEntityReference: "another-entity",
      },
    });
  await expect(
    SalesIssuanceAuthorityService.capture(input),
  ).rejects.toMatchObject({ messageCode: "SALES_CREDIT_AUTHORITY_CONTINUITY" });
  await expect(
    SalesIssuanceAuthorityService.capture({
      ...input,
      calculationBinding: calculationBinding("USD"),
    }),
  ).rejects.toThrow();
});
test("SALES authority boundary never imports Platform repository or provider implementation, and no key duplication", () => {
  const authority = resolve(
    __dirname,
    "../../../lambda/domains/sales/authority",
  );
  const files = readdirSync(authority)
    .filter((f) => f.endsWith(".ts") && f !== "iana-artifacts.ts")
    .map((f) => readFileSync(resolve(authority, f), "utf8"));
  for (const s of files) {
    expect(s).not.toMatch(
      /repositories\/organization|fiscal-compliance|EMECEF_TEST_TOKEN|EMECEF_TOKEN|developper\.impots\.bj|sygmef\.impots\.bj|PLATFORM_LEGAL_IDENTITY#/,
    );
  }
});
