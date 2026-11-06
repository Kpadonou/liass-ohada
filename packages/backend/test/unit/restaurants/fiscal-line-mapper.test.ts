import { mapRestaurantFiscalLines } from "@/lambda/domains/restaurants/fiscal-line-mapper";

const id = "11111111-1111-4111-8111-111111111111";
const line = {
  orderId: id,
  itemId: id,
  netAmountMinor: 2000,
  snapshot: {
    menuItemId: id,
    menuId: id,
    categoryId: id,
    itemVersion: 1,
    categoryVersion: 1,
    menuVersion: 1,
    name: "Synthetic article",
    quantity: 2,
    unitPriceMinor: 1000,
    grossMinor: 2000,
    subtotalMinor: 2000,
    discountMinor: 0,
    taxMinor: 0,
    lineTotalMinor: 2000,
    currency: "XOF",
    acceptedAt: "2026-11-06T10:00:00Z",
    submissionId: id,
  },
};
const classification = {
  orderId: id,
  itemId: id,
  taxGroup: "A",
  classificationEvidence: "synthetic-review-1",
};
test.each(["A", "B", "C", "D", "E", "F"])(
  "preserves explicit group %s independently of zero commercial tax",
  (taxGroup) => {
    const original = structuredClone(line);
    const result = mapRestaurantFiscalLines({
      lines: [line],
      classifications: [{ ...classification, taxGroup }],
    });
    expect(result.totalMinor).toBe("2000");
    expect(result.lines[0].fiscal.taxGroup).toBe(taxGroup);
    expect(result.lines[0].commercial).toEqual(original);
    expect(line).toEqual(original);
    expect(result.providerMutationEnabled).toBe(false);
  },
);
test("rejects missing classification", () => {
  expect(() =>
    mapRestaurantFiscalLines({ lines: [line], classifications: [] }),
  ).toThrow("MISSING_FISCAL_CLASSIFICATION");
});
test.each([
  { taxGroup: "Z" },
  { classificationEvidence: " " },
  { taxSpecificMinor: "1" },
])("rejects unsupported or unevidenced classification %j", (change) => {
  expect(() =>
    mapRestaurantFiscalLines({
      lines: [line],
      classifications: [{ ...classification, ...change }],
    }),
  ).toThrow();
});
test("rejects duplicate classifications and inconsistent financial evidence", () => {
  expect(() =>
    mapRestaurantFiscalLines({
      lines: [line],
      classifications: [classification, classification],
    }),
  ).toThrow("AMBIGUOUS_FISCAL_CLASSIFICATION");
  expect(() =>
    mapRestaurantFiscalLines({
      lines: [{ ...line, netAmountMinor: 1999 }],
      classifications: [classification],
    }),
  ).toThrow("UNSUPPORTED_COMMERCIAL_LINE");
});
