import type { SalesIssuedCreditNote } from "@liass-ohada/shared/sales";
import {
  buildSalesCreditNotePdfView,
  SalesCreditNotePdfRenderer,
} from "@/lambda/domains/sales/invoices/sales-credit-note-pdf-renderer";

const timestamp = "2026-09-10T10:00:00.000Z";
const creditNote: SalesIssuedCreditNote = {
  id: "SCN-1",
  originalInvoiceId: "SINV-1",
  originalInvoiceNumber: "00000042",
  status: "ISSUED",
  creditNoteNumber: "00000007",
  issueDate: "2026-09-10",
  issuedAt: timestamp,
  customerSnapshot: {
    name: "Société Élégance",
    billingAddress: { line1: "1 rue de l'Été", city: "Cotonou", country: "BJ" },
  },
  currency: "EUR",
  reason: "Retour d'un article défectueux",
  lines: [{
    id: "SCL-1",
    originalInvoiceLineId: "SIL-1",
    position: 1,
    description: "Prestation déjà facturée",
    quantity: "0.125",
    unitPrice: "123456789.99",
    taxRate: "18.5",
    subtotal: "15432098.765",
    taxAmount: "2854938.271525",
    total: "18287037.036525",
    createdAt: timestamp,
    updatedAt: timestamp,
  }],
  subtotal: "15432098.765",
  taxTotal: "2854938.271525",
  total: "18287037.036525",
  lineCount: 1,
  version: 3,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe("SalesCreditNotePdfRenderer", () => {
  test("uses persisted facts and exact decimal strings without recalculation", async () => {
    const view = buildSalesCreditNotePdfView({
      issuer: { name: "Établissements Liass" },
      creditNote,
      renderingVersion: "1",
    });
    expect(view).toMatchObject({
      creditNoteNumber: "00000007",
      issueDate: "10/09/2026",
      originalInvoiceNumber: "00000042",
      reason: "Retour d'un article défectueux",
      customerName: "Société Élégance",
      subtotal: "15 432 098,765 EUR",
      taxTotal: "2 854 938,271525 EUR",
      total: "18 287 037,036525 EUR",
    });
    expect(view.lines[0]).toMatchObject({
      quantity: "0,125",
      unitPrice: "123 456 789,99 EUR",
      taxRate: "18,5 %",
      taxAmount: "2 854 938,271525 EUR",
      total: "18 287 037,036525 EUR",
    });
    expect(JSON.stringify(view)).not.toContain("0.30000000000000004");
    const bytes = await SalesCreditNotePdfRenderer.render({
      issuer: { name: "Établissements Liass" },
      creditNote,
      renderingVersion: "1",
    });
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  test.each(["XOF", "XAF", "EUR", "USD"] as const)(
    "renders exact values in %s",
    async (currency) => {
      const candidate = { ...creditNote, currency };
      const view = buildSalesCreditNotePdfView({
        issuer: { name: "Liass" },
        creditNote: candidate,
        renderingVersion: "1",
      });
      expect(view.total).toBe(`18 287 037,036525 ${currency}`);
    },
  );

  test("supports customerless, unitless, long, multi-page content byte-stably", async () => {
    const line = { ...creditNote.lines[0], unit: undefined };
    const candidate: SalesIssuedCreditNote = {
      ...creditNote,
      customerSnapshot: undefined,
      reason: "Motif accentué. ".repeat(20),
      lines: Array.from({ length: 100 }, (_, index) => ({
        ...line,
        id: `SCL-${index}`,
        originalInvoiceLineId: `SIL-${index}`,
        position: index + 1,
        description: index === 0
          ? `Description très longue ${index} `.repeat(8)
          : `Ligne créditée ${index}`,
      })),
      lineCount: 100,
    };
    const input = { issuer: { name: "Liass" }, creditNote: candidate, renderingVersion: "1" };
    expect(buildSalesCreditNotePdfView(input).customerName).toBe("Client non renseigné");
    expect(buildSalesCreditNotePdfView(input).lines[0].unit).toBe("-");
    const [first, second] = await Promise.all([
      SalesCreditNotePdfRenderer.render(input),
      SalesCreditNotePdfRenderer.render(input),
    ]);
    expect(second.equals(first)).toBe(true);
    expect(first.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(1);
  });
});
