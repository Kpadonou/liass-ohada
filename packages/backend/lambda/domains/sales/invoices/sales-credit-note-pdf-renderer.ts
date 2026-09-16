import PDFDocument from "pdfkit";
import type { SalesIssuedCreditNote } from "@liass-ohada/shared/sales";
import {
  formatExactDecimal,
  formatExactMoney,
  formatIssueDate,
} from "./sales-invoice-pdf-renderer";

export interface SalesCreditNotePdfRenderInput {
  issuer: { name: string };
  creditNote: SalesIssuedCreditNote;
  renderingVersion: string;
}

export interface SalesCreditNotePdfLineView {
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  subtotal: string;
  taxAmount: string;
  total: string;
}

export interface SalesCreditNotePdfView {
  creditNoteNumber: string;
  currency: string;
  customerName: string;
  issueDate: string;
  issuerName: string;
  lines: SalesCreditNotePdfLineView[];
  originalInvoiceNumber: string;
  reason: string;
  subtotal: string;
  taxTotal: string;
  total: string;
}

export const buildSalesCreditNotePdfView = (
  input: SalesCreditNotePdfRenderInput,
): SalesCreditNotePdfView => ({
  issuerName: input.issuer.name,
  creditNoteNumber: input.creditNote.creditNoteNumber,
  issueDate: formatIssueDate(input.creditNote.issueDate),
  originalInvoiceNumber: input.creditNote.originalInvoiceNumber,
  reason: input.creditNote.reason ?? "",
  customerName: input.creditNote.customerSnapshot?.name ?? "Client non renseigné",
  currency: input.creditNote.currency,
  lines: input.creditNote.lines.map((line) => ({
    description: line.description,
    unit: line.unit ?? "-",
    quantity: formatExactDecimal(line.quantity),
    unitPrice: formatExactMoney(line.unitPrice, input.creditNote.currency),
    taxRate: `${formatExactDecimal(line.taxRate)} %`,
    subtotal: formatExactMoney(line.subtotal, input.creditNote.currency),
    taxAmount: formatExactMoney(line.taxAmount, input.creditNote.currency),
    total: formatExactMoney(line.total, input.creditNote.currency),
  })),
  subtotal: formatExactMoney(input.creditNote.subtotal, input.creditNote.currency),
  taxTotal: formatExactMoney(input.creditNote.taxTotal, input.creditNote.currency),
  total: formatExactMoney(input.creditNote.total, input.creditNote.currency),
});

const pageBottom = 760;

export class SalesCreditNotePdfRenderer {
  static async render(input: SalesCreditNotePdfRenderInput): Promise<Buffer> {
    const view = buildSalesCreditNotePdfView(input);
    const document = new PDFDocument({
      autoFirstPage: false,
      bufferPages: true,
      compress: true,
      info: {
        Title: `Avoir ${view.creditNoteNumber}`,
        Author: view.issuerName,
        Creator: "Liass-OHADA",
        Producer: `Liass-OHADA SALES renderer ${input.renderingVersion}`,
        CreationDate: new Date(input.creditNote.issuedAt),
        ModDate: new Date(input.creditNote.issuedAt),
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
    this.drawReason(document, view.reason);
    this.drawCustomer(document, input.creditNote.customerSnapshot);
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

  private static drawHeader(
    document: PDFKit.PDFDocument,
    view: SalesCreditNotePdfView,
  ): void {
    document
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor("#172554")
      .text(view.issuerName, 42, 42, { width: 310 });
    document
      .font("Helvetica-Bold")
      .fontSize(24)
      .fillColor("#2563eb")
      .text("AVOIR", 365, 42, { align: "right", width: 188 });
    document
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#334155")
      .text(`N° ${view.creditNoteNumber}`, 365, 76, {
        align: "right",
        width: 188,
      })
      .text(`Date d'émission : ${view.issueDate}`, 365, 92, {
        align: "right",
        width: 188,
      })
      .text(`Devise : ${view.currency}`, 365, 108, {
        align: "right",
        width: 188,
      });
    document
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#334155")
      .text(`Facture d'origine : ${view.originalInvoiceNumber}`, 42, 110, {
        width: 310,
      });
    document.moveTo(42, 132).lineTo(553, 132).strokeColor("#cbd5e1").stroke();
    document.y = 151;
  }

  private static drawReason(document: PDFKit.PDFDocument, reason: string): void {
    document
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#475569")
      .text("MOTIF", 42, document.y);
    document
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#0f172a")
      .text(reason, 42, document.y + 6, { width: 511 });
    document.y += 18;
  }

  private static drawCustomer(
    document: PDFKit.PDFDocument,
    customer: SalesIssuedCreditNote["customerSnapshot"],
  ): void {
    document
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#475569")
      .text("CLIENT", 42, document.y);
    document
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#0f172a")
      .text(customer?.name ?? "Client non renseigné", 42, document.y + 6, {
        width: 360,
      });
    let y = document.y + 4;
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
      document
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#475569")
        .text(value, 42, y, { width: 360 });
      y += 13;
    }
    document.y = y + 16;
  }

  private static drawLines(
    document: PDFKit.PDFDocument,
    view: SalesCreditNotePdfView,
  ): void {
    if (document.y > pageBottom - 70) {
      document.addPage();
      document.y = 52;
    }
    this.drawTableHeader(document, document.y);
    let y = document.y + 25;
    view.lines.forEach((line, index) => {
      const descriptionHeight = document.heightOfString(line.description, {
        width: 139,
      });
      const height = Math.max(28, descriptionHeight + 12);
      if (y + height > pageBottom) {
        document.addPage();
        this.drawTableHeader(document, 52);
        y = 77;
      }
      if (index % 2 === 1) document.rect(42, y, 511, height).fill("#f8fafc");
      document.font("Helvetica").fontSize(7).fillColor("#0f172a");
      document.text(line.description, 47, y + 6, { width: 139 });
      document.text(line.unit, 190, y + 6, { width: 31 });
      document.text(line.quantity, 225, y + 6, { align: "right", width: 38 });
      document.text(line.unitPrice, 267, y + 6, { align: "right", width: 66 });
      document.text(line.taxRate, 337, y + 6, { align: "right", width: 34 });
      document.text(line.taxAmount, 375, y + 6, { align: "right", width: 75 });
      document.text(line.total, 454, y + 6, { align: "right", width: 94 });
      y += height;
      document.moveTo(42, y).lineTo(553, y).strokeColor("#e2e8f0").stroke();
    });
    document.y = y + 18;
  }

  private static drawTableHeader(document: PDFKit.PDFDocument, y: number): void {
    document.rect(42, y, 511, 25).fill("#172554");
    document.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff");
    document.text("Description", 47, y + 8, { width: 139 });
    document.text("Unité", 190, y + 8, { width: 31 });
    document.text("Qté", 225, y + 8, { align: "right", width: 38 });
    document.text("Prix unit.", 267, y + 8, { align: "right", width: 66 });
    document.text("Taxe", 337, y + 8, { align: "right", width: 34 });
    document.text("Montant taxe", 375, y + 8, { align: "right", width: 75 });
    document.text("Total", 454, y + 8, { align: "right", width: 94 });
    document.y = y;
  }

  private static drawTotals(
    document: PDFKit.PDFDocument,
    view: SalesCreditNotePdfView,
  ): void {
    if (document.y + 92 > pageBottom) {
      document.addPage();
      document.y = 60;
    }
    const y = document.y;
    const labels = ["Sous-total", "Taxes", "TOTAL AVOIR"];
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
