import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../../environments/environment';
import { AccountingApi } from './accounting.api';

describe('AccountingApi', () => {
  let api: AccountingApi;
  let httpMock: HttpTestingController;
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AccountingApi, provideHttpClient(), provideHttpClientTesting()]
    });

    api = TestBed.inject(AccountingApi);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('validates and maps account list responses without DynamoDB keys', async () => {
    const promise = api.listAccounts({ limit: 50 });
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/accounts`);

    expect(request.request.params.get('limit')).toBe('50');
    request.flush({
      data: {
        accounts: [
          {
            accountId: '41100000',
            accountName: 'Clients',
            accountNature: 'BALANCE',
            accountUsage: 'BOTH',
            isThirdPartyAccount: true,
            classCode: 4,
            financialStatementCode: 'BS',
            allowReconciliation: true,
            PK: 'ORG#test'
          }
        ],
        hasMore: false
      }
    });

    await expect(promise).resolves.toEqual({
      items: [
        {
          accountId: '41100000',
          accountName: 'Clients',
          accountNature: 'BALANCE',
          accountUsage: 'BOTH',
          isThirdPartyAccount: true,
          classCode: 4,
          financialStatementCode: 'BS',
          allowReconciliation: true
        }
      ],
      hasMore: false
    });
  });

  it('rejects invalid entry list responses', async () => {
    const promise = api.listEntries({ year: '2026' });
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/entries`);

    request.flush({ data: { entries: [{ entryId: 'E-1' }], hasMore: false } });

    await expect(promise).rejects.toThrow();
  });

  it('posts validated entries and returns the entry id', async () => {
    const promise = api.postEntry({
      year: 2026,
      accountingFramework: 'SYSCOHADA_REVISED',
      entryDate: '2026-01-15',
      journalCode: 'MISC',
      entryType: 'STANDARD',
      label: 'Posting test',
      lines: [
        { accountId: '41100000', debit: 1000, credit: 0 },
        { accountId: '70100000', debit: 0, credit: 1000 }
      ]
    });
    const request = httpMock.expectOne(`${apiBaseUrl}/entries`);

    expect(request.request.method).toBe('POST');
    request.flush({ entryId: 'E-123' });

    await expect(promise).resolves.toBe('E-123');
  });
});
