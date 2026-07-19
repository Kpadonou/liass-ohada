export const BANK_STATEMENT_TEMPLATE_FILENAME = 'modele-import-releve-bancaire-liass-ohada.xlsx';
export const BANK_STATEMENT_TEMPLATE_SHEET_NAME = 'Relevé bancaire';
export const BANK_STATEMENT_TEMPLATE_INSTRUCTIONS_SHEET_NAME = 'Instructions';

export const BANK_STATEMENT_TEMPLATE_HEADERS = [
  'Date opération*',
  'Date valeur',
  'Référence',
  'Libellé*',
  'Montant*',
  'Sens*',
  'Devise',
  'Identifiant externe'
] as const;

const EXAMPLE_ROWS = [
  ['2026-01-15', '2026-01-15', 'VIR-001', 'Encaissement client', 150000, 'Entrée', 'XOF', 'BANK-2026-001'],
  ['2026-01-16', '2026-01-16', 'FRAIS-001', 'Frais bancaires', 2500, 'Sortie', 'XOF', 'BANK-2026-002']
] as const;

const INSTRUCTIONS = [
  'Les colonnes marquées par * sont obligatoires.',
  'Date opération* : date de l’opération au format AAAA-MM-JJ ou JJ/MM/AAAA.',
  'Date valeur : date de valeur si elle est différente.',
  'Référence : numéro ou référence bancaire.',
  'Libellé* : description de l’opération.',
  'Montant* : montant positif, sans signe négatif.',
  'Sens* : Entrée = argent reçu sur le compte de trésorerie.',
  'Sens* : Sortie = argent sorti du compte de trésorerie.',
  'Devise : XOF par défaut si vide.',
  'Identifiant externe : identifiant unique facultatif permettant d’éviter les doublons.'
] as const;

const FIELD_REFERENCE_ROWS = [
  ['Date opération*', 'Date de l’opération', 'statementDate'],
  ['Date valeur', 'Date de valeur si elle est différente', 'valueDate'],
  ['Référence', 'Numéro ou référence bancaire', 'reference'],
  ['Libellé*', 'Description de l’opération', 'description'],
  ['Montant*', 'Montant positif sans signe négatif', 'amount'],
  ['Sens*', 'Entrée ou Sortie', 'direction'],
  ['Devise', 'XOF par défaut si vide', 'currency'],
  ['Identifiant externe', 'Identifiant facultatif anti-doublon', 'externalId']
] as const;

const REQUIRED_HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFEFF6FF' }
} as const;

export async function createBankStatementTemplateWorkbook() {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Liass-OHADA';
  workbook.created = new Date();

  const statementSheet = workbook.addWorksheet(BANK_STATEMENT_TEMPLATE_SHEET_NAME);
  statementSheet.columns = BANK_STATEMENT_TEMPLATE_HEADERS.map((header) => ({
    header,
    key: header,
    width: Math.max(header.length + 4, 20)
  }));
  statementSheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const row of EXAMPLE_ROWS) {
    statementSheet.addRow([...row]);
  }
  statementSheet.getRow(1).font = { bold: true };
  statementSheet.getRow(1).alignment = { vertical: 'middle' };
  statementSheet.getRow(1).height = 22;
  statementSheet.getRow(1).eachCell({ includeEmpty: true }, (cell) => {
    if (String(cell.value ?? '').includes('*')) {
      cell.fill = REQUIRED_HEADER_FILL;
    }
  });
  for (let rowNumber = 2; rowNumber <= 1000; rowNumber += 1) {
    statementSheet.getCell(`F${rowNumber}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: ['"Entrée,Sortie"']
    };
  }

  const instructionsSheet = workbook.addWorksheet(BANK_STATEMENT_TEMPLATE_INSTRUCTIONS_SHEET_NAME);
  instructionsSheet.addRow(['Instructions']);
  for (const instruction of INSTRUCTIONS) {
    instructionsSheet.addRow([instruction]);
  }
  instructionsSheet.addRow([]);
  instructionsSheet.addRow(['Colonne du modèle', 'Signification', 'Champ système']);
  for (const row of FIELD_REFERENCE_ROWS) {
    instructionsSheet.addRow([...row]);
  }
  instructionsSheet.getRow(1).font = { bold: true };
  instructionsSheet.getRow(INSTRUCTIONS.length + 3).font = { bold: true };
  instructionsSheet.getColumn(1).width = 28;
  instructionsSheet.getColumn(2).width = 48;
  instructionsSheet.getColumn(3).width = 20;

  return workbook;
}

export async function downloadBankStatementTemplate(): Promise<void> {
  const workbook = await createBankStatementTemplateWorkbook();
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = BANK_STATEMENT_TEMPLATE_FILENAME;
  anchor.click();
  URL.revokeObjectURL(url);
}
