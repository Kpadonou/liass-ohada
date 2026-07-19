import { describe, expect, it } from 'vitest';

import {
  BANK_STATEMENT_TEMPLATE_HEADERS,
  BANK_STATEMENT_TEMPLATE_INSTRUCTIONS_SHEET_NAME,
  BANK_STATEMENT_TEMPLATE_SHEET_NAME,
  createBankStatementTemplateWorkbook
} from './bank-statement-template';
import { parseBankStatementFile } from './bank-statement-import';

describe('bank statement import template', () => {
  it('generates the expected workbook sheets and French user-facing headers', async () => {
    const workbook = await createBankStatementTemplateWorkbook();
    const statementSheet = workbook.getWorksheet(BANK_STATEMENT_TEMPLATE_SHEET_NAME);

    expect(statementSheet).toBeDefined();
    expect(workbook.getWorksheet(BANK_STATEMENT_TEMPLATE_INSTRUCTIONS_SHEET_NAME)).toBeDefined();
    expect(statementSheet?.getRow(1).values).toEqual([
      undefined,
      ...BANK_STATEMENT_TEMPLATE_HEADERS
    ]);
    expect(statementSheet?.views).toEqual([{ state: 'frozen', ySplit: 1 }]);
  });

  it('includes example French inflow and outflow rows', async () => {
    const workbook = await createBankStatementTemplateWorkbook();
    const statementSheet = workbook.getWorksheet(BANK_STATEMENT_TEMPLATE_SHEET_NAME);

    expect(statementSheet?.getRow(2).values).toEqual([
      undefined,
      '2026-01-15',
      '2026-01-15',
      'VIR-001',
      'Encaissement client',
      150000,
      'Entrée',
      'XOF',
      'BANK-2026-001'
    ]);
    expect(statementSheet?.getRow(3).values).toEqual([
      undefined,
      '2026-01-16',
      '2026-01-16',
      'FRAIS-001',
      'Frais bancaires',
      2500,
      'Sortie',
      'XOF',
      'BANK-2026-002'
    ]);
    expect(statementSheet?.getCell('F2').dataValidation).toEqual(
      expect.objectContaining({
        type: 'list',
        formulae: ['"Entrée,Sortie"']
      })
    );
  });

  it('includes French instructions and a model-to-system correspondence table', async () => {
    const workbook = await createBankStatementTemplateWorkbook();
    const instructionsSheet = workbook.getWorksheet(BANK_STATEMENT_TEMPLATE_INSTRUCTIONS_SHEET_NAME);

    expect(instructionsSheet?.getCell('A1').value).toBe('Instructions');
    expect(instructionsSheet?.getColumn(1).values).toContain('Les colonnes marquées par * sont obligatoires.');
    expect(instructionsSheet?.getColumn(1).values).toContain('Colonne du modèle');
    expect(instructionsSheet?.getColumn(3).values).toContain('statementDate');
    expect(instructionsSheet?.getColumn(3).values).toContain('externalId');
  });

  it('generates example rows that the parser converts to canonical backend fields', async () => {
    const workbook = await createBankStatementTemplateWorkbook();
    const buffer = await workbook.xlsx.writeBuffer();
    const file = new File([buffer], 'modele.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const preview = await parseBankStatementFile(file);

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
});
