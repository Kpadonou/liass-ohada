import { Injectable } from '@angular/core';
import { type JournalBookEntryDto, type JournalBookTotalsDto } from '@liass-ohada/shared/accounting';

export interface JournalBookExportMetadata {
  organizationName: string;
  title: string;
  framework: string;
  fiscalYear: string;
  period: string;
  journal: string;
  currency: string;
  generatedAt: string;
  filters: string;
  status: string;
  fileName: string;
}

export interface JournalBookExportLabels {
  date: string;
  journal: string;
  entryNumber: string;
  reference: string;
  accountCode: string;
  accountLabel: string;
  label: string;
  thirdParty: string;
  debit: string;
  credit: string;
  totals: string;
}

@Injectable({ providedIn: 'root' })
export class JournalBookExportService {
  async excel(
    entries: JournalBookEntryDto[],
    totals: JournalBookTotalsDto,
    metadata: JournalBookExportMetadata,
    labels: JournalBookExportLabels
  ): Promise<void> {
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet(metadata.title, {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
    });
    [
      [metadata.organizationName],
      [metadata.title],
      [metadata.framework],
      [metadata.fiscalYear],
      [metadata.period],
      [metadata.journal],
      [metadata.currency],
      [metadata.generatedAt],
      [metadata.filters],
      [metadata.status],
      []
    ].forEach((row) => sheet.addRow(row));
    const header = sheet.addRow(Object.values(labels).slice(0, 10));
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };

    for (const entry of entries) {
      entry.lines.forEach((line, index) => {
        sheet.addRow([
          index === 0 ? entry.accountingDate : '',
          index === 0 ? `${entry.journalCode} — ${entry.journalLabel}` : '',
          index === 0 ? entry.entryNumber : '',
          index === 0 ? entry.reference ?? '' : '',
          line.accountCode,
          line.accountLabel,
          line.lineLabel || entry.entryLabel,
          line.thirdPartyName || line.thirdPartyCode || '',
          line.debit,
          line.credit
        ]);
      });
    }
    const totalRow = sheet.addRow([
      labels.totals, '', '', '', '', '', '', '', totals.totalDebit, totals.totalCredit
    ]);
    totalRow.font = { bold: true };
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    sheet.columns = [13, 25, 22, 18, 14, 30, 35, 20, 16, 16].map((width) => ({ width }));
    sheet.views = [{ state: 'frozen', ySplit: header.number }];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > header.number) {
        for (const column of [9, 10]) {
          row.getCell(column).numFmt = '#,##0';
          row.getCell(column).alignment = { horizontal: 'right' };
        }
      }
    });
    const bytes = await workbook.xlsx.writeBuffer();
    saveBlob(new Blob([bytes]), `${metadata.fileName}.xlsx`);
  }

  async pdf(
    entries: JournalBookEntryDto[],
    totals: JournalBookTotalsDto,
    metadata: JournalBookExportMetadata,
    labels: JournalBookExportLabels
  ): Promise<void> {
    const [{ jsPDF }, autoTableModule] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable')
    ]);
    const document = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const format = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
    document.setFontSize(14);
    document.text(metadata.title, 12, 12);
    document.setFontSize(8);
    document.text([
      metadata.organizationName, metadata.framework, metadata.fiscalYear, metadata.period,
      metadata.journal, metadata.currency, metadata.generatedAt, metadata.filters, metadata.status
    ], 12, 17);
    const body = entries.flatMap((entry) =>
      entry.lines.map((line, index) => [
        index === 0 ? entry.accountingDate : '',
        index === 0 ? entry.journalCode : '',
        index === 0 ? entry.entryNumber : '',
        index === 0 ? entry.reference ?? '' : '',
        line.accountCode,
        line.accountLabel,
        line.lineLabel || entry.entryLabel,
        line.thirdPartyName || line.thirdPartyCode || '',
        format.format(line.debit),
        format.format(line.credit)
      ])
    );
    autoTableModule.default(document, {
      startY: 54,
      head: [[labels.date, labels.journal, labels.entryNumber, labels.reference,
        labels.accountCode, labels.accountLabel, labels.label, labels.thirdParty,
        labels.debit, labels.credit]],
      body,
      foot: [[labels.totals, '', '', '', '', '', '', '',
        format.format(totals.totalDebit), format.format(totals.totalCredit)]],
      showHead: 'everyPage',
      showFoot: 'lastPage',
      rowPageBreak: 'avoid',
      styles: { fontSize: 6.5, cellPadding: 1.4, overflow: 'linebreak' },
      columnStyles: { 8: { halign: 'right' }, 9: { halign: 'right' } },
      didDrawPage: ({ pageNumber }) => {
        document.setFontSize(7);
        document.text(`${pageNumber}`, 282, 203, { align: 'right' });
      }
    });
    document.save(`${metadata.fileName}.pdf`);
  }
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
