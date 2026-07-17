import { parseBankStatementCsv } from './bank-statement-csv';

describe('parseBankStatementCsv', () => {
  it('parses valid statement lines with default currency', () => {
    const result = parseBankStatementCsv(
      [
        'statementDate,reference,description,amount,direction,currency',
        '2026-01-15,REF-1,Customer receipt,1000,INFLOW,XOF',
        '2026-01-16,,Bank fee,250,OUTFLOW,'
      ].join('\n')
    );

    expect(result.errors).toEqual([]);
    expect(result.lines).toEqual([
      expect.objectContaining({
        statementDate: '2026-01-15',
        reference: 'REF-1',
        description: 'Customer receipt',
        amount: 1000,
        direction: 'INFLOW',
        currency: 'XOF'
      }),
      expect.objectContaining({
        statementDate: '2026-01-16',
        description: 'Bank fee',
        amount: 250,
        direction: 'OUTFLOW',
        currency: 'XOF'
      })
    ]);
  });

  it('reports row-level validation errors', () => {
    const result = parseBankStatementCsv('statementDate,reference,description,amount,direction,currency\n15/01/2026,REF-1,,abc,INFLOW,XOF');

    expect(result.lines).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].index).toBe(1);
  });
});
