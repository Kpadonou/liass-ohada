import type { SalesIssuedInvoice } from "@liass-ohada/shared/sales";
import {
  buildSalesInvoicePdfView,
  formatExactMoney,
  SalesInvoicePdfRenderer,
} from "@/lambda/domains/sales/invoices/sales-invoice-pdf-renderer";

const timestamp = "2026-09-10T10:00:00.000Z";
const invoice: SalesIssuedInvoice = {
  id: "SINV-1",
  status: "ISSUED",
  invoiceNumber: "00000042",
  issueDate: "2026-09-10",
  issuedAt: timestamp,
  currency: "EUR",
  customerId: "SC-1",
  customerSnapshot: {
    name: "Société Côte d’Ivoire",
    billingAddress: { line1: "1 avenue des Établissements", country: "CI" },
  },
  lines: [{
    id: "SIL-1",
    position: 1,
    description: "Étude détaillée et accompagnement professionnel ".repeat(8),
    quantity: "1.5",
    unitPrice: "0.2",
    taxRate: "18",
    subtotal: "0.3",
    taxAmount: "0.054",
    total: "0.354",
    createdAt: timestamp,
    updatedAt: timestamp,
  }],
  subtotal: "0.3",
  taxTotal: "0.054",
  total: "0.354",
  lineCount: 1,
  version: 2,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe("SalesInvoicePdfRenderer", () => {
  test("builds a valid PDF from persisted Invoice facts and French labels", async () => {
    const bytes = await SalesInvoicePdfRenderer.render({
      issuer: { name: "Établissements Liass" },
      invoice,
      renderingVersion: "1",
    });
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1_000);

    const view = buildSalesInvoicePdfView({
      issuer: { name: "Établissements Liass" },
      invoice,
      renderingVersion: "1",
    });
    expect(view).toMatchObject({
      invoiceNumber: "00000042",
      issueDate: "10/09/2026",
      issuerName: "Établissements Liass",
      customerName: "Société Côte d’Ivoire",
      currency: "EUR",
      subtotal: "0,3 EUR",
      taxTotal: "0,054 EUR",
      total: "0,354 EUR",
    });
    expect(view.lines[0]).toMatchObject({
      unit: "-",
      quantity: "1,5",
      unitPrice: "0,2 EUR",
      taxRate: "18 %",
      total: "0,354 EUR",
    });
    expect(JSON.stringify(view)).not.toContain("0.30000000000000004");
  });

  test.each([
    ["100000000000000000", "XOF", "100 000 000 000 000 000 XOF"],
    ["25000", "XAF", "25 000 XAF"],
    ["1234.50", "EUR", "1 234,50 EUR"],
    ["0.0001", "USD", "0,0001 USD"],
  ])("formats %s %s without Number conversion", (value, currency, expected) => {
    expect(formatExactMoney(value, currency)).toBe(expected);
  });

  test("renders customerless Invoices with neutral wording", async () => {
    const customerless = { ...invoice, customerId: undefined, customerSnapshot: undefined };
    const view = buildSalesInvoicePdfView({
      issuer: { name: "Liass" },
      invoice: customerless,
      renderingVersion: "1",
    });
    expect(view.customerName).toBe("Client non renseigné");
    await expect(
      SalesInvoicePdfRenderer.render({
        issuer: { name: "Liass" },
        invoice: customerless,
        renderingVersion: "1",
      }),
    ).resolves.toEqual(expect.any(Buffer));
  });

  test("produces byte-stable output for the same issued facts and rendering version", async () => {
    const input = {
      issuer: { name: "Établissements Liass" },
      invoice,
      renderingVersion: "1",
    };
    const [first, second] = await Promise.all([
      SalesInvoicePdfRenderer.render(input),
      SalesInvoicePdfRenderer.render(input),
    ]);
    expect(second.equals(first)).toBe(true);
  });
});
