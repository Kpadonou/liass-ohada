/**
 * D03/D05 review vectors only. The commercial and provider paths must not use
 * this candidate before approval of the price basis, currency scale and seller
 * regime authority.
 */
function exactTtcGroupB(grossXof: bigint) {
  if (grossXof <= 0n) throw new Error("POSITIVE_GROSS_REQUIRED");
  const netNumerator = grossXof * 100n;
  if (netNumerator % 118n !== 0n) throw new Error("FRACTIONAL_XOF_TAX_SPLIT");
  const netXof = netNumerator / 118n;
  return { netXof, taxXof: grossXof - netXof, grossXof };
}

test("candidate one-unit TTC pilot amount has an exact 18 percent VAT split", () => {
  const amounts = exactTtcGroupB(2360n);
  expect(amounts).toEqual({ netXof: 2000n, taxXof: 360n, grossXof: 2360n });
  expect(amounts.netXof + amounts.taxXof).toBe(amounts.grossXof);
  expect(amounts.netXof * 18n).toBe(amounts.taxXof * 100n);
});

test.each([2000n, 2359n, 2361n])(
  "candidate refuses TTC amount %s without an exact XOF split",
  (grossXof) => expect(() => exactTtcGroupB(grossXof)).toThrow("FRACTIONAL_XOF_TAX_SPLIT"),
);

test.each([0n, -2360n])(
  "candidate excludes zero and negative amounts: %s",
  (grossXof) => expect(() => exactTtcGroupB(grossXof)).toThrow("POSITIVE_GROSS_REQUIRED"),
);
