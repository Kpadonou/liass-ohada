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

    await expect(promise).resolves.toEqual([
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
    ]);
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
          date: '2026-01-15',
          reference: 'REF-1',
          label: 'Bank credit',
          amount: 1000,
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
          date: '2026-01-15',
          reference: 'REF-1',
          label: 'Bank credit',
          amount: 1000,
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
            date: '2026-01-15',
            reference: 'REF-1',
            label: 'Bank credit',
            amount: 1000,
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
});
