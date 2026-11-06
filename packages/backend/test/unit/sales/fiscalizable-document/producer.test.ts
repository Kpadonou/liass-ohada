import { SalesFiscalizableDocumentProducer as Producer } from "@/lambda/domains/sales/references/sales-fiscalizable-document-producer";
import { OrganizationLegalIdentityService as Legal } from "@/lambda/shared/services/organization-legal-identity-service";
import { SalesTimezoneService as Timezone } from "@/lambda/domains/sales/authority/sales-timezone-service";
import { SalesCustomerService as Customers } from "@/lambda/domains/sales/customers/sales-customer-service";
import { SalesCatalogItemService as Catalog } from "@/lambda/domains/sales/catalog/sales-catalog-item-service";
import { SalesInvoiceCalculator } from "@/lambda/domains/sales/invoices/sales-invoice-calculator";
import { clean, canonical } from "@/lambda/shared/authority/integrity";
import {
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { id } from "../../issuance-authority/fixtures";
import {
  installStore,
  realSources,
  persistedSize,
  orgId,
  sdk,
} from "./real-source";
let sources: Awaited<ReturnType<typeof realSources>>;
const inspect = (
  source: unknown,
  documentType: "INVOICE" | "CREDIT_NOTE" = "INVOICE",
  originalInvoice: unknown = sources.mixed,
) => Producer.inspect({ orgId, source, documentType, originalInvoice });
beforeAll(async () => {
  installStore();
  sources = await realSources();
});
afterAll(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  sdk.restore();
});
test.each(["simple", "mixed", "credit"] as const)(
  "%s: actual service/calculator/repository issuance consumes D01–D03 and stops at D04",
  (name) => {
    const source = sources[name];
    const before = clean(source);
    const result = inspect(
      source,
      name === "credit" ? "CREDIT_NOTE" : "INVOICE",
    );
    expect(result.status).toBe("BLOCKED_BY_D04");
    if (result.status !== "BLOCKED_BY_D04") throw Error(result.reason);
    expect(result.frozenCommercialSource).toEqual(before);
    expect(result).not.toHaveProperty("document");
    expect(result).not.toHaveProperty("snapshotDigest");
    expect(
      source.issuanceAuthoritySnapshot?.sellerAuthority.identityReference,
    ).toBe(id);
    expect(source.issuanceAuthoritySnapshot?.timezoneAuthority.timezone).toBe(
      "Africa/Porto-Novo",
    );
    expect(source.calculationBinding?.policyId).toBe(
      "LIASS-SALES-LINE-HT-HALFUP",
    );
    expect(source.calculationBinding?.currencyRegistryId).toBe(
      "LIASS-SALES-CURRENCY-COMPAT-2026-11-04",
    );
    expect(persistedSize(source.id)).toBeLessThan(358400);
    const minor = (v: string) =>
      SalesInvoiceCalculator.toMinorUnits(
        source.currency,
        v,
        source.calculationBinding,
      );
    expect(result.persistedAmountsMinor).toEqual({
      net: minor(source.subtotal),
      tax: minor(source.taxTotal),
      total: minor(source.total),
    });
    expect(
      inspect(source, name === "credit" ? "CREDIT_NOTE" : "INVOICE"),
    ).toEqual(result);
    expect(source).toEqual(before);
  },
);
test("real mixed source preserves fractional economics, zero/non-zero commercial rates, customer and product/service descriptions with Unicode", () => {
  expect(sources.mixed.lines.map((l) => l.taxRate)).toEqual(["18", "0"]);
  expect(sources.mixed.lines.map((l) => l.quantity)).toEqual(["2", "1.25"]);
  expect(sources.mixed.customerSnapshot?.name).toBe(sources.customer.name);
  expect(sources.mixed.lines.map((l) => l.description)).toEqual([
    sources.product.name,
    sources.service.name,
  ]);
  // PRODUCT/SERVICE is input catalogue context, not frozen fiscal lineKind evidence.
  expect(sources.mixed.lines[1]).not.toHaveProperty("itemType");
  expect(sources.mixed).toMatchObject({
    subtotal: "33.68",
    taxTotal: "4.44",
    total: "38.12",
  });
});
test("real issued partial credit retains positive magnitude, original identity, own event and bound continuity", () => {
  expect(sources.credit.total).toBe("14.56");
  expect(sources.credit.lines[0].quantity).toBe("1");
  expect(sources.credit.originalInvoiceId).toBe(sources.mixed.id);
  expect(sources.credit.reason).toBe("Synthetic partial credit");
  expect(sources.credit.issuanceAuthoritySnapshot?.documentId).toBe(
    sources.credit.id,
  );
  expect(
    sources.credit.issuanceAuthoritySnapshot?.originalSellerEvidenceReference,
  ).toBe(`${sources.mixed.id}:${sources.mixed.issuanceAuthorityDigest}`);
  expect(sources.credit.calculationBinding).toEqual(
    sources.mixed.calculationBinding,
  );
});
test.each(["simpleDraft", "creditDraft"] as const)(
  "%s is ineligible",
  (name) => {
    expect(
      inspect(
        sources[name],
        name === "creditDraft" ? "CREDIT_NOTE" : "INVOICE",
      ),
    ).toMatchObject({ status: "INELIGIBLE", reason: "DRAFT_SOURCE" });
  },
);
const cases: Array<[string, string, unknown]> = [
  ["historical without D01–D03", "issuanceAuthoritySnapshot", undefined],
  ["missing policy binding", "calculationBinding", undefined],
  ["tampered authority digest", "issuanceAuthorityDigest", "a".repeat(64)],
  [
    "mismatched policy artifact",
    "calculationBinding.definitionBytesDigest",
    "a".repeat(64),
  ],
  [
    "missing seller authority",
    "issuanceAuthoritySnapshot.sellerAuthority",
    undefined,
  ],
  [
    "unverified seller",
    "issuanceAuthoritySnapshot.sellerAuthority.subjectBindingState",
    "PRESENT",
  ],
  [
    "stale seller/source binding",
    "issuanceAuthoritySnapshot.issuedSourceVersion",
    999,
  ],
  [
    "missing timezone",
    "issuanceAuthoritySnapshot.timezoneAuthority",
    undefined,
  ],
  [
    "invalid timezone",
    "issuanceAuthoritySnapshot.timezoneAuthority.timezone",
    "Invalid/Timezone",
  ],
  [
    "unapproved timezone",
    "issuanceAuthoritySnapshot.timezoneAuthority.approvalReference",
    "unapproved",
  ],
  ["unsupported currency", "currency", "ZZZ"],
  ["unapproved policy", "calculationBinding.policyVersion", "999"],
  ["unapproved registry", "calculationBinding.currencyRegistryVersion", "999"],
  [
    "tampered registry digest",
    "calculationBinding.currencyRegistryDigest",
    "a".repeat(64),
  ],
  ["withholding", "withholding", "1"],
  ["unallocated adjustment", "documentAdjustment", "1"],
  ["arbitrary negative line", "lines.0.unitPrice", "-1"],
  ["negative quantity", "lines.0.quantity", "-1"],
  ["invalid source position", "lines.0.position", 1000],
  ["unbound source totals mutation", "total", "999"],
  ["unbound source line arithmetic mutation", "lines.0.total", "999"],
  ["oversized source", "lines.0.description", "x".repeat(358401)],
];
function change(source: unknown, path: string, value: unknown) {
  const keys = path.split(".");
  let parent = source as Record<string, unknown>;
  for (const key of keys.slice(0, -1))
    parent = parent[key] as Record<string, unknown>;
  if (value === undefined) delete parent[keys[keys.length - 1]];
  else parent[keys[keys.length - 1]] = value;
}
test.each(cases)(
  "deny %s without target artifact or raw details",
  (_name, path, value) => {
    const source = clean(sources.simple);
    change(source, path, value);
    const result = inspect(source);
    expect(result.status).toBe("INELIGIBLE");
    expect(Object.keys(result).sort()).toEqual(["reason", "status"]);
  },
);
test("zero-price source cannot infer free-item justification", () => {
  const source = clean(sources.simple);
  Object.assign(source.lines[0], {
    unitPrice: "0",
    subtotal: "0",
    taxAmount: "0",
    total: "0",
  });
  Object.assign(source, { subtotal: "0", taxTotal: "0", total: "0" });
  expect(inspect(source)).toMatchObject({
    status: "INELIGIBLE",
    reason: "ZERO_PRICE_JUSTIFICATION_AND_TREATMENT_MISSING",
  });
});
test("unknown tax classification blocks both zero and nonzero rates; compatibility currency scale is not fiscal approval", () => {
  for (const source of [sources.simple, sources.mixed]) {
    const result = inspect(source);
    expect(result).toMatchObject({
      status: "BLOCKED_BY_D04",
      fiscalCurrencyReadiness:
        "NOT_ESTABLISHED_BY_COMMERCIAL_COMPATIBILITY_POLICY",
    });
    expect(result).not.toHaveProperty("fiscalTreatment");
  }
});
test("credit with absent/wrong original or mismatched frozen continuity rejects", () => {
  expect(inspect(sources.credit, "CREDIT_NOTE", {}).status).toBe("INELIGIBLE");
  const wrong = clean(sources.mixed);
  wrong.invoiceNumber = "different";
  expect(inspect(sources.credit, "CREDIT_NOTE", wrong).status).toBe(
    "INELIGIBLE",
  );
});
test("org B cannot consume org A evidence", () => {
  expect(
    Producer.inspect({
      orgId: "other-org",
      documentType: "INVOICE",
      source: sources.simple,
    }).status,
  ).toBe("INELIGIBLE");
});
test("changed frozen commercial content changes diagnostic bytes but never supplies a missing D04 source proof", () => {
  const first = inspect(sources.simple);
  const changed = clean(sources.simple);
  changed.lines[0].description = "Changed frozen content";
  const second = inspect(changed);
  expect(first.status).toBe("BLOCKED_BY_D04");
  expect(second.status).toBe("BLOCKED_BY_D04");
  if (first.status !== "BLOCKED_BY_D04" || second.status !== "BLOCKED_BY_D04")
    throw Error();
  expect(first.diagnosticSourceJsonSha256).not.toBe(
    second.diagnosticSourceJsonSha256,
  );
  expect(second).not.toHaveProperty("sourceProof");
});
test("capture reproducible sanitized source-only evidence; no invented fiscal bytes or oracle success", () => {
  const evidence = {
    evidenceVersion: 1,
    scope:
      "Actual SALES services/calculators/repositories; in-memory SDK transport; synthetic business input only. Not production usage or fiscal approval.",
    scenarios: (["simple", "mixed", "credit"] as const).map((name) => {
      const source = clean(sources[name]);
      const result = inspect(
        source,
        name === "credit" ? "CREDIT_NOTE" : "INVOICE",
      );
      return {
        scenarioId: name,
        sourceType: name === "credit" ? "SalesCreditNote" : "SalesInvoice",
        sourceId: source.id,
        sourceVersion: source.version,
        persistedMarshalledJsonUtf8Bytes: persistedSize(source.id),
        result,
        completeFiscalArtifact: null,
        canonicalTargetBytes: null,
        targetDigest: null,
        jcsOracle: "BLOCKED_BY_D04 — no complete V1 artifact",
        expected: "BLOCKED_BY_D04",
        sanitization: "Synthetic identities, no customer PII or credentials",
      };
    }),
  };
  const path = resolve(
    __dirname,
    "../../../../docs/evidence/fiscalizable-document/sales-m2a-source-evidence-v1.json",
  );
  if (existsSync(path))
    expect(evidence).toEqual(JSON.parse(readFileSync(path, "utf8")));
  // Outside the repository: permits initial evidence capture without a production writer.
  writeFileSync(
    "/tmp/liass-m2a-source-evidence-v1.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  expect(canonical(evidence.scenarios[0].result)).toBeTruthy();
});
test("after live authority revocation and customer/catalog changes, inspection uses only already frozen source; never recalculates or hydrates", async () => {
  const invoiceBefore = inspect(sources.mixed);
  const creditBefore = inspect(sources.credit, "CREDIT_NOTE");
  await Customers.update(orgId, "reviewer", sources.customer.id, {
    expectedVersion: 1,
    name: "Changed live customer",
  });
  await Catalog.update(orgId, "reviewer", sources.product.id, {
    expectedVersion: 1,
    name: "Changed live item",
  });
  await Legal.disable(orgId, "reviewer", id, 1);
  await Timezone.disable(orgId, "reviewer", id, 1);
  const lookups = sdk.commandCalls(GetItemCommand).length;
  const writes = sdk.commandCalls(TransactWriteItemsCommand).length;
  const denyHydration = () => {
    throw Error("Live hydration forbidden after issuance");
  };
  const spies = [
    jest.spyOn(Customers, "get").mockImplementation(denyHydration),
    jest.spyOn(Catalog, "get").mockImplementation(denyHydration),
    jest
      .spyOn(Legal, "readSellerIssuanceAuthority")
      .mockImplementation(denyHydration),
    jest
      .spyOn(Timezone, "readIssuanceAuthority")
      .mockImplementation(denyHydration),
    jest
      .spyOn(SalesInvoiceCalculator, "calculateLine")
      .mockImplementation(denyHydration),
    jest.spyOn(Intl, "NumberFormat").mockImplementation(denyHydration),
  ];
  expect(inspect(sources.mixed)).toEqual(invoiceBefore);
  expect(inspect(sources.credit, "CREDIT_NOTE")).toEqual(creditBefore);
  for (const spy of spies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
  expect(sdk.commandCalls(GetItemCommand)).toHaveLength(lookups);
  expect(sdk.commandCalls(TransactWriteItemsCommand)).toHaveLength(writes);
});
