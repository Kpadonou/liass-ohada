import { ImportBankStatementLineSchema, type ImportBankStatementLine } from '@liass-ohada/shared/treasury';

export interface ParsedStatementCsv {
  errors: { index: number; message: string }[];
  lines: ImportBankStatementLine[];
}

export function parseBankStatementCsv(value: string): ParsedStatementCsv {
  const rows = value
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
  const lines: ImportBankStatementLine[] = [];
  const errors: { index: number; message: string }[] = [];

  rows.forEach((row, index) => {
    const columns = row.split(',').map((column) => column.trim());
    const [date, reference, label, amount, currency] = columns;
    const normalizedCurrency = currency?.trim() ? currency.trim().toUpperCase() : 'XOF';

    const parsed = ImportBankStatementLineSchema.safeParse({
      date,
      reference: reference || undefined,
      label,
      amount: Number(amount),
      currency: normalizedCurrency
    });

    if (parsed.success) {
      lines.push(parsed.data);
    } else {
      errors.push({ index, message: parsed.error.issues[0]?.message ?? 'Invalid row' });
    }
  });

  return { errors, lines };
}
