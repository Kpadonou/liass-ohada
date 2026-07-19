import { Workbook } from 'exceljs';

import { parseBankStatementCsvText, parseBankStatementFile } from './bank-statement-import';

describe('bank statement import parser', () => {
  it('maps the official French template headers to canonical backend fields', () => {
    const preview = parseBankStatementCsvText(
      [
        'Date opération*;Date valeur;Référence;Libellé*;Montant*;Sens*;Devise;Identifiant externe',
        '2026-01-15;2026-01-15;VIR-001;Encaissement client;150000;Entrée;XOF;BANK-2026-001',
        '2026-01-16;2026-01-16;FRAIS-001;Frais bancaires;2500;Sortie;XOF;BANK-2026-002'
      ].join('\n')
    );

    expect(preview.invalidRows).toHaveLength(0);
    expect(preview.validRows.map((row) => row.line)).toEqual([
      expect.objectContaining({
        statementDate: '2026-01-15',
        valueDate: '2026-01-15',
        reference: 'VIR-001',
        description: 'Encaissement client',
        amount: 150000,
        direction: 'INFLOW',
        currency: 'XOF',
        externalId: 'BANK-2026-001'
      }),
      expect.objectContaining({
        statementDate: '2026-01-16',
        valueDate: '2026-01-16',
        reference: 'FRAIS-001',
        description: 'Frais bancaires',
        amount: 2500,
        direction: 'OUTFLOW',
        currency: 'XOF',
        externalId: 'BANK-2026-002'
      })
    ]);
  });

  it('parses semicolon CSV with French aliases and quoted fields', () => {
    const preview = parseBankStatementCsvText(
      [
        'date opération;date valeur;référence;libellé;montant;sens;devise;externalId',
        '15/01/2026;16/01/2026;VIR-001;"Encaissement client, facture A";150 000;Entrée;XOF;EXT-1'
      ].join('\n')
    );

    expect(preview.invalidRows).toHaveLength(0);
    expect(preview.validRows[0].line).toEqual({
      statementDate: '2026-01-15',
      valueDate: '2026-01-16',
      reference: 'VIR-001',
      description: 'Encaissement client, facture A',
      amount: 150000,
      direction: 'INFLOW',
      currency: 'XOF',
      externalId: 'EXT-1',
      rawData: {
        amount: '150 000',
        currency: 'XOF',
        description: 'Encaissement client, facture A',
        direction: 'Entrée',
        externalId: 'EXT-1',
        reference: 'VIR-001',
        statementDate: '15/01/2026',
        valueDate: '16/01/2026'
      }
    });
    expect(preview.totals.totalInflow).toBe(150000);
  });

  it('maps direction aliases to canonical directions', () => {
    const preview = parseBankStatementCsvText(
      [
        'statementDate,description,amount,direction',
        '2026-01-15,Debit movement,1000,DEBIT',
        '2026-01-16,Credit movement,2000,CRÉDIT'
      ].join('\n')
    );

    expect(preview.invalidRows).toHaveLength(0);
    expect(preview.validRows.map((row) => row.line?.direction)).toEqual(['INFLOW', 'OUTFLOW']);
  });

  it('rejects zero, negative, and decimal minor-unit amounts', () => {
    const preview = parseBankStatementCsvText(
      [
        'statementDate,description,amount,direction',
        '2026-01-15,Zero,0,INFLOW',
        '2026-01-16,Negative,-100,OUTFLOW',
        '2026-01-17,Decimal,100.25,INFLOW'
      ].join('\n')
    );

    expect(preview.validRows).toHaveLength(0);
    expect(preview.invalidRows).toHaveLength(3);
    expect(preview.invalidRows.every((row) => row.errors.includes('TREASURY.IMPORT.VALIDATION.INVALID_AMOUNT'))).toBe(
      true
    );
  });

  it('rejects invalid or ambiguous dates', () => {
    const preview = parseBankStatementCsvText(
      [
        'statementDate,description,amount,direction',
        '15-01-2026,Ambiguous,1000,INFLOW',
        '2026-02-31,Impossible,1000,OUTFLOW'
      ].join('\n')
    );

    expect(preview.validRows).toHaveLength(0);
    expect(preview.invalidRows.every((row) => row.errors.includes('TREASURY.IMPORT.VALIDATION.INVALID_DATE'))).toBe(
      true
    );
  });

  it('reports missing required headers', () => {
    const preview = parseBankStatementCsvText('date,libellé,montant\n2026-01-15,Missing direction,1000');

    expect(preview.validRows).toHaveLength(0);
    expect(preview.invalidRows[0].errors).toContain('TREASURY.IMPORT.VALIDATION.MISSING_HEADER');
  });

  it('parses xlsx headers and normalizes Excel serial dates', async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Statement');
    sheet.addRow(['date', 'date valeur', 'libellé', 'montant', 'sens']);
    sheet.addRow([excelSerial('2026-01-15'), excelSerial('2026-01-16'), 'Bank fee', 150000, 'SORTIE']);
    const buffer = await workbook.xlsx.writeBuffer();
    const file = new File([buffer], 'statement.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const preview = await parseBankStatementFile(file);

    expect(preview.source).toBe('xlsx');
    expect(preview.invalidRows).toHaveLength(0);
    expect(preview.validRows[0].line).toMatchObject({
      statementDate: '2026-01-15',
      valueDate: '2026-01-16',
      description: 'Bank fee',
      amount: 150000,
      direction: 'OUTFLOW'
    });
  });
});

function excelSerial(isoDate: string): number {
  const timestamp = Date.parse(`${isoDate}T00:00:00.000Z`);
  return Math.round((timestamp - Date.UTC(1899, 11, 30)) / 86_400_000);
}
