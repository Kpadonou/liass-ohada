import {
  formatSalesInvoiceNumber,
  nextSalesInvoiceSequence,
  parseSalesInvoiceSequence,
} from "@/lambda/domains/sales/invoices/sales-invoice-number";

describe("SALES commercial Invoice numbering", () => {
  test.each([
    ["1", "00000001"],
    ["42", "00000042"],
    ["99999999", "99999999"],
    ["123456789", "123456789"],
  ])("formats %s without truncation", (value, expected) => {
    expect(formatSalesInvoiceNumber(value)).toBe(expected);
  });

  test("increments beyond JavaScript Number precision using BigInt", () => {
    expect(nextSalesInvoiceSequence("9007199254740993123456789"))
      .toBe("9007199254740993123456790");
  });

  test.each(["-1", "+1", "1.5", "1e3", "01", ""])(
    "rejects non-canonical sequence %s",
    (value) => expect(() => parseSalesInvoiceSequence(value)).toThrow(),
  );

  test("does not format zero as an issued number", () => {
    expect(() => formatSalesInvoiceNumber("0")).toThrow();
  });
});
