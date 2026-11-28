import { specificTaxObservation } from "@/lambda/domains/restaurants/fiscal-item-diagnostic";
import { BeninEMecefTestAdapter } from "@/lambda/domains/fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter";

const input = { environment: "TEST" as const, credential: "fixture-only" };
const base = { ifu: "fixture-ifu", type: "NA", items: [{ name: "fixture", price: 20000,
  quantity: 2, taxGroup: "B" }], payment: [{ name: "ESPECES", amount: 42360 }] };
const read = async (taxSpecific: unknown, include = true) => {
  const item = { ...base.items[0], ...(include ? { taxSpecific } : {}) };
  const transport = jest.fn(async () => ({ status: 200,
    body: JSON.stringify({ ...base, items: [item] }) }));
  const details = await new BeninEMecefTestAdapter({ transport })
    .getInvoiceForTestDiagnostic(input, "existing-uid");
  expect(transport).toHaveBeenCalledTimes(1);
  return specificTaxObservation(details);
};

test("NA GET retains full-line numeric specific tax", async () => {
  expect(await read(2000)).toMatchObject({ itemCount: 1,
    taxSpecific: { present: true, type: "number", value: 2000 }, price: 20000, quantity: 2 });
});
test("NA GET distinguishes missing and explicit null specific tax", async () => {
  expect((await read(undefined, false)).taxSpecific).toEqual({ present: false, type: "missing" });
  expect((await read(null)).taxSpecific).toEqual({ present: true, type: "null", value: null });
});
test("NA GET retains different numeric values as different evidence", async () => {
  expect((await read(1000)).taxSpecific).toEqual({ present: true, type: "number", value: 1000 });
});
test.each(["2000", true, { amount: 2000 }, 2000.5])(
  "NA GET rejects unexpected taxSpecific %p", async (value) => {
    await expect(read(value)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });
