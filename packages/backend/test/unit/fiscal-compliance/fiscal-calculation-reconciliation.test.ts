import { reconcileFiscalCalculations, type FiscalCalculationTotals } from
  "@/lambda/domains/fiscal-compliance/core/fiscal-calculation-reconciliation";

const base = (): FiscalCalculationTotals => ({
  ta: 0, tb: 18, tc: 0, td: 18, taa: 0, tab: 0, tac: 0, tad: 0,
  tae: 0, taf: 0, hab: 0, had: 0, vab: 0, vad: 0, aib: 0, ts: 0, total: 0,
});

test.each([
  ["01", { taa: 800, total: 800 }],
  ["02", { tab: 1000, hab: 847, vab: 153, total: 1000 }],
  ["03", { taa: 1600, tab: 3000, hab: 2542, vab: 458, total: 4600 }],
  ["04", { taa: 2000, tab: 7670, hab: 6500, vab: 1170, total: 9670 }],
] as const)("case %s retained DGI TEST totals compare exactly", (_id, values) => {
  const totals = { ...base(), ...values };
  expect(reconcileFiscalCalculations(totals, totals)).toEqual({
    status: "MATCH", phase: "CREATE", differences: [],
  });
});

test("records exact field-level differences, including absent F and rate fields", () => {
  const expected = { ...base(), tab: 7670, hab: 6500, vab: 1170, total: 9670 };
  const actual = { ...expected, hab: 6499, vab: 1171, tb: 17, taf: undefined };
  expect(reconcileFiscalCalculations(expected, actual)).toEqual({
    status: "MISMATCH", phase: "CREATE", differences: [
      { field: "tb", expected: 18, actual: 17 },
      { field: "taf", expected: 0, actual: null },
      { field: "hab", expected: 6500, actual: 6499 },
      { field: "vab", expected: 1170, actual: 1171 },
    ],
  });
});

test("checks C–F, both rate pairs, AIB, specific tax and invoice total independently", () => {
  const expected = { ...base(), tc: 12, td: 9, tac: 1200, tad: 900,
    tae: 500, taf: 300, had: 826, vad: 74, aib: 40, ts: 25, total: 2965 };
  const actual = { ...expected, tc: 11, td: 10, tac: 1201, tad: 899,
    tae: 501, taf: 299, had: 825, vad: 75, aib: 41, ts: 24, total: 2964 };
  expect(reconcileFiscalCalculations(expected, actual).differences.map(d => d.field)).toEqual([
    "tc", "td", "tac", "tad", "tae", "taf", "had", "vad", "aib", "ts", "total",
  ]);
});

test("rejects fractional provider totals instead of rounding or tolerating them", () => {
  const expected = { ...base(), total: 1000 };
  expect(() => reconcileFiscalCalculations(expected, { ...expected, total: 999.5 }))
    .toThrow();
});
