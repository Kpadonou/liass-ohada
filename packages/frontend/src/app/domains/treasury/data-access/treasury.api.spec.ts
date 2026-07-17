import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../../environments/environment';
import { TreasuryApi } from './treasury.api';

describe('TreasuryApi', () => {
  let api: TreasuryApi;
  let httpMock: HttpTestingController;
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TreasuryApi, provideHttpClient(), provideHttpClientTesting()]
    });

    api = TestBed.inject(TreasuryApi);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('validates and maps treasury accounts without DynamoDB keys', async () => {
    const promise = api.listAccounts();
    const request = httpMock.expectOne(`${apiBaseUrl}/treasury/accounts`);

    request.flush({
      data: {
        count: 1,
        hasMore: false,
        accounts: [
          {
            orgId: 'test-org',
            treasuryAccountId: '52100000',
            accountId: '52100000',
            label: 'Main bank',
            type: 'BANK',
            currency: 'XOF',
            openingBalance: 0,
            active: true,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            PK: 'ORG#test-org',
            SK: 'TRS#ACC#52100000'
          }
        ]
      }
    });

    await expect(promise).resolves.toEqual({
      accounts: [
        {
          orgId: 'test-org',
          treasuryAccountId: '52100000',
          accountId: '52100000',
          label: 'Main bank',
          type: 'BANK',
          currency: 'XOF',
          openingBalance: 0,
          active: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z'
        }
      ],
      count: 1,
      hasMore: false,
      nextCursor: undefined
    });
  });

  it('rejects invalid movement responses', async () => {
    const promise = api.listMovements('52100000', '2026');
    const request = httpMock.expectOne((candidate) =>
      candidate.url === `${apiBaseUrl}/treasury/accounts/52100000/movements`
    );

    expect(request.request.params.get('year')).toBe('2026');
    request.flush({ data: { movements: [{ entryId: 'E-1' }] } });

    await expect(promise).rejects.toThrow();
  });

  it('posts treasury transactions and returns the entry id', async () => {
    const promise = api.postTransaction({
      treasuryAccountId: '52100000',
      year: 2026,
      entryDate: '2026-01-15',
      journalCode: 'BANK',
      direction: 'INFLOW',
      amount: 1000,
      counterpartyAccountId: '41100000',
      label: 'Customer receipt'
    });
    const request = httpMock.expectOne(`${apiBaseUrl}/treasury/transactions`);

    expect(request.request.method).toBe('POST');
    expect(request.request.body.lines).toBeUndefined();
    request.flush({ data: { entryId: 'E-123' } });

    await expect(promise).resolves.toBe('E-123');
  });

  it('imports parsed statement lines through the account route', async () => {
    const promise = api.importStatementLines('52100000', {
      year: '2026',
      lines: [
        {
          statementDate: '2026-01-15',
          reference: 'REF-1',
          description: 'Bank credit',
          amount: 1000,
          direction: 'INFLOW',
          currency: 'XOF'
        }
      ]
    });
    const request = httpMock.expectOne(
      `${apiBaseUrl}/treasury/accounts/52100000/statement-lines/import`
    );

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      year: '2026',
      lines: [
        {
          statementDate: '2026-01-15',
          reference: 'REF-1',
          description: 'Bank credit',
          amount: 1000,
          direction: 'INFLOW',
          currency: 'XOF'
        }
      ]
    });
    request.flush({
      data: {
        imported: 1,
        skipped: 0,
        errors: [],
        statementLines: [
          {
            treasuryAccountId: '52100000',
            statementLineId: 'stmt-1',
            year: '2026',
            statementDate: '2026-01-15',
            date: '2026-01-15',
            reference: 'REF-1',
            description: 'Bank credit',
            label: 'Bank credit',
            amount: 1000,
            direction: 'INFLOW',
            currency: 'XOF',
            status: 'UNMATCHED',
            importedAt: '2026-01-15T00:00:00Z'
          }
        ]
      }
    });

    await expect(promise).resolves.toMatchObject({
      imported: 1,
      skipped: 0,
      errors: []
    });
  });

  it('lists statement lines with filters and pagination metadata', async () => {
    const promise = api.listStatementLines('52100000', {
      year: '2026',
      limit: 25,
      cursor: 'cursor-1',
      status: 'UNMATCHED',
      direction: 'INFLOW',
      startDate: '2026-01-01',
      endDate: '2026-01-31'
    });
    const request = httpMock.expectOne((candidate) =>
      candidate.url === `${apiBaseUrl}/treasury/accounts/52100000/statement-lines`
    );

    expect(request.request.params.get('year')).toBe('2026');
    expect(request.request.params.get('limit')).toBe('25');
    expect(request.request.params.get('cursor')).toBe('cursor-1');
    expect(request.request.params.get('status')).toBe('UNMATCHED');
    expect(request.request.params.get('direction')).toBe('INFLOW');
    expect(request.request.params.get('startDate')).toBe('2026-01-01');
    expect(request.request.params.get('endDate')).toBe('2026-01-31');
    request.flush({
      data: {
        statementLines: [
          {
            treasuryAccountId: '52100000',
            statementLineId: 'stmt-1',
            year: '2026',
            statementDate: '2026-01-15',
            date: '2026-01-15',
            reference: 'REF-1',
            description: 'Customer receipt',
            label: 'Customer receipt',
            amount: 1000,
            direction: 'INFLOW',
            currency: 'XOF',
            status: 'UNMATCHED',
            importedAt: '2026-01-15T00:00:00Z'
          }
        ],
        nextCursor: 'cursor-2',
        hasMore: true,
        count: 10
      }
    });

    await expect(promise).resolves.toMatchObject({
      count: 10,
      hasMore: true,
      nextCursor: 'cursor-2',
      statementLines: [expect.objectContaining({ statementLineId: 'stmt-1' })]
    });
  });

  it('creates reconciliations with statement date and movement line id', async () => {
    const promise = api.reconcile({
      treasuryAccountId: '52100000',
      year: '2026',
      statementLineId: 'stmt-1',
      statementDate: '2026-01-15',
      movementLineId: 'line-1'
    });
    const request = httpMock.expectOne(`${apiBaseUrl}/treasury/reconciliations`);

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      treasuryAccountId: '52100000',
      year: '2026',
      statementLineId: 'stmt-1',
      statementDate: '2026-01-15',
      movementLineId: 'line-1'
    });
    request.flush({ data: reconciliationFixture() });

    await expect(promise).resolves.toMatchObject({ matchId: 'match-1' });
  });

  it('lists reconciliation matches with filters and pagination metadata', async () => {
    const promise = api.listReconciliationMatches({
      treasuryAccountId: '52100000',
      year: '2026',
      status: 'ACTIVE',
      limit: 25,
      cursor: 'cursor-1'
    });
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/treasury/reconciliations`);

    expect(request.request.params.get('treasuryAccountId')).toBe('52100000');
    expect(request.request.params.get('year')).toBe('2026');
    expect(request.request.params.get('status')).toBe('ACTIVE');
    expect(request.request.params.get('limit')).toBe('25');
    expect(request.request.params.get('cursor')).toBe('cursor-1');
    request.flush({
      data: {
        matches: [reconciliationFixture()],
        nextCursor: 'cursor-2',
        hasMore: true,
        count: 3
      }
    });

    await expect(promise).resolves.toMatchObject({
      count: 3,
      hasMore: true,
      nextCursor: 'cursor-2',
      matches: [expect.objectContaining({ matchId: 'match-1' })]
    });
  });

  it('cancels reconciliation matches with an optional reason', async () => {
    const promise = api.cancelReconciliation({
      treasuryAccountId: '52100000',
      year: '2026',
      matchId: 'match-1',
      cancelReason: 'Imported twice'
    });
    const request = httpMock.expectOne(`${apiBaseUrl}/treasury/reconciliations/match-1/cancel`);

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      treasuryAccountId: '52100000',
      year: '2026',
      matchId: 'match-1',
      cancelReason: 'Imported twice'
    });
    request.flush({ data: { ...reconciliationFixture(), status: 'CANCELLED' } });

    await expect(promise).resolves.toMatchObject({ matchId: 'match-1', status: 'CANCELLED' });
  });
});

function reconciliationFixture() {
  return {
    treasuryAccountId: '52100000',
    matchId: 'match-1',
    year: '2026',
    statementLineId: 'stmt-1',
    statementDate: '2026-01-15',
    movementLineId: 'line-1',
    amount: 1000,
    direction: 'INFLOW',
    status: 'ACTIVE',
    matchedAt: '2026-01-16T00:00:00Z',
    matchedBy: 'user-1',
    statementReference: 'REF-1',
    statementDescription: 'Customer receipt'
  };
}
