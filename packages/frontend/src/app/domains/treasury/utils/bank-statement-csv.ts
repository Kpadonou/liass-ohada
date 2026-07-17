import { type ImportBankStatementLine } from '@liass-ohada/shared/treasury';

import { parseBankStatementCsvText } from './bank-statement-import';

export interface ParsedStatementCsv {
  errors: { index: number; message: string }[];
  lines: ImportBankStatementLine[];
}

export function parseBankStatementCsv(value: string): ParsedStatementCsv {
  const preview = parseBankStatementCsvText(value);

  return {
    errors: preview.invalidRows.flatMap((row) =>
      row.errors.map((message) => ({ index: row.rowNumber - 1, message }))
    ),
    lines: preview.validRows.flatMap((row) => (row.line ? [row.line] : []))
  };
}
