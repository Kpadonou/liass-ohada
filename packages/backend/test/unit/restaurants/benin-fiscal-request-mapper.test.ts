import {
  mapRestaurantBeninRequest,
  restaurantBeninPreparation,
} from "@/lambda/domains/restaurants/benin-fiscal-request-mapper";
import { bindRestaurantIssuanceProvenance } from "@/lambda/domains/restaurants/issuance-provenance";
import { mapRestaurantFiscalLines } from "@/lambda/domains/restaurants/fiscal-line-mapper";
import { DurableBeninBinding } from "@/lambda/domains/fiscal-compliance/providers/benin-emecef/durable-benin-binding";
import { BeninEMecefTestAdapter } from "@/lambda/domains/fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter";
import {
  provenance,
  scope,
  id,
  line,
  digest,
  issuedAt,
} from "./provenance-fixture";
const { bindingDigest: _, ...original } = provenance;
const captured = bindRestaurantIssuanceProvenance({
  ...original,
  seller: {
    ...original.seller,
    seller: {
      name: "Synthetic seller",
      identifiers: [
        { scheme: "IFU", issuingCountry: "BJ", value: "synthetic-ifu" },
      ],
    },
    factStates: [
      ...original.seller.factStates,
      {
        fieldPath: "identifiers",
        state: "VERIFIED",
        evidenceReference: "synthetic-ifu-review",
      },
    ],
  },
});
const principal = { orgId: scope.orgId, actorId: "synthetic-actor" };
const identity = {
  orgId: scope.orgId,
  environment: "TEST" as const,
  sourceDomain: "restaurants",
  sourceDocumentType: "INVOICE",
  sourceDocumentId: id,
  jurisdiction: "BJ",
  obligation: "NORMALIZE",
};
const classification = {
  orderId: id,
  itemId: id,
  taxGroup: "B",
  classificationEvidence: "synthetic-item-review",
};
const preparation = () => ({
  schemaVersion: 1 as const,
  source: {
    ...scope,
    invoiceId: id,
    guestSessionId: id,
    sourceVersion: 1,
    financialRevision: 1,
  },
  commercialRootDigest: digest,
  issuedAt,
  provenance: captured,
  ...mapRestaurantFiscalLines({
    lines: [line],
    classifications: [classification],
  }),
  paidByMethodMinor: { CASH: 2000, MOBILE_MONEY: 0, CARD: 0 },
});
const configuration = () => ({
  environment: "TEST",
  invoiceType: "FV",
  priceBasis: "TTC",
  pricingEvidence: "synthetic-reviewed-price-policy",
  commercialMinorUnitsPerFranc: 1,
  taxGroups: ["B"],
  taxMetadataEvidence: "synthetic-metadata",
  operator: {
    actorId: principal.actorId,
    name: "Synthetic operator",
    evidence: "synthetic-operator",
  },
  payments: [
    {
      sourceMethod: "CASH",
      providerMethod: "ESPECES",
      evidence: "synthetic-payment-review",
    },
  ],
});
test("explicit mapping preserves exact amounts and is directly consumable by durable binding", async () => {
  const before = preparation();
  const result = mapRestaurantBeninRequest(
    before,
    principal,
    identity,
    configuration(),
  );
  const transport = jest.fn(async () => ({
    status: 200,
    body: JSON.stringify({ uid: "uid", total: 2000 }),
  }));
  const binding = new DurableBeninBinding(
    new BeninEMecefTestAdapter({ transport }),
    () => "synthetic-secret",
  );
  expect(await binding.createInvoice(result)).toMatchObject({
    reconciled: true,
    total: 2000,
  });
  expect(result.payload).toMatchObject({
    invoice: {
      ifu: "synthetic-ifu",
      type: "FV",
      reference: id,
      items: [{ price: 1000, quantity: 2, taxGroup: "B" }],
      payment: [{ name: "ESPECES", amount: 2000 }],
    },
    expected: { total: 2000, itemTotals: [2000] },
  });
  expect(before).toEqual(preparation());
});

test("mixed A/B fiscal groups are transmitted from frozen line mapping without a B fallback", () => {
  const secondId = "22222222-2222-4222-8222-222222222222";
  const second = { ...line, itemId: secondId, netAmountMinor: 1180,
    snapshot: { ...line.snapshot, name: "Taxable", quantity: 1, unitPriceMinor: 1180,
      grossMinor: 1180, subtotalMinor: 1000, taxMinor: 180, lineTotalMinor: 1180,
      fiscalTreatment: { country: "BJ", catalogGroup: "B", effectiveGroup: "B",
        regime: "ORDINARY_VAT", regimeRevision: id, policyId: "BJ-RESTO-TTC",
        policyVersion: 1, rateBasisPoints: 1800, rounding: "HALF_UP_LINE" } } };
  const first = { ...line, snapshot: { ...line.snapshot, fiscalTreatment: {
    country: "BJ", catalogGroup: "A", effectiveGroup: "A", regime: "ORDINARY_VAT",
    regimeRevision: id, policyId: "BJ-RESTO-TTC", policyVersion: 1,
    rateBasisPoints: 0, rounding: "HALF_UP_LINE" } } };
  const mapped = mapRestaurantFiscalLines({ lines: [first, second], classifications: [
    { orderId: id, itemId: id, taxGroup: "A", classificationEvidence: id },
    { orderId: id, itemId: secondId, taxGroup: "B", classificationEvidence: id },
  ] });
  const base = preparation();
  const prepared = { ...base, ...mapped, totalMinor: "3180",
    paidByMethodMinor: { CASH: 3180, MOBILE_MONEY: 0, CARD: 0 } };
  const result = mapRestaurantBeninRequest(prepared, principal, identity,
    { ...configuration(), taxGroups: ["A", "B"] });
  expect((result.payload as { invoice: { items: { taxGroup: string }[] } }).invoice.items.map((v) => v.taxGroup)).toEqual(["A", "B"]);
  expect(result.total).toBe(3180);
  expect(() => mapRestaurantBeninRequest(prepared, principal, identity, configuration())).toThrow("UNSUPPORTED_PROVIDER_TAX_GROUP");
});
test.each([
  { group: "A", catalog: "A", regime: "ORDINARY_VAT", rate: 0, net: 2000, tax: 0, evidence: undefined },
  { group: "D", catalog: "B", regime: "ORDINARY_VAT", rate: 1800, net: 1695, tax: 305, evidence: "EXCEPTION-REVIEW" },
  { group: "E", catalog: "E", regime: "TPS", rate: 0, net: 2000, tax: 0, evidence: undefined },
] as const)("frozen $group treatment reaches the DGI TEST request with exact net and VAT", (caseData) => {
  const treated = { ...line, snapshot: {
    ...line.snapshot,
    subtotalMinor: caseData.net,
    taxMinor: caseData.tax,
    fiscalTreatment: {
      country: "BJ", catalogGroup: caseData.catalog,
      effectiveGroup: caseData.group, regime: caseData.regime,
      regimeRevision: id, policyId: "BJ-RESTO-TTC", policyVersion: 1,
      rateBasisPoints: caseData.rate, rounding: "HALF_UP_LINE",
      ...(caseData.evidence ? { evidenceReference: caseData.evidence } : {}),
    },
  } };
  const mapped = mapRestaurantFiscalLines({ lines: [treated], classifications: [
    { orderId: id, itemId: id, taxGroup: caseData.group,
      classificationEvidence: caseData.evidence ?? id },
  ] });
  const result = mapRestaurantBeninRequest(
    { ...preparation(), ...mapped }, principal, identity,
    { ...configuration(), taxGroups: [caseData.group] },
  );
  expect((result.payload as { invoice: { items: { taxGroup: string }[] } }).invoice.items[0].taxGroup)
    .toBe(caseData.group);
  expect(result.fiscalGroupTotals?.[caseData.group]).toEqual({
    gross: 2000, net: caseData.net, tax: caseData.tax,
  });
});

test("export group C requires an export invoice type", () => {
  const exportLine = { ...line, snapshot: { ...line.snapshot,
    fiscalTreatment: { country: "BJ", catalogGroup: "B", effectiveGroup: "C",
      regime: "ORDINARY_VAT", regimeRevision: id, policyId: "BJ-RESTO-TTC",
      policyVersion: 1, rateBasisPoints: 0, rounding: "HALF_UP_LINE",
      evidenceReference: "EXPORT-CUSTOMS-1" } } };
  const mapped = mapRestaurantFiscalLines({ lines: [exportLine], classifications: [
    { orderId: id, itemId: id, taxGroup: "C", classificationEvidence: "EXPORT-CUSTOMS-1" },
  ] });
  const prepared = { ...preparation(), ...mapped };
  expect(() => mapRestaurantBeninRequest(prepared, principal, identity,
    { ...configuration(), taxGroups: ["C"] })).toThrow("UNSUPPORTED_EXPORT_TAX_COMBINATION");
  const exportRequest = mapRestaurantBeninRequest(prepared, principal, identity,
    { ...configuration(), invoiceType: "EV", taxGroups: ["C"] });
  expect((exportRequest.payload as { invoice: { type: string; items: { taxGroup: string }[] } }).invoice)
    .toMatchObject({ type: "EV", items: [{ taxGroup: "C" }] });
});
test.each(["A", "E"] as const)("export group %s follows the SFE matrix", (group) => {
  const fiscalLine = { ...line, snapshot: { ...line.snapshot,
    fiscalTreatment: { country: "BJ", catalogGroup: group, effectiveGroup: group,
      regime: group === "E" ? "TPS" : "ORDINARY_VAT", regimeRevision: id,
      policyId: "BJ-RESTO-TTC", policyVersion: 1, rateBasisPoints: 0,
      rounding: "HALF_UP_LINE" } } };
  const mapped = mapRestaurantFiscalLines({ lines: [fiscalLine], classifications: [
    { orderId: id, itemId: id, taxGroup: group, classificationEvidence: id },
  ] });
  const config = { ...configuration(), invoiceType: "EV", taxGroups: [group] };
  if (group === "A") {
    expect(() => mapRestaurantBeninRequest({ ...preparation(), ...mapped }, principal, identity, config))
      .toThrow("UNSUPPORTED_EXPORT_TAX_COMBINATION");
  } else {
    expect((mapRestaurantBeninRequest({ ...preparation(), ...mapped }, principal, identity, config)
      .payload as { invoice: { type: string; items: { taxGroup: string }[] } }).invoice)
      .toMatchObject({ type: "EV", items: [{ taxGroup: "E" }] });
  }
});
test("export A+C preserves both frozen fiscal classifications", () => {
  const secondId = "22222222-2222-4222-8222-222222222222";
  const first = { ...line, snapshot: { ...line.snapshot, fiscalTreatment: {
    country: "BJ", catalogGroup: "A", effectiveGroup: "A", regime: "ORDINARY_VAT",
    regimeRevision: id, policyId: "BJ-RESTO-TTC", policyVersion: 1,
    rateBasisPoints: 0, rounding: "HALF_UP_LINE" } } };
  const second = { ...line, itemId: secondId, snapshot: { ...line.snapshot,
    fiscalTreatment: { country: "BJ", catalogGroup: "B", effectiveGroup: "C",
      regime: "ORDINARY_VAT", regimeRevision: id, policyId: "BJ-RESTO-TTC",
      policyVersion: 1, rateBasisPoints: 0, rounding: "HALF_UP_LINE",
      evidenceReference: "EXPORT-CUSTOMS-1" } } };
  const mapped = mapRestaurantFiscalLines({ lines: [first, second], classifications: [
    { orderId: id, itemId: id, taxGroup: "A", classificationEvidence: id },
    { orderId: id, itemId: secondId, taxGroup: "C", classificationEvidence: "EXPORT-CUSTOMS-1" },
  ] });
  const prepared = { ...preparation(), ...mapped, paidByMethodMinor: {
    CASH: 4000, MOBILE_MONEY: 0, CARD: 0 } };
  const result = mapRestaurantBeninRequest(prepared, principal, identity,
    { ...configuration(), invoiceType: "EV", taxGroups: ["A", "C"] });
  expect((result.payload as { invoice: { items: { taxGroup: string }[] } }).invoice.items
    .map(v => v.taxGroup)).toEqual(["A", "C"]);
});
test.each([
  { priceBasis: "HT" },
  { pricingEvidence: "" },
  { taxGroups: ["Z"] },
  { taxGroups: ["A"] },
  { taxGroups: ["B", "B"] },
  { invoiceType: "FA" },
  { commercialMinorUnitsPerFranc: 3 },
  { environment: "PRODUCTION" },
  { payments: [] },
  {
    payments: [
      {
        sourceMethod: "CARD",
        providerMethod: "CARTEBANCAIRE",
        evidence: "review",
      },
    ],
  },
])("rejects unsupported or unevidenced provider mapping %j", (change) => {
  expect(() =>
    mapRestaurantBeninRequest(preparation(), principal, identity, {
      ...configuration(),
      ...change,
    }),
  ).toThrow();
});
test("rejects absent verified seller IFU, payment mismatch, commercial mismatch and foreign context", () => {
  expect(() =>
    mapRestaurantBeninRequest(
      { ...preparation(), provenance },
      principal,
      identity,
      configuration(),
    ),
  ).toThrow("FISCAL_SELLER_IFU_UNVERIFIED");
  expect(() =>
    mapRestaurantBeninRequest(
      {
        ...preparation(),
        paidByMethodMinor: { CASH: 1999, CARD: 0, MOBILE_MONEY: 0 },
      },
      principal,
      identity,
      configuration(),
    ),
  ).toThrow("FISCAL_MAPPING_AMOUNT_MISMATCH");
  expect(() =>
    mapRestaurantBeninRequest(
      { ...preparation(), totalMinor: "1999" },
      principal,
      identity,
      configuration(),
    ),
  ).toThrow("FISCAL_MAPPING_AMOUNT_MISMATCH");
  expect(() =>
    mapRestaurantBeninRequest(
      preparation(),
      { ...principal, orgId: "foreign" },
      identity,
      configuration(),
    ),
  ).toThrow("FISCAL_MAPPING_SCOPE_DENIED");
});
test("accepts the canonical leaf-level verification of the selected IFU only", () => {
  const value = preparation();
  const { bindingDigest: _, ...payload } = value.provenance;
  value.provenance = bindRestaurantIssuanceProvenance({
    ...payload,
    seller: {
      ...payload.seller,
      factStates: payload.seller.factStates
        .filter((fact) => fact.fieldPath !== "identifiers")
        .concat(
          ["scheme", "issuingCountry", "value"].map((fieldPath) => ({
            fieldPath: `identifiers.0.${fieldPath}`,
            state: "VERIFIED" as const,
            evidenceReference: `synthetic-${fieldPath}-review`,
          })),
        ),
    },
  });
  expect(
    mapRestaurantBeninRequest(value, principal, identity, configuration())
      .payload,
  ).toMatchObject({ invoice: { ifu: "synthetic-ifu" } });

  const { bindingDigest: __, ...incomplete } = value.provenance;
  value.provenance = bindRestaurantIssuanceProvenance({
    ...incomplete,
    seller: {
      ...incomplete.seller,
      factStates: incomplete.seller.factStates.filter(
        (fact) => fact.fieldPath !== "identifiers.0.value",
      ),
    },
  });
  expect(() =>
    mapRestaurantBeninRequest(value, principal, identity, configuration()),
  ).toThrow("FISCAL_SELLER_IFU_UNVERIFIED");
});
test("factory consumes verified FINAL preparation and explicit classifications", async () => {
  const prepare = jest.fn(async () => ({
    ready: true as const,
    preparation: preparation(),
  }));
  const result = await restaurantBeninPreparation(
    scope.outletId,
    id,
    [classification],
    configuration(),
    prepare,
  )(principal, identity);
  expect(result.total).toBe(2000);
  expect(prepare).toHaveBeenCalledWith({
    scope,
    actorId: principal.actorId,
    sessionId: id,
    invoiceId: id,
    classifications: [classification],
  });
});
test("real TEST preparation requests compatibility mode while accepting frozen classified lines", async () => {
  Object.assign(process.env, {
    STAGE: "dev",
    FISCAL_EXECUTION_MODE: "REAL_TEST",
    FISCAL_REAL_TEST_ENABLED: "1",
  });
  try {
    const value = preparation();
    const { bindingDigest: _, ...source } = value.provenance;
    value.provenance = bindRestaurantIssuanceProvenance({
      ...source,
      evidenceOrigin: "AUTHENTIC",
    });
    const prepare = jest.fn(async () => ({ ready: true as const, preparation: value }));
    const result = await restaurantBeninPreparation(
      scope.outletId, id, [classification], configuration(), prepare,
    )(principal, identity);
    expect(result.total).toBe(2000);
    expect(prepare).toHaveBeenCalledWith({
      scope,
      actorId: principal.actorId,
      sessionId: id,
      invoiceId: id,
      classifications: [classification],
      requireV1: true,
    });
  } finally {
    delete process.env.STAGE;
    delete process.env.FISCAL_EXECUTION_MODE;
    delete process.env.FISCAL_REAL_TEST_ENABLED;
  }
});

test("missing per-line evidence and changed source revisions fail closed", () => {
  const p = preparation();
  expect(() =>
    mapRestaurantBeninRequest(
      {
        ...p,
        lines: p.lines.map((v) => ({
          ...v,
          fiscal: { ...v.fiscal, classificationEvidence: "" },
        })),
      },
      principal,
      identity,
      configuration(),
    ),
  ).toThrow();
  expect(() =>
    mapRestaurantBeninRequest(
      { ...p, source: { ...p.source, sourceVersion: 2 } },
      principal,
      identity,
      configuration(),
    ),
  ).toThrow("FISCAL_MAPPING_SOURCE_MISMATCH");
});

test.each([undefined, "SYNTHETIC", "AUTHENTIC"] as const)(
  "real mapping requires authentic origin: %s",
  (origin) => {
    Object.assign(process.env, {
      FISCAL_EXECUTION_MODE: "REAL_TEST",
      FISCAL_REAL_TEST_ENABLED: "1",
      STAGE: "dev",
    });
    try {
      const value = preparation();
      const { bindingDigest: _, ...payload } = value.provenance;
      value.provenance = bindRestaurantIssuanceProvenance({
        ...payload,
        ...(origin ? { evidenceOrigin: origin } : {}),
      });
      const run = () =>
        mapRestaurantBeninRequest(value, principal, identity, configuration());
      if (origin === "AUTHENTIC") expect(run().sourceDigest).toBe(digest);
      else expect(run).toThrow("FISCAL_AUTHENTIC_PROVENANCE_REQUIRED");
    } finally {
      delete process.env.FISCAL_EXECUTION_MODE;
      delete process.env.FISCAL_REAL_TEST_ENABLED;
      delete process.env.STAGE;
    }
  },
);
