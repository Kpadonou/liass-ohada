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

  it('gets, creates, updates, and disables accounts with shared DTO validation', async () => {
    const getPromise = api.getAccount('41100000');
    const getRequest = httpMock.expectOne(`${apiBaseUrl}/accounts/41100000`);

    expect(getRequest.request.method).toBe('GET');
    getRequest.flush({ account: accountResponseFixture() });

    await expect(getPromise).resolves.toMatchObject({
      accountId: '41100000',
      accountName: 'Clients'
    });

    const createPayload = {
      accountId: '411',
      accountName: 'Clients auxiliaires',
      accountNature: 'BALANCE' as const,
      accountUsage: 'BOTH' as const,
      isThirdPartyAccount: true,
      classCode: 4,
      financialStatementCode: 'BS',
      allowReconciliation: true
    };
    const createPromise = api.createAccount(createPayload);
    const createRequest = httpMock.expectOne(`${apiBaseUrl}/accounts`);

    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.body).toEqual(createPayload);
    createRequest.flush({
      account: accountResponseFixture({
        accountId: '41100000',
        accountName: 'Clients auxiliaires'
      })
    });

    await expect(createPromise).resolves.toMatchObject({
      accountId: '41100000',
      accountName: 'Clients auxiliaires'
    });

    const updatePromise = api.updateAccount('41100000', {
      accountName: 'Clients et comptes rattachés',
      allowReconciliation: true
    });
    const updateRequest = httpMock.expectOne(`${apiBaseUrl}/accounts/41100000`);

    expect(updateRequest.request.method).toBe('PUT');
    expect(updateRequest.request.body).toEqual({
      accountName: 'Clients et comptes rattachés',
      allowReconciliation: true
    });
    updateRequest.flush({
      account: accountResponseFixture({
        accountName: 'Clients et comptes rattachés'
      })
    });

    await expect(updatePromise).resolves.toMatchObject({
      accountName: 'Clients et comptes rattachés'
    });

    const disablePromise = api.disableAccount('41100000');
    const disableRequest = httpMock.expectOne(`${apiBaseUrl}/accounts/41100000`);

    expect(disableRequest.request.method).toBe('DELETE');
    disableRequest.flush({ account: accountResponseFixture() });

    await expect(disablePromise).resolves.toMatchObject({
      accountId: '41100000'
    });
  });

  it('rejects invalid account payloads and invalid account responses', async () => {
    await expect(
      api.createAccount({
        accountId: '411',
        accountName: 'Clients',
        accountNature: 'INVALID' as never,
        accountUsage: 'BOTH',
        isThirdPartyAccount: true,
        classCode: 4,
        financialStatementCode: 'BS',
        allowReconciliation: true
      })
    ).rejects.toThrow();
    httpMock.expectNone(`${apiBaseUrl}/accounts`);

    await expect(api.updateAccount('41100000', {})).rejects.toThrow();
    httpMock.expectNone(`${apiBaseUrl}/accounts/41100000`);

    const getPromise = api.getAccount('41100000');
    const getRequest = httpMock.expectOne(`${apiBaseUrl}/accounts/41100000`);

    getRequest.flush({
      account: accountResponseFixture({
        accountId: '411'
      })
    });

    await expect(getPromise).rejects.toThrow();
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

  it('creates fiscal years and maps frontend-safe responses', async () => {
    const promise = api.createFiscalYear({
      year: 2026,
      accountingFramework: 'SYSCOHADA_REVISED'
    });
    const request = httpMock.expectOne(`${apiBaseUrl}/fiscal-year`);

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      year: 2026,
      accountingFramework: 'SYSCOHADA_REVISED'
    });
    request.flush({
      data: {
        orgId: 'org-test',
        year: 2026,
        fiscalYearId: 'FY#2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        status: 'OPEN',
        accountingFramework: 'SYSCOHADA_REVISED',
        PK: 'ORG#test',
        SK: 'FY#2026'
      }
    });

    await expect(promise).resolves.toEqual({
      orgId: 'org-test',
      year: 2026,
      fiscalYearId: 'FY#2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'OPEN',
      accountingFramework: 'SYSCOHADA_REVISED'
    });
  });

  it('loads fiscal year details and updates period locks through backend routes', async () => {
    const detailsPromise = api.getFiscalYearDetails(2026);
    const detailsRequest = httpMock.expectOne(`${apiBaseUrl}/fiscal-year/2026`);

    expect(detailsRequest.request.method).toBe('GET');
    detailsRequest.flush({
      data: {
        year: 2026,
        fiscalYearId: 'FY#2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        status: 'OPEN',
        accountingFramework: 'SYSCOHADA_REVISED',
        periodLocks: { '01': 'LOCKED' }
      }
    });

    await expect(detailsPromise).resolves.toMatchObject({
      year: 2026,
      periodLocks: { '01': 'LOCKED' }
    });

    const lockPromise = api.lockPeriod(2026, 2);
    const lockRequest = httpMock.expectOne(`${apiBaseUrl}/fiscal-year/2026/lock`);

    expect(lockRequest.request.method).toBe('POST');
    expect(lockRequest.request.body).toEqual({ year: 2026, month: 2, status: 'LOCKED' });
    lockRequest.flush({
      data: {
        year: 2026,
        month: '02',
        status: 'LOCKED'
      }
    });

    await expect(lockPromise).resolves.toMatchObject({ month: '02', status: 'LOCKED' });

    const unlockPromise = api.unlockPeriod(2026, 2);
    const unlockRequest = httpMock.expectOne(`${apiBaseUrl}/fiscal-year/2026/unlock`);

    expect(unlockRequest.request.method).toBe('POST');
    expect(unlockRequest.request.body).toEqual({ year: 2026, month: 2 });
    unlockRequest.flush({
      data: {
        year: 2026,
        month: '02',
        status: 'OPEN'
      }
    });

    await expect(unlockPromise).resolves.toMatchObject({ month: '02', status: 'OPEN' });
  });

  it('closes fiscal years and loads income statement aggregates', async () => {
    const closePromise = api.closeFiscalYear(2026);
    const closeRequest = httpMock.expectOne(`${apiBaseUrl}/fiscal-year/2026/close`);

    expect(closeRequest.request.method).toBe('POST');
    expect(closeRequest.request.body).toEqual({ year: '2026' });
    closeRequest.flush({
      data: {
        entryId: 'E-CLOSE',
        netResult: 120000,
        isProfit: true
      }
    });

    await expect(closePromise).resolves.toEqual({
      entryId: 'E-CLOSE',
      netResult: 120000,
      isProfit: true
    });

    const statementPromise = api.getIncomeStatement(2026);
    const statementRequest = httpMock.expectOne(
      (candidate) => candidate.url === `${apiBaseUrl}/reports/income-statement`
    );

    expect(statementRequest.request.params.get('year')).toBe('2026');
    statementRequest.flush({
      data: {
        fiscalYear: '2026',
        totalRevenue: 200000,
        totalExpenses: 80000,
        netResult: 120000,
        performanceStatus: 'PROFIT',
        statementBasis: 'BACKEND_V1_CLASS_6_7_AGGREGATE'
      }
    });

    await expect(statementPromise).resolves.toMatchObject({
      fiscalYear: '2026',
      netResult: 120000
    });
  });

  it('loads third-party ledger, matching report, and unlettered suggestions', async () => {
    const ledgerPromise = api.getThirdPartyLedger({
      accountId: '41100000',
      thirdPartyId: 'CUST-1',
      startDate: '2026-01-01',
      endDate: '2026-12-31'
    });
    const ledgerRequest = httpMock.expectOne(
      (candidate) => candidate.url === `${apiBaseUrl}/books/third-party-ledger`
    );

    expect(ledgerRequest.request.params.get('accountId')).toBe('41100000');
    expect(ledgerRequest.request.params.get('thirdPartyId')).toBe('CUST-1');
    ledgerRequest.flush({
      data: {
        accountId: '41100000',
        thirdPartyId: 'CUST-1',
        period: { startDate: '2026-01-01', endDate: '2026-12-31' },
        summary: { totalDebit: 1000, totalCredit: 300, balance: 700 },
        count: 1,
        lines: [
          {
            date: '2026-01-15',
            label: 'Invoice',
            debit: 1000,
            credit: 0,
            letteringCode: null,
            entryId: 'E-1',
            lineId: 'L-1'
          }
        ]
      }
    });

    await expect(ledgerPromise).resolves.toMatchObject({ thirdPartyId: 'CUST-1', count: 1 });

    const reportPromise = api.getMatchingReport({
      accountId: '41100000',
      thirdPartyId: 'CUST-1'
    });
    const reportRequest = httpMock.expectOne(
      (candidate) => candidate.url === `${apiBaseUrl}/books/matching-report`
    );

    reportRequest.flush({
      data: {
        accountId: '41100000',
        thirdPartyId: 'CUST-1',
        summary: { totalDebit: 1000, totalCredit: 1000, balance: 0 },
        letteredGroups: {
          LET001: [
            {
              entryId: 'E-1',
              lineId: 'L-1',
              accountId: '41100000',
              debit: 1000,
              credit: 0,
              entryDate: '2026-01-15',
              createdAt: '2026-01-15T00:00:00.000Z'
            }
          ]
        },
        unletteredLines: []
      }
    });

    await expect(reportPromise).resolves.toMatchObject({ accountId: '41100000' });

    const unletteredPromise = api.getUnletteredLines({
      accountId: '41100000',
      thirdPartyId: 'CUST-1'
    });
    const unletteredRequest = httpMock.expectOne(
      (candidate) => candidate.url === `${apiBaseUrl}/lettering/unlettered`
    );

    unletteredRequest.flush({
      totalUnlettered: 2,
      suggestionsFound: 1,
      unletteredLines: [
        {
          entryId: 'E-1',
          lineId: 'L-1',
          accountId: '41100000',
          debit: 1000,
          credit: 0,
          entryDate: '2026-01-15',
          createdAt: '2026-01-15T00:00:00.000Z',
          PK: 'ORG#test'
        }
      ],
      suggestions: [
        {
          type: 'PERFECT_MATCH',
          amount: 1000,
          lines: [
            {
              lineId: 'L-1',
              entryId: 'E-1',
              date: '2026-01-15',
              amount: 1000,
              type: 'DEBIT'
            },
            {
              lineId: 'L-2',
              entryId: 'E-2',
              date: '2026-01-16',
              amount: 1000,
              type: 'CREDIT'
            }
          ]
        }
      ]
    });

    await expect(unletteredPromise).resolves.toMatchObject({
      totalUnlettered: 2,
      suggestionsFound: 1
    });
  });

  it('posts and cancels lettering using business line references', async () => {
    const payload = {
      accountId: '41100000',
      thirdPartyId: 'CUST-1',
      letteringCode: 'LET001',
      lines: [
        { year: 2026, entryId: 'E-1', lineId: 'L-1' },
        { year: 2026, entryId: 'E-2', lineId: 'L-2' }
      ]
    };
    const postPromise = api.postLettering(payload);
    const postRequest = httpMock.expectOne(`${apiBaseUrl}/lettering`);

    expect(postRequest.request.method).toBe('POST');
    expect(postRequest.request.body).toEqual(payload);
    postRequest.flush({
      letteringCode: 'LET001',
      letteringStatus: 'COMPLETE',
      linesProcessed: 2
    });

    await expect(postPromise).resolves.toMatchObject({
      letteringCode: 'LET001',
      letteringStatus: 'COMPLETE'
    });

    const cancelPayload = {
      accountId: '41100000',
      thirdPartyId: 'CUST-1',
      lines: [{ year: 2026, entryId: 'E-1', lineId: 'L-1' }]
    };
    const cancelPromise = api.cancelLettering(cancelPayload);
    const cancelRequest = httpMock.expectOne(`${apiBaseUrl}/lettering/cancel`);

    expect(cancelRequest.request.method).toBe('POST');
    expect(cancelRequest.request.body).toEqual(cancelPayload);
    cancelRequest.flush({
      linesProcessed: 1
    });

    await expect(cancelPromise).resolves.toMatchObject({ linesProcessed: 1 });
  });

  it('rejects invalid matching and unlettered responses', async () => {
    const reportPromise = api.getMatchingReport({
      accountId: '41100000',
      thirdPartyId: 'CUST-1'
    });
    const reportRequest = httpMock.expectOne(
      (candidate) => candidate.url === `${apiBaseUrl}/books/matching-report`
    );

    reportRequest.flush({ data: { accountId: '41100000' } });

    await expect(reportPromise).rejects.toThrow();

    const unletteredPromise = api.getUnletteredLines({
      accountId: '41100000',
      thirdPartyId: 'CUST-1'
    });
    const unletteredRequest = httpMock.expectOne(
      (candidate) => candidate.url === `${apiBaseUrl}/lettering/unlettered`
    );

    unletteredRequest.flush({ unletteredLines: [] });

    await expect(unletteredPromise).rejects.toThrow();
  });
});

function accountResponseFixture(
  overrides: Partial<{
    accountId: string;
    accountName: string;
    accountNature: 'BALANCE' | 'INCOME';
    accountUsage: 'DEBIT_ONLY' | 'CREDIT_ONLY' | 'BOTH';
    isThirdPartyAccount: boolean;
    classCode: number;
    financialStatementCode: string;
    allowReconciliation: boolean;
  }> = {}
) {
  return {
    accountId: '41100000',
    accountName: 'Clients',
    accountNature: 'BALANCE',
    accountUsage: 'BOTH',
    isThirdPartyAccount: true,
    classCode: 4,
    financialStatementCode: 'BS',
    allowReconciliation: true,
    PK: 'ORG#test',
    SK: 'ACC#41100000',
    ...overrides
  };
}
