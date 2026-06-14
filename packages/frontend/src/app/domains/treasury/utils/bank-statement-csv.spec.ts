import { parseBankStatementCsv } from './bank-statement-csv';

describe('parseBankStatementCsv', () => {
  it('parses valid statement lines with default currency', () => {
    const result = parseBankStatementCsv(
      [
        '2026-01-15,REF-1,Customer receipt,1000,XOF',
        '2026-01-16,,Bank fee,-250,'
      ].join('\n')
    );

    expect(result.errors).toEqual([]);
    expect(result.lines).toEqual([
      {
        date: '2026-01-15',
        reference: 'REF-1',
        label: 'Customer receipt',
        amount: 1000,
        currency: 'XOF'
      },
      {
        date: '2026-01-16',
        label: 'Bank fee',
        amount: -250,
        currency: 'XOF'
      }
    ]);
  });

  it('reports row-level validation errors', () => {
    const result = parseBankStatementCsv('15/01/2026,REF-1,,abc,XOF');

    expect(result.lines).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].index).toBe(0);
  });
});
