import {
  calculationBinding,
  assertCalculationBinding,
  readCommercialRegistry,
  REGISTRY_DIGEST,
  DEFINITION_DIGEST,
  DEFINITION_FINGERPRINT,
} from "@/lambda/domains/sales/authority/commercial-policy";
import {
  registryBytes,
  policyBytes,
} from "@/lambda/domains/sales/authority/commercial-policy-artifacts";
import { SalesInvoiceCalculator as Calculator } from "@/lambda/domains/sales/invoices/sales-invoice-calculator";
import {
  canonical,
  hash,
  admission,
} from "@/lambda/shared/authority/integrity";
import { publicSalesResponse } from "@/lambda/domains/sales/invoices/public-sales-response";

test("exact approved artifact bytes, identities and commercial qualifications", () => {
  expect(hash(registryBytes)).toBe(REGISTRY_DIGEST);
  expect(Buffer.byteLength(registryBytes)).toBe(1297);
  expect(hash(policyBytes)).toBe(DEFINITION_DIGEST);
  const registry = readCommercialRegistry();
  expect(Object.keys(registry)).toHaveLength(162);
  expect([...new Set(Object.values(registry))].sort()).toEqual([0, 2, 3]);
  expect({ HUF: registry.HUF, IDR: registry.IDR, COP: registry.COP }).toEqual({
    HUF: 0,
    IDR: 0,
    COP: 0,
  });
  const binding = calculationBinding("EUR");
  expect(binding).toMatchObject({
    policyId: "LIASS-SALES-LINE-HT-HALFUP",
    policyVersion: "1",
    currencyRegistryId: "LIASS-SALES-CURRENCY-COMPAT-2026-11-04",
    currencyRegistryVersion: "1",
  });
  expect(
    hash(
      canonical({
        profile: "LIASS-FISCAL-C14N-1",
        version: 1,
        kind: "calculation-definition",
        payload: {
          policyId: binding.policyId,
          policyVersion: binding.policyVersion,
          definitionFormat: "LIASS-CALCULATION-SPEC-UTF8-1",
          definitionBytesDigest: DEFINITION_DIGEST,
          currencyRegistryDigest: REGISTRY_DIGEST,
        },
      }),
    ),
  ).toBe(DEFINITION_FINGERPRINT);
});
test.each([
  "policyId",
  "policyVersion",
  "currencyRegistryId",
  "currencyRegistryVersion",
  "currencyRegistryDigest",
  "definitionBytesDigest",
  "calculationDefinitionFingerprint",
  "approvalReference",
])("rejects mixed/tampered %s", (key) => {
  expect(() =>
    assertCalculationBinding(
      { ...calculationBinding("EUR"), [key]: "wrong" },
      "EUR",
    ),
  ).toThrow();
});
test("unknown currency, unavailable/tampered artifacts and currency mismatch reject", () => {
  expect(() => calculationBinding("ZZZ")).toThrow();
  expect(() => readCommercialRegistry("", policyBytes)).toThrow();
  expect(() =>
    readCommercialRegistry(registryBytes, policyBytes + "tampered"),
  ).toThrow();
  expect(() =>
    assertCalculationBinding(calculationBinding("EUR"), "USD"),
  ).toThrow();
});
test.each([
  ["XOF", "25", "5", "30"],
  ["EUR", "25.03", "4.51", "29.54"],
  ["USD", "25.03", "4.51", "29.54"],
  ["BHD", "25.025", "4.505", "29.53"],
])(
  "%s pinned arithmetic preserves commercial facts",
  (currency, subtotal, taxAmount, total) => {
    const line = Calculator.calculateLine(
      currency,
      {
        id: "line",
        position: 1,
        description: "Synthetic",
        quantity: "2.5",
        unitPrice: "10.01",
        taxRate: "18",
        createdAt: "2026-11-04T12:00:00.000Z",
        updatedAt: "2026-11-04T12:00:00.000Z",
      },
      calculationBinding(currency),
    );
    expect(line).toMatchObject({ subtotal, taxAmount, total });
    expect(
      Calculator.fromMinorUnits(
        currency,
        Calculator.toMinorUnits(currency, total, calculationBinding(currency)),
        calculationBinding(currency),
      ),
    ).toBe(total);
  },
);
test.each([
  ["XOF", "0.5", "1"],
  ["EUR", "0.005", "0.01"],
  ["BHD", "0.0005", "0.001"],
])("%s half-up tie and zero tax", (currency, unitPrice, total) => {
  const line = Calculator.calculateLine(
    currency,
    {
      id: "line",
      position: 1,
      description: "Synthetic",
      quantity: "1",
      unitPrice,
      taxRate: "0",
      createdAt: "2026-11-04T12:00:00.000Z",
      updatedAt: "2026-11-04T12:00:00.000Z",
    },
    calculationBinding(currency),
  );
  expect(line.total).toBe(total);
  expect(line.taxAmount).toBe("0");
});
test("pinned calculations do not call Intl, and public response removes private source authority", () => {
  const spy = jest.spyOn(Intl, "NumberFormat").mockImplementation(() => {
    throw Error("Intl unavailable");
  });
  try {
    expect(
      Calculator.toMinorUnits("EUR", "1.25", calculationBinding("EUR")),
    ).toBe("125");
  } finally {
    spy.mockRestore();
  }
  expect(
    publicSalesResponse({
      creditNote: {
        id: "id",
        calculationBinding: calculationBinding("EUR"),
        issuanceAuthoritySnapshot: { private: "data" },
        issuanceAuthorityDigest: "hash",
      },
    }),
  ).toEqual({ creditNote: { id: "id" } });
});
test("strict canonical inputs and serialized admission caps reject ambiguity/oversize", () => {
  for (const input of [null, undefined, 1.5, -0, NaN, "\ud800"]) {
    expect(() => canonical(input)).toThrow();
  }
  expect(() => admission({ proof: "x".repeat(4096) }, 4096)).toThrow();
});

test("authority canonicalization uses UTF-16 key order and rejects duplicate-aware raw evidence", () => {
  const { assertArtifact } =
    require("@/lambda/shared/authority/integrity") as typeof import("@/lambda/shared/authority/integrity");
  expect(
    canonical({
      דּ: "BMP",
      "😀": "supplementary",
      "€": "Euro",
      "1": "numeric-key",
      "\r": "control",
    }),
  ).toBe(
    '{"\\r":"control","1":"numeric-key","€":"Euro","😀":"supplementary","דּ":"BMP"}',
  );
  for (const bytes of [
    '{"a":1,"a":2}',
    '{"a":{"b":1,"b":2}}',
    '{"a":1,"\\u0061":2}',
  ])
    expect(() => assertArtifact({ bytes, digest: hash(bytes) })).toThrow();
});

test("source-bound receivable/credit arithmetic stays pinned when Intl is unavailable", () => {
  const { SalesReceivableCalculator } =
    require("@/lambda/domains/sales/invoices/sales-receivable-calculator") as typeof import("@/lambda/domains/sales/invoices/sales-receivable-calculator");
  const binding = calculationBinding("EUR");
  const spy = jest.spyOn(Intl, "NumberFormat").mockImplementation(() => {
    throw Error("unavailable");
  });
  try {
    const receivable = SalesReceivableCalculator.synthetic({
      invoiceId: "invoice",
      currency: "EUR",
      invoiceAmount: "10",
      timestamp: "2026-11-04T12:00:00.000Z",
      calculationBinding: binding,
    });
    expect(
      SalesReceivableCalculator.applyCredit(
        receivable,
        "2.5",
        "2026-11-04T12:00:00.000Z",
        binding,
      ).balanceDue,
    ).toBe("7.5");
  } finally {
    spy.mockRestore();
  }
});
