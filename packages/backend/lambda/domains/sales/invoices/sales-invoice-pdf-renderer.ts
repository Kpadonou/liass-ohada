import PDFDocument from "pdfkit";
import type { SalesIssuedInvoice } from "@liass-ohada/shared/sales";

export interface SalesInvoicePdfRenderInput {
  issuer: { name: string };
  invoice: SalesIssuedInvoice;
  renderingVersion: string;
}

export interface SalesInvoicePdfLineView {
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  subtotal: string;
  total: string;
}

export interface SalesInvoicePdfView {
  customerName: string;
  currency: string;
  invoiceNumber: string;
  issueDate: string;
  issuerName: string;
  lines: SalesInvoicePdfLineView[];
  subtotal: string;
  taxTotal: string;
  total: string;
}

const formatExactDecimal = (value: string): string => {
  const [integer, fraction] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return fraction === undefined ? grouped : `${grouped},${fraction}`;
};

export const formatExactMoney = (value: string, currency: string): string =>
  `${formatExactDecimal(value)} ${currency}`;

const formatIssueDate = (value: string): string => {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
};

export const buildSalesInvoicePdfView = (
  input: SalesInvoicePdfRenderInput,
): SalesInvoicePdfView => ({
  issuerName: input.issuer.name,
  invoiceNumber: input.invoice.invoiceNumber,
  issueDate: formatIssueDate(input.invoice.issueDate),
  customerName: input.invoice.customerSnapshot?.name ?? "Client non renseigné",
  currency: input.invoice.currency,
  lines: input.invoice.lines.map((line) => ({
    description: line.description,
    unit: line.unit ?? "-",
    quantity: formatExactDecimal(line.quantity),
    unitPrice: formatExactMoney(line.unitPrice, input.invoice.currency),
    taxRate: `${formatExactDecimal(line.taxRate)} %`,
    subtotal: formatExactMoney(line.subtotal, input.invoice.currency),
    total: formatExactMoney(line.total, input.invoice.currency),
  })),
  subtotal: formatExactMoney(input.invoice.subtotal, input.invoice.currency),
  taxTotal: formatExactMoney(input.invoice.taxTotal, input.invoice.currency),
  total: formatExactMoney(input.invoice.total, input.invoice.currency),
});

const pageBottom = 760;

export class SalesInvoicePdfRenderer {
  static async render(input: SalesInvoicePdfRenderInput): Promise<Buffer> {
    const view = buildSalesInvoicePdfView(input);
    const document = new PDFDocument({
      autoFirstPage: false,
      bufferPages: true,
      compress: true,
      info: {
        Title: `Facture ${view.invoiceNumber}`,
        Author: view.issuerName,
        Creator: "Liass-OHADA",
        Producer: `Liass-OHADA SALES renderer ${input.renderingVersion}`,
        CreationDate: new Date(input.invoice.issuedAt),
        ModDate: new Date(input.invoice.issuedAt),
      },
      margin: 42,
      size: "A4",
    });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    const completed = new Promise<Buffer>((resolve, reject) => {
      document.on("end", () => resolve(Buffer.concat(chunks)));
      document.on("error", reject);
    });

    document.addPage();
    this.drawHeader(document, view);
    this.drawCustomer(document, input.invoice.customerSnapshot);
    this.drawLines(document, view);
    this.drawTotals(document, view);

    const range = document.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      document.switchToPage(index);
      document
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#64748b")
        .text("Liass-OHADA - Document commercial dérivé", 42, 786, {
          width: 390,
        })
        .text(`Page ${index + 1}/${range.count}`, 440, 786, {
          align: "right",
          width: 113,
        });
    }
    document.end();
    return completed;
  }

  private static drawHeader(document: PDFKit.PDFDocument, view: SalesInvoicePdfView): void {
    document
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor("#172554")
      .text(view.issuerName, 42, 42, { width: 310 });
    document
      .font("Helvetica-Bold")
      .fontSize(24)
      .fillColor("#2563eb")
      .text("FACTURE", 365, 42, { align: "right", width: 188 });
    document
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#334155")
      .text(`N° ${view.invoiceNumber}`, 365, 76, { align: "right", width: 188 })
      .text(`Date d'émission : ${view.issueDate}`, 365, 92, {
        align: "right",
        width: 188,
      })
      .text(`Devise : ${view.currency}`, 365, 108, { align: "right", width: 188 });
    document.moveTo(42, 132).lineTo(553, 132).strokeColor("#cbd5e1").stroke();
  }

  private static drawCustomer(
    document: PDFKit.PDFDocument,
    customer: SalesIssuedInvoice["customerSnapshot"],
  ): void {
    document.font("Helvetica-Bold").fontSize(10).fillColor("#475569").text("FACTURÉ À", 42, 151);
    document
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#0f172a")
      .text(customer?.name ?? "Client non renseigné", 42, 170, { width: 360 });
    let y = 188;
    for (const value of [
      customer?.billingAddress?.line1,
      customer?.billingAddress?.line2,
      [customer?.billingAddress?.postalCode, customer?.billingAddress?.city]
        .filter(Boolean)
        .join(" "),
      customer?.billingAddress?.country,
      customer?.email,
      customer?.phone,
      customer?.taxIdentifier
        ? `Identifiant fiscal : ${customer.taxIdentifier}`
        : undefined,
    ]) {
      if (!value) continue;
      document.font("Helvetica").fontSize(9).fillColor("#475569").text(value, 42, y, { width: 360 });
      y += 13;
    }
    document.y = Math.max(y + 16, 250);
  }

  private static drawLines(document: PDFKit.PDFDocument, view: SalesInvoicePdfView): void {
    this.drawTableHeader(document, document.y);
    let y = document.y + 25;
    for (const line of view.lines) {
      const descriptionHeight = document.heightOfString(line.description, { width: 170 });
      const height = Math.max(28, descriptionHeight + 12);
      if (y + height > pageBottom) {
        document.addPage();
        this.drawTableHeader(document, 52);
        y = 77;
      }
      if (view.lines.indexOf(line) % 2 === 1) {
        document.rect(42, y, 511, height).fill("#f8fafc");
      }
      document.font("Helvetica").fontSize(8).fillColor("#0f172a");
      document.text(line.description, 47, y + 6, { width: 170 });
      document.text(line.unit, 222, y + 6, { width: 42 });
      document.text(line.quantity, 268, y + 6, { align: "right", width: 48 });
      document.text(line.unitPrice, 320, y + 6, { align: "right", width: 72 });
      document.text(line.taxRate, 396, y + 6, { align: "right", width: 45 });
      document.text(line.total, 445, y + 6, { align: "right", width: 103 });
      y += height;
      document.moveTo(42, y).lineTo(553, y).strokeColor("#e2e8f0").stroke();
    }
    document.y = y + 18;
  }

  private static drawTableHeader(document: PDFKit.PDFDocument, y: number): void {
    document.rect(42, y, 511, 25).fill("#172554");
    document.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff");
    document.text("Description", 47, y + 8, { width: 170 });
    document.text("Unité", 222, y + 8, { width: 42 });
    document.text("Qté", 268, y + 8, { align: "right", width: 48 });
    document.text("Prix unitaire", 320, y + 8, { align: "right", width: 72 });
    document.text("Taxe", 396, y + 8, { align: "right", width: 45 });
    document.text("Total", 445, y + 8, { align: "right", width: 103 });
    document.y = y;
  }

  private static drawTotals(document: PDFKit.PDFDocument, view: SalesInvoicePdfView): void {
    if (document.y + 92 > pageBottom) {
      document.addPage();
      document.y = 60;
    }
    const y = document.y;
    const labels = ["Sous-total", "Taxes", "TOTAL"];
    const values = [view.subtotal, view.taxTotal, view.total];
    labels.forEach((label, index) => {
      const rowY = y + index * 24;
      if (index === 2) document.rect(330, rowY - 4, 223, 25).fill("#dbeafe");
      document
        .font(index === 2 ? "Helvetica-Bold" : "Helvetica")
        .fontSize(index === 2 ? 11 : 9)
        .fillColor("#0f172a")
        .text(label, 335, rowY, { width: 85 })
        .text(values[index], 425, rowY, { align: "right", width: 123 });
    });
  }
}
