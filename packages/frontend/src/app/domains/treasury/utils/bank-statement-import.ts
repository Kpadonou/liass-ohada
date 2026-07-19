import {
  ImportBankStatementLineSchema,
  type ImportBankStatementLine
} from '@liass-ohada/shared/treasury';

export type BankStatementImportSource = 'csv' | 'xlsx';

export interface BankStatementImportRow {
  rowNumber: number;
  rawData: Record<string, string | number | null>;
  line: ImportBankStatementLine | null;
  errors: string[];
}

export interface BankStatementImportPreview {
  fileName: string;
  source: BankStatementImportSource;
  rows: BankStatementImportRow[];
  validRows: BankStatementImportRow[];
  invalidRows: BankStatementImportRow[];
  totals: {
    totalRows: number;
    validRows: number;
    rejectedRows: number;
    totalInflow: number;
    totalOutflow: number;
  };
}

type CanonicalField =
  | 'statementDate'
  | 'valueDate'
  | 'reference'
  | 'description'
  | 'amount'
  | 'direction'
  | 'currency'
  | 'externalId';

const VALIDATION = {
  missingHeader: 'TREASURY.IMPORT.VALIDATION.MISSING_HEADER',
  missingRequiredFields: 'TREASURY.IMPORT.VALIDATION.MISSING_REQUIRED_FIELDS',
  invalidDate: 'TREASURY.IMPORT.VALIDATION.INVALID_DATE',
  invalidAmount: 'TREASURY.IMPORT.VALIDATION.INVALID_AMOUNT',
  invalidDirection: 'TREASURY.IMPORT.VALIDATION.INVALID_DIRECTION',
  invalidRow: 'TREASURY.IMPORT.VALIDATION.INVALID_ROW',
  unsupportedFile: 'TREASURY.IMPORT.VALIDATION.UNSUPPORTED_FILE'
} as const;

const FIELD_ALIASES = new Map<string, CanonicalField>([
  ['statementdate', 'statementDate'],
  ['date', 'statementDate'],
  ['dateoperation', 'statementDate'],
  ['dateoperationnelle', 'statementDate'],
  ['valuedate', 'valueDate'],
  ['datevaleur', 'valueDate'],
  ['reference', 'reference'],
  ['description', 'description'],
  ['libelle', 'description'],
  ['amount', 'amount'],
  ['montant', 'amount'],
  ['direction', 'direction'],
  ['sens', 'direction'],
  ['currency', 'currency'],
  ['devise', 'currency'],
  ['externalid', 'externalId'],
  ['identifiantexterne', 'externalId'],
  ['idexterne', 'externalId']
]);

const DIRECTION_ALIASES = new Map<string, ImportBankStatementLine['direction']>([
  ['INFLOW', 'INFLOW'],
  ['ENTREE', 'INFLOW'],
  ['DEBIT', 'INFLOW'],
  ['DEBIT_ACCOUNTING', 'INFLOW'],
  ['OUTFLOW', 'OUTFLOW'],
  ['SORTIE', 'OUTFLOW'],
  ['CREDIT', 'OUTFLOW'],
  ['CREDIT_ACCOUNTING', 'OUTFLOW']
]);

export async function parseBankStatementFile(
  file: File,
  defaultCurrency = 'XOF'
): Promise<BankStatementImportPreview> {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith('.csv')) {
    return parseBankStatementCsvText(await file.text(), file.name, defaultCurrency);
  }

  if (lowerName.endsWith('.xlsx')) {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      return buildPreview(file.name, 'xlsx', [
        { rowNumber: 1, rawData: {}, line: null, errors: [VALIDATION.missingHeader] }
      ]);
    }

    const rows: Array<{ rowNumber: number; values: Array<string | number | null> }> = [];
    worksheet.eachRow((row, rowNumber) => {
      const values: Array<string | number | null> = [];
      for (let index = 1; index <= row.cellCount; index += 1) {
        values.push(excelCellToPrimitive(row.getCell(index).value));
      }
      if (values.some((value) => value !== null && String(value).trim().length > 0)) {
        rows.push({ rowNumber, values });
      }
    });

    return parseTableRows(rows, file.name, 'xlsx', defaultCurrency);
  }

  return buildPreview(file.name, 'csv', [
    { rowNumber: 1, rawData: {}, line: null, errors: [VALIDATION.unsupportedFile] }
  ]);
}

export function parseBankStatementCsvText(
  text: string,
  fileName = 'statement.csv',
  defaultCurrency = 'XOF'
): BankStatementImportPreview {
  const delimiter = detectDelimiter(text);
  const rows = parseCsvRows(text, delimiter)
    .map((values, index) => ({ rowNumber: index + 1, values }))
    .filter((row) => row.values.some((value) => String(value ?? '').trim().length > 0));

  return parseTableRows(rows, fileName, 'csv', defaultCurrency);
}

function parseTableRows(
  rows: Array<{ rowNumber: number; values: Array<string | number | null> }>,
  fileName: string,
  source: BankStatementImportSource,
  defaultCurrency: string
): BankStatementImportPreview {
  if (rows.length === 0) {
    return buildPreview(fileName, source, [
      { rowNumber: 1, rawData: {}, line: null, errors: [VALIDATION.missingHeader] }
    ]);
  }

  const headerRow = rows[0];
  const headerMap = headerRow.values.map((header) => FIELD_ALIASES.get(normalizeHeader(String(header ?? ''))));
  const hasRequiredHeaders =
    headerMap.includes('statementDate') &&
    headerMap.includes('description') &&
    headerMap.includes('amount') &&
    headerMap.includes('direction');

  if (!hasRequiredHeaders) {
    return buildPreview(fileName, source, [
      { rowNumber: headerRow.rowNumber, rawData: {}, line: null, errors: [VALIDATION.missingHeader] }
    ]);
  }

  const parsedRows = rows.slice(1).map((row) => parseDataRow(row, headerMap, defaultCurrency));

  return buildPreview(fileName, source, parsedRows);
}

function parseDataRow(
  row: { rowNumber: number; values: Array<string | number | null> },
  headerMap: Array<CanonicalField | undefined>,
  defaultCurrency: string
): BankStatementImportRow {
  const rawData: Record<string, string | number | null> = {};
  const mapped: Partial<Record<CanonicalField, string | number | null>> = {};

  for (const [index, field] of headerMap.entries()) {
    if (!field) {
      continue;
    }
    const value = cleanCellValue(row.values[index]);
    rawData[field] = value;
    mapped[field] = value;
  }

  const errors: string[] = [];
  const statementDate = parseDateValue(mapped.statementDate);
  const valueDate = mapped.valueDate ? parseDateValue(mapped.valueDate) : undefined;
  const amount = parseAmountValue(mapped.amount);
  const direction = parseDirectionValue(mapped.direction);
  const description = cleanText(mapped.description);

  if (!statementDate) {
    errors.push(VALIDATION.invalidDate);
  }
  if (mapped.valueDate && !valueDate) {
    errors.push(VALIDATION.invalidDate);
  }
  if (amount === null) {
    errors.push(VALIDATION.invalidAmount);
  }
  if (!direction) {
    errors.push(VALIDATION.invalidDirection);
  }
  if (!description) {
    errors.push(VALIDATION.missingRequiredFields);
  }

  if (errors.length > 0 || !statementDate || amount === null || !direction || !description) {
    return { rowNumber: row.rowNumber, rawData, line: null, errors: uniqueErrors(errors) };
  }

  const candidate = {
    statementDate,
    ...(valueDate ? { valueDate } : {}),
    ...(cleanText(mapped.reference) ? { reference: cleanText(mapped.reference) } : {}),
    ...(cleanText(mapped.externalId) ? { externalId: cleanText(mapped.externalId) } : {}),
    description,
    amount,
    direction,
    currency: (cleanText(mapped.currency) || defaultCurrency || 'XOF').toUpperCase(),
    rawData
  };
  const parsed = ImportBankStatementLineSchema.safeParse(candidate);

  if (!parsed.success) {
    return {
      rowNumber: row.rowNumber,
      rawData,
      line: null,
      errors: uniqueErrors([VALIDATION.invalidRow, ...parsed.error.issues.map((issue) => issue.message)])
    };
  }

  return { rowNumber: row.rowNumber, rawData, line: parsed.data, errors: [] };
}

function buildPreview(
  fileName: string,
  source: BankStatementImportSource,
  rows: BankStatementImportRow[]
): BankStatementImportPreview {
  const validRows = rows.filter((row) => row.line);
  const invalidRows = rows.filter((row) => !row.line || row.errors.length > 0);
  const totalInflow = validRows.reduce(
    (total, row) => total + (row.line?.direction === 'INFLOW' ? row.line.amount : 0),
    0
  );
  const totalOutflow = validRows.reduce(
    (total, row) => total + (row.line?.direction === 'OUTFLOW' ? row.line.amount : 0),
    0
  );

  return {
    fileName,
    source,
    rows,
    validRows,
    invalidRows,
    totals: {
      totalRows: rows.length,
      validRows: validRows.length,
      rejectedRows: invalidRows.length,
      totalInflow,
      totalOutflow
    }
  };
}

function detectDelimiter(text: string): ',' | ';' {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
  return countUnquoted(firstLine, ';') > countUnquoted(firstLine, ',') ? ';' : ',';
}

function parseCsvRows(text: string, delimiter: ',' | ';'): string[][] {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(current.trim());
      current = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(current.trim());
      rows.push(row);
      row = [];
      current = '';
      continue;
    }

    current += char;
  }

  row.push(current.trim());
  rows.push(row);

  return rows;
}

function countUnquoted(value: string, needle: ',' | ';'): number {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && char === needle) {
      count += 1;
    }
  }

  return count;
}

function parseDateValue(value: string | number | null | undefined): string | null {
  if (typeof value === 'number') {
    return excelSerialDateToIso(value);
  }

  const text = cleanText(value);
  if (!text) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return isValidIsoDate(text) ? text : null;
  }

  const frenchMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (frenchMatch) {
    const [, day, month, year] = frenchMatch;
    const iso = `${year}-${month}-${day}`;
    return isValidIsoDate(iso) ? iso : null;
  }

  return null;
}

function parseAmountValue(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  const text = cleanText(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, '');
  if (!text || text.startsWith('-')) {
    return null;
  }

  if (/^\d+$/.test(text)) {
    const amount = Number(text);
    return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
  }

  if (text.includes(',') && text.includes('.')) {
    return null;
  }

  if (text.includes(',')) {
    const parts = text.split(',');
    if (parts.length === 2 && /^0+$/.test(parts[1])) {
      return parseAmountValue(parts[0]);
    }
    return null;
  }

  if (text.includes('.')) {
    const parts = text.split('.');
    if (parts.length === 2 && /^0+$/.test(parts[1])) {
      return parseAmountValue(parts[0]);
    }
    if (parts.length === 2 && parts[1].length === 3 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      return parseAmountValue(`${parts[0]}${parts[1]}`);
    }
  }

  return null;
}

function parseDirectionValue(value: string | number | null | undefined): ImportBankStatementLine['direction'] | null {
  return DIRECTION_ALIASES.get(normalizeDirection(String(value ?? ''))) ?? null;
}

function excelSerialDateToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) {
    return null;
  }
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000;
  const date = new Date(utc);
  return date.toISOString().slice(0, 10);
}

function isValidIsoDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeHeader(value: string): string {
  return stripDiacritics(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeDirection(value: string): string {
  return stripDiacritics(value).toUpperCase().replace(/[\s-]+/g, '_');
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function cleanText(value: string | number | null | undefined): string {
  return String(value ?? '').trim();
}

function cleanCellValue(value: string | number | null): string | number | null {
  if (typeof value === 'string') {
    return value.trim();
  }
  return value;
}

function excelCellToPrimitive(value: unknown): string | number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record['text'] !== undefined) {
      return excelCellToPrimitive(record['text']);
    }
    if (record['result'] !== undefined) {
      return excelCellToPrimitive(record['result']);
    }
    if (Array.isArray(record['richText'])) {
      return record['richText']
        .map((part) => (typeof part === 'object' && part ? String((part as { text?: unknown }).text ?? '') : ''))
        .join('');
    }
  }
  return String(value);
}

function uniqueErrors(errors: string[]): string[] {
  return [...new Set(errors)];
}
