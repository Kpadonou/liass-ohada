import { type TrialBalanceDto } from '@liass-ohada/shared/accounting';
import { Injectable } from '@angular/core';

export interface TrialBalanceExportMetadata {
  organizationName: string;
  title: string;
  fiscalYearLabel: string;
  periodLabel: string;
  frameworkLabel: string;
  currencyLabel: string;
  generatedAtLabel: string;
  generatedAt: string;
  filtersLabel?: string;
  filters?: string;
  controlLabel: string;
  fileName: string;
}

export interface TrialBalanceExportLabels {
  accountCode: string;
  accountLabel: string;
  openingDebit: string;
  openingCredit: string;
  movementDebit: string;
  movementCredit: string;
  closingDebit: string;
  closingCredit: string;
  totals: string;
}

@Injectable({ providedIn: 'root' })
export class TrialBalanceExportService {
  excel(
    report: TrialBalanceDto,
    metadata: TrialBalanceExportMetadata,
    labels: TrialBalanceExportLabels
  ): Promise<void> {
    return exportTrialBalanceExcel(report, metadata, labels);
  }

  pdf(
    report: TrialBalanceDto,
    metadata: TrialBalanceExportMetadata,
    labels: TrialBalanceExportLabels
  ): Promise<void> {
    return exportTrialBalancePdf(report, metadata, labels);
  }
}

export async function exportTrialBalanceExcel(
  report: TrialBalanceDto,
  metadata: TrialBalanceExportMetadata,
  labels: TrialBalanceExportLabels
): Promise<void> {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet(metadata.title, {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
  });

  worksheet.addRow([metadata.organizationName]);
  worksheet.addRow([metadata.title]);
  worksheet.addRow([metadata.fiscalYearLabel, report.period.fiscalYear]);
  worksheet.addRow([metadata.periodLabel, `${report.period.startDate} – ${report.period.endDate}`]);
  worksheet.addRow([metadata.frameworkLabel]);
  worksheet.addRow([metadata.currencyLabel]);
  worksheet.addRow([metadata.generatedAtLabel, metadata.generatedAt]);
  if (metadata.filters) {
    worksheet.addRow([metadata.filtersLabel, metadata.filters]);
  }
  worksheet.addRow([metadata.controlLabel]);
  worksheet.addRow([]);

  const header = worksheet.addRow([
    labels.accountCode,
    labels.accountLabel,
    labels.openingDebit,
    labels.openingCredit,
    labels.movementDebit,
    labels.movementCredit,
    labels.closingDebit,
    labels.closingCredit
  ]);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
  header.alignment = { vertical: 'middle', wrapText: true };

  for (const row of report.rows) {
    worksheet.addRow([
      row.accountCode,
      row.accountLabel,
      row.openingDebit,
      row.openingCredit,
      row.movementDebit,
      row.movementCredit,
      row.closingDebit,
      row.closingCredit
    ]);
  }

  const totals = worksheet.addRow([
    labels.totals,
    '',
    report.totals.openingDebit,
    report.totals.openingCredit,
    report.totals.movementDebit,
    report.totals.movementCredit,
    report.totals.closingDebit,
    report.totals.closingCredit
  ]);
  totals.font = { bold: true };
  totals.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

  worksheet.columns = [
    { width: 15 },
    { width: 38 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 }
  ];
  worksheet.views = [{ state: 'frozen', ySplit: header.number }];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > header.number) {
      for (let column = 3; column <= 8; column += 1) {
        row.getCell(column).numFmt = '#,##0';
        row.getCell(column).alignment = { horizontal: 'right' };
      }
    }
  });

  const bytes = await workbook.xlsx.writeBuffer();
  saveBlob(
    new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }),
    `${metadata.fileName}.xlsx`
  );
}

export async function exportTrialBalancePdf(
  report: TrialBalanceDto,
  metadata: TrialBalanceExportMetadata,
  labels: TrialBalanceExportLabels
): Promise<void> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable')
  ]);
  const autoTable = autoTableModule.default;
  const document = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const formatAmount = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

  document.setFontSize(15);
  document.text(metadata.title, 14, 14);
  document.setFontSize(9);
  const metadataLines = [
    metadata.organizationName,
    `${metadata.fiscalYearLabel}: ${report.period.fiscalYear}`,
    `${metadata.periodLabel}: ${report.period.startDate} – ${report.period.endDate}`,
    metadata.frameworkLabel,
    metadata.currencyLabel,
    `${metadata.generatedAtLabel}: ${metadata.generatedAt}`,
    ...(metadata.filters ? [`${metadata.filtersLabel}: ${metadata.filters}`] : []),
    metadata.controlLabel
  ];
  document.text(metadataLines, 14, 20);

  autoTable(document, {
    startY: 20 + metadataLines.length * 4,
    head: [[
      labels.accountCode,
      labels.accountLabel,
      labels.openingDebit,
      labels.openingCredit,
      labels.movementDebit,
      labels.movementCredit,
      labels.closingDebit,
      labels.closingCredit
    ]],
    body: report.rows.map((row) => [
      row.accountCode,
      row.accountLabel,
      formatAmount.format(row.openingDebit),
      formatAmount.format(row.openingCredit),
      formatAmount.format(row.movementDebit),
      formatAmount.format(row.movementCredit),
      formatAmount.format(row.closingDebit),
      formatAmount.format(row.closingCredit)
    ]),
    foot: [[
      labels.totals,
      '',
      formatAmount.format(report.totals.openingDebit),
      formatAmount.format(report.totals.openingCredit),
      formatAmount.format(report.totals.movementDebit),
      formatAmount.format(report.totals.movementCredit),
      formatAmount.format(report.totals.closingDebit),
      formatAmount.format(report.totals.closingCredit)
    ]],
    showHead: 'everyPage',
    showFoot: 'lastPage',
    styles: { fontSize: 7, cellPadding: 1.8, overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: 23 },
      1: { cellWidth: 62 },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' }
    },
    headStyles: { fillColor: [29, 78, 216], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [226, 232, 240], textColor: 15, fontStyle: 'bold' }
  });

  document.save(`${metadata.fileName}.pdf`);
}

export function filesystemSafeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
