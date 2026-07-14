import {
  CreateTreasuryAccountRequestSchema,
  CreateTreasuryTransactionRequestSchema,
  ImportBankStatementRequestSchema
} from '@liass-ohada/shared/treasury';

describe('treasury form validation schemas', () => {
  it('validates treasury account creation payloads', () => {
    expect(() =>
      CreateTreasuryAccountRequestSchema.parse({
        accountId: '52100000',
        label: 'Main bank',
        type: 'BANK',
        currency: 'XOF'
      })
    ).not.toThrow();

    expect(
      CreateTreasuryAccountRequestSchema.parse({
        accountId: '41100000',
        label: 'Customer account',
        type: 'BANK',
        currency: 'XOF'
      })
    ).toMatchObject({ accountId: '41100000' });
  });

  it('validates balanced treasury operation inputs before posting', () => {
    expect(() =>
      CreateTreasuryTransactionRequestSchema.parse({
        treasuryAccountId: '52100000',
        year: 2026,
        entryDate: '2026-01-15',
        journalCode: 'BANK',
        direction: 'OUTFLOW',
        amount: 1000,
        counterpartyAccountId: '60600000',
        label: 'Bank payment'
      })
    ).not.toThrow();

    expect(() =>
      CreateTreasuryTransactionRequestSchema.parse({
        treasuryAccountId: '52100000',
        year: 2026,
        entryDate: '2026-01-15',
        journalCode: 'BANK',
        direction: 'OUTFLOW',
        amount: -1000,
        counterpartyAccountId: '60600000',
        label: 'Bank payment'
      })
    ).toThrow();
  });

  it('validates imported bank statement payloads', () => {
    expect(() =>
      ImportBankStatementRequestSchema.parse({
        year: '2026',
        lines: [
          {
            statementDate: '2026-01-15',
            reference: 'REF-1',
            description: 'Customer receipt',
            amount: 1000,
            direction: 'INFLOW',
            currency: 'XOF'
          }
        ]
      })
    ).not.toThrow();

    expect(() =>
      ImportBankStatementRequestSchema.parse({
        year: '26',
        lines: []
      })
    ).toThrow();
  });
});
