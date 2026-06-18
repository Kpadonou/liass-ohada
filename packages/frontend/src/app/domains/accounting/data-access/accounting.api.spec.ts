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
            isActive: true,
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
          allowReconciliation: true,
          isActive: true
        }
      ],
      hasMore: false
    });
  });

  it('sends server-backed account search and pagination parameters', async () => {
    const promise = api.listAccounts({
      activeOnly: true,
      class: 4,
      cursor: 'next-page',
      limit: 20,
      search: '411'
    });
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/accounts`);

    expect(request.request.params.get('activeOnly')).toBe('true');
    expect(request.request.params.get('class')).toBe('4');
    expect(request.request.params.get('cursor')).toBe('next-page');
    expect(request.request.params.get('limit')).toBe('20');
    expect(request.request.params.get('search')).toBe('411');

    request.flush({
      data: {
        accounts: [],
        hasMore: false
      }
    });

    await expect(promise).resolves.toEqual({
      items: [],
      hasMore: false
    });
  });

  it('accepts the legacy account-list response when pagination flags are omitted', async () => {
    const promise = api.listAccounts({ limit: 20, search: '22' });
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/accounts`);

    request.flush({
      data: {
        accounts: [
          accountResponseFixture({
            accountId: '22000000',
            accountName: 'Terrains'
          })
        ]
      }
    });

    await expect(promise).resolves.toMatchObject({
      items: [
        {
          accountId: '22000000',
          accountName: 'Terrains'
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
      message: 'Compte créé avec succès.',
      account: accountResponseFixture({
        accountId: '41100000',
        accountName: 'Clients auxiliaires'
      })
    });

    await expect(createPromise).resolves.toMatchObject({
      data: {
        accountId: '41100000',
        accountName: 'Clients auxiliaires'
      },
      message: 'Compte créé avec succès.'
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
      message: 'Compte mis à jour avec succès.',
      account: accountResponseFixture({
        accountName: 'Clients et comptes rattachés'
      })
    });

    await expect(updatePromise).resolves.toMatchObject({
      data: {
        accountName: 'Clients et comptes rattachés'
      },
      message: 'Compte mis à jour avec succès.'
    });

    const disablePromise = api.disableAccount('41100000');
    const disableRequest = httpMock.expectOne(`${apiBaseUrl}/accounts/41100000`);

    expect(disableRequest.request.method).toBe('DELETE');
    disableRequest.flush({
      message: 'Compte désactivé avec succès.',
      account: accountResponseFixture({ isActive: false })
    });

    await expect(disablePromise).resolves.toMatchObject({
      data: {
        accountId: '41100000',
        isActive: false
      },
      message: 'Compte désactivé avec succès.'
    });
  });

  it('lists, gets, creates, updates, and disables journals with typed validation', async () => {
    const listPromise = api.listJournals();
    const listRequest = httpMock.expectOne(`${apiBaseUrl}/journals`);

    expect(listRequest.request.method).toBe('GET');
    listRequest.flush({
      data: [
        journalResponseFixture({
          journalCode: 'VE',
          journalName: 'Ventes',
          type: 'SALE',
          PK: 'ORG#test'
        })
      ]
    });

    await expect(listPromise).resolves.toEqual([
      {
        journalCode: 'VE',
        journalName: 'Ventes',
        type: 'SALE',
        year: 2026
      }
    ]);

    const getPromise = api.getJournal('VE');
    const getRequest = httpMock.expectOne(`${apiBaseUrl}/journals/VE`);

    expect(getRequest.request.method).toBe('GET');
    getRequest.flush({ data: journalResponseFixture({ journalCode: 'VE' }) });

    await expect(getPromise).resolves.toMatchObject({
      journalCode: 'VE'
    });

    const createPayload = {
      year: 2026,
      journalCode: 'AC',
      journalName: 'Achats',
      type: 'PURCHASE' as const
    };
    const createPromise = api.createJournal(createPayload);
    const createRequest = httpMock.expectOne(`${apiBaseUrl}/journals`);

    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.body).toEqual(createPayload);
    createRequest.flush({
      message: 'Journal créé avec succès.',
      data: journalResponseFixture({
        journalCode: 'AC',
        journalName: 'Achats',
        type: 'PURCHASE'
      })
    });

    await expect(createPromise).resolves.toMatchObject({
      data: {
        journalCode: 'AC',
        journalName: 'Achats',
        type: 'PURCHASE'
      },
      message: 'Journal créé avec succès.'
    });

    const updatePromise = api.updateJournal('AC', {
      year: 2026,
      journalName: 'Achats fournisseurs',
      type: 'PURCHASE'
    });
    const updateRequest = httpMock.expectOne(`${apiBaseUrl}/journals/AC`);

    expect(updateRequest.request.method).toBe('PUT');
    expect(updateRequest.request.body).toEqual({
      year: 2026,
      journalName: 'Achats fournisseurs',
      type: 'PURCHASE'
    });
    updateRequest.flush({
      message: 'Journal mis à jour avec succès.',
      data: journalResponseFixture({
        journalCode: 'AC',
        journalName: 'Achats fournisseurs',
        type: 'PURCHASE'
      })
    });

    await expect(updatePromise).resolves.toMatchObject({
      data: {
        journalCode: 'AC',
        journalName: 'Achats fournisseurs'
      },
      message: 'Journal mis à jour avec succès.'
    });

    const disablePromise = api.disableJournal('AC');
    const disableRequest = httpMock.expectOne(`${apiBaseUrl}/journals/AC`);

    expect(disableRequest.request.method).toBe('DELETE');
    disableRequest.flush({ message: 'Journal désactivé avec succès.', data: {} });

    await expect(disablePromise).resolves.toEqual({
      data: undefined,
      message: 'Journal désactivé avec succès.'
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

  it('rejects invalid journal payloads and invalid journal responses', async () => {
    await expect(
      api.createJournal({
        year: 2026,
        journalCode: '',
        journalName: 'Ventes',
        type: 'SALE'
      })
    ).rejects.toThrow();
    httpMock.expectNone(`${apiBaseUrl}/journals`);

    await expect(
      api.updateJournal('VE', {
        journalName: '',
        type: 'SALE'
      })
    ).rejects.toThrow();
    httpMock.expectNone(`${apiBaseUrl}/journals/VE`);

    const getPromise = api.getJournal('VE');
    const getRequest = httpMock.expectOne(`${apiBaseUrl}/journals/VE`);

    getRequest.flush({ data: { journalCode: 'VE' } });

    await expect(getPromise).rejects.toThrow();

    const disablePromise = api.disableJournal('VE');
    const disableRequest = httpMock.expectOne(`${apiBaseUrl}/journals/VE`);

    disableRequest.flush({ data: null });

    await expect(disablePromise).rejects.toThrow();
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
    expect(request.request.body).not.toHaveProperty('accountingFramework');
    expect(request.request.body).not.toHaveProperty('orgId');
    request.flush({ entryId: 'E-123' });

    await expect(promise).resolves.toBe('E-123');
  });

  it('loads entry detail with validated frontend-safe DTOs', async () => {
    const promise = api.getEntryDetail('E-123', 2026);
    await settleDynamicImport();
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/entries/E-123`);

    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('year')).toBe('2026');
    request.flush({
      message: 'Entry retrieved.',
      data: entryDetailFixture()
    });

    await expect(promise).resolves.toMatchObject({
      entryId: 'E-123',
      lines: [
        {
          lineId: 'E-123#L1',
          accountId: '41100000',
          accountName: 'Clients'
        }
      ]
    });
  });

  it('creates, updates, deletes, and posts entry drafts with backend messages', async () => {
    const createPromise = api.createEntryDraft({
      year: 2026,
      entryDate: '2026-01-15',
      journalCode: 'OD',
      entryType: 'STANDARD',
      label: 'Draft sale',
      lines: [
        {
          accountId: '41100000',
          debit: 1000,
          credit: 0,
          PK: 'ORG#technical',
          entityType: 'ENTRY_LINE'
        } as any
      ],
      PK: 'ORG#technical',
      GSI1PK: 'GSI#technical',
      orgId: 'org-from-client',
      accountingFramework: 'SYCEBNL'
    } as any);
    await settleDynamicImport();
    const createRequest = httpMock.expectOne(`${apiBaseUrl}/entries/drafts`);

    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.body).toEqual({
      year: 2026,
      entryDate: '2026-01-15',
      journalCode: 'OD',
      entryType: 'STANDARD',
      label: 'Draft sale',
      lines: [{ accountId: '41100000', debit: 1000, credit: 0 }]
    });
    createRequest.flush({
      message: { code: 'SUCCESS_ENTRY_DRAFT_CREATED', message: 'Brouillon créé.' },
      data: entryDetailFixture({ status: 'DRAFT' })
    });

    await expect(createPromise).resolves.toMatchObject({
      data: { entryId: 'E-123', status: 'DRAFT' },
      message: 'Brouillon créé.'
    });

    const updatePromise = api.updateEntryDraft('E-123', {
      year: 2026,
      entryDate: '2026-01-16',
      journalCode: 'OD',
      entryType: 'STANDARD',
      label: 'Updated draft',
      lines: [{ accountId: '41100000', debit: 2000, credit: 0 }]
    });
    await settleDynamicImport();
    const updateRequest = httpMock.expectOne(`${apiBaseUrl}/entries/E-123/draft`);

    expect(updateRequest.request.method).toBe('PUT');
    expect(updateRequest.request.body).not.toHaveProperty('entryId');
    expect(updateRequest.request.body).not.toHaveProperty('PK');
    updateRequest.flush({
      message: 'Draft updated.',
      data: entryDetailFixture({ entryDate: '2026-01-16', totalDebit: 2000 })
    });

    await expect(updatePromise).resolves.toMatchObject({
      data: { entryDate: '2026-01-16' },
      message: 'Draft updated.'
    });

    const deletePromise = api.deleteEntryDraft('E-123', 2026);
    await settleDynamicImport();
    const deleteRequest = httpMock.expectOne(`${apiBaseUrl}/entries/E-123/draft`);

    expect(deleteRequest.request.method).toBe('DELETE');
    expect(deleteRequest.request.body).toEqual({ year: 2026 });
    deleteRequest.flush({
      message: 'Draft deleted.',
      entryId: 'E-123'
    });

    await expect(deletePromise).resolves.toEqual({
      data: 'E-123',
      message: 'Draft deleted.'
    });

    const postPromise = api.postEntryDraft('E-123', 2026);
    await settleDynamicImport();
    const postRequest = httpMock.expectOne(`${apiBaseUrl}/entries/E-123/post`);

    expect(postRequest.request.method).toBe('POST');
    expect(postRequest.request.body).toEqual({ year: 2026 });
    postRequest.flush({
      message: { code: 'SUCCESS_ENTRY_POSTED', message: 'Écriture comptabilisée.' },
      entryId: 'E-123'
    });

    await expect(postPromise).resolves.toEqual({
      data: 'E-123',
      message: 'Écriture comptabilisée.'
    });
  });

  it('rejects invalid entry detail responses', async () => {
    const promise = api.getEntryDetail('E-123', 2026);
    await settleDynamicImport();
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/entries/E-123`);

    request.flush({ data: { entryId: 'E-123', lines: [] } });

    await expect(promise).rejects.toThrow();
  });

  it('loads a paginated frontend-safe general ledger and preserves its backend message', async () => {
    const promise = api.getGeneralLedger({
      fiscalYear: '2026',
      accountId: '41100000',
      limit: 25,
      cursor: 'cursor-2'
    });
    const request = httpMock.expectOne(
      (candidate) => candidate.url === `${apiBaseUrl}/books/general-ledger`
    );

    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('fiscalYear')).toBe('2026');
    expect(request.request.params.get('accountId')).toBe('41100000');
    expect(request.request.params.get('limit')).toBe('25');
    expect(request.request.params.get('cursor')).toBe('cursor-2');
    request.flush({
      message: {
        code: 'SUCCESS_LEDGER_RETRIEVED',
        message: 'Grand livre récupéré.'
      },
      data: {
        PK: 'ORG#technical',
        accountId: '41100000',
        openingBalance: {
          GSI1PK: 'ORG#technical',
          date: 'OPENING',
          label: 'Report à nouveau',
          reference: 'RAN',
          journalCode: 'RAN',
          debit: 1000,
          credit: 0,
          runningBalance: 1000
        },
        movements: [
          {
            SK: 'L#technical',
            date: '2026-01-15',
            label: 'Facture client',
            reference: 'FV-001',
            journalCode: 'VE',
            entryId: 'E-001',
            lineId: 'L-001',
            debit: 500,
            credit: 0,
            runningBalance: 1500
          }
        ],
        finalBalance: 1500,
        nextCursor: 'cursor-3',
        hasMore: true
      }
    });

    await expect(promise).resolves.toEqual({
      accountId: '41100000',
      openingBalance: {
        date: 'OPENING',
        label: 'Report à nouveau',
        reference: 'RAN',
        journalCode: 'RAN',
        debit: 1000,
        credit: 0,
        runningBalance: 1000
      },
      movements: [
        {
          date: '2026-01-15',
          label: 'Facture client',
          reference: 'FV-001',
          journalCode: 'VE',
          entryId: 'E-001',
          lineId: 'L-001',
          debit: 500,
          credit: 0,
          runningBalance: 1500
        }
      ],
      finalBalance: 1500,
      nextCursor: 'cursor-3',
      hasMore: true,
      message: 'Grand livre récupéré.'
    });
  });

  it('validates the six-column trial balance and preserves the response message', async () => {
    const promise = api.getTrialBalance('2026');
    const request = httpMock.expectOne(
      (candidate) => candidate.url === `${apiBaseUrl}/books/trial-balance`
    );

    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('year')).toBe('2026');
    request.flush({
      message: 'Balance récupérée.',
      data: {
        rows: [
          {
            PK: 'ORG#technical',
            accountId: '41100000',
            openingDebit: 1000,
            openingCredit: 0,
            movementDebit: 500,
            movementCredit: 200,
            finalDebit: 1300,
            finalCredit: 0
          }
        ],
        totals: {
          openingDebit: 1000,
          openingCredit: 0,
          movementDebit: 500,
          movementCredit: 200,
          finalDebit: 1300,
          finalCredit: 0
        }
      }
    });

    await expect(promise).resolves.toEqual({
      rows: [
        {
          accountId: '41100000',
          openingDebit: 1000,
          openingCredit: 0,
          movementDebit: 500,
          movementCredit: 200,
          finalDebit: 1300,
          finalCredit: 0
        }
      ],
      totals: {
        openingDebit: 1000,
        openingCredit: 0,
        movementDebit: 500,
        movementCredit: 200,
        finalDebit: 1300,
        finalCredit: 0
      },
      message: 'Balance récupérée.'
    });
  });

  it('loads only a journal-specific paginated journal book', async () => {
    const promise = api.getJournalBook({
      year: '2026',
      journalCode: 'VE',
      month: '01',
      limit: 20,
      cursor: 'cursor-2'
    });
    const request = httpMock.expectOne(
      (candidate) => candidate.url === `${apiBaseUrl}/journals/VE/entries`
    );

    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('year')).toBe('2026');
    expect(request.request.params.get('month')).toBe('01');
    expect(request.request.params.get('limit')).toBe('20');
    expect(request.request.params.get('cursor')).toBe('cursor-2');
    request.flush({
      message: {
        code: 'SUCCESS_JOURNAL_RETRIEVED',
        message: 'Livre-journal récupéré.'
      },
      data: {
        meta: {
          year: '2026',
          journalCode: 'VE',
          month: '01'
        },
        entries: [
          {
            GSI5PK: 'ORG#technical',
            entityType: 'ENTRY',
            entryId: 'E-001',
            date: '2026-01-15',
            journalCode: 'VE',
            reference: 'FV-001',
            label: 'Vente',
            totalDebit: 125000,
            totalCredit: 125000,
            status: 'POSTED'
          }
        ],
        nextCursor: 'cursor-3',
        hasMore: true
      }
    });

    await expect(promise).resolves.toEqual({
      items: [
        {
          entryId: 'E-001',
          date: '2026-01-15',
          journalCode: 'VE',
          reference: 'FV-001',
          label: 'Vente',
          totalDebit: 125000,
          totalCredit: 125000,
          status: 'POSTED'
        }
      ],
      meta: {
        year: '2026',
        journalCode: 'VE',
        month: '01'
      },
      nextCursor: 'cursor-3',
      hasMore: true,
      message: 'Livre-journal récupéré.'
    });
  });

  it('rejects a global journal-book request before making an HTTP call', async () => {
    await expect(
      api.getJournalBook({
        year: '2026',
        journalCode: ''
      })
    ).rejects.toThrow();

    httpMock.expectNone((candidate) => candidate.url.includes('/journals/'));
  });

  it('creates fiscal years and maps frontend-safe responses', async () => {
    const promise = api.createFiscalYear({
      year: 2026
    });
    const request = httpMock.expectOne(`${apiBaseUrl}/fiscal-year`);

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      year: 2026
    });
    request.flush({
      message: 'Exercice créé avec succès.',
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
      data: {
        orgId: 'org-test',
        year: 2026,
        fiscalYearId: 'FY#2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        status: 'OPEN',
        accountingFramework: 'SYSCOHADA_REVISED'
      },
      message: 'Exercice créé avec succès.'
    });
  });

  it('rejects client-provided fiscal year accounting framework before posting', async () => {
    await expect(
      api.createFiscalYear({
        year: 2026,
        accountingFramework: 'SYCEBNL'
      } as never)
    ).rejects.toThrow();

    httpMock.expectNone(`${apiBaseUrl}/fiscal-year`);
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
      message: 'Période verrouillée.',
      data: {
        year: 2026,
        month: '02',
        status: 'LOCKED'
      }
    });

    await expect(lockPromise).resolves.toMatchObject({
      data: { month: '02', status: 'LOCKED' },
      message: 'Période verrouillée.'
    });

    const unlockPromise = api.unlockPeriod(2026, 2);
    const unlockRequest = httpMock.expectOne(`${apiBaseUrl}/fiscal-year/2026/unlock`);

    expect(unlockRequest.request.method).toBe('POST');
    expect(unlockRequest.request.body).toEqual({ year: 2026, month: 2 });
    unlockRequest.flush({
      message: 'Période déverrouillée.',
      data: {
        year: 2026,
        month: '02',
        status: 'OPEN'
      }
    });

    await expect(unlockPromise).resolves.toMatchObject({
      data: { month: '02', status: 'OPEN' },
      message: 'Période déverrouillée.'
    });
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
    isActive: boolean;
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
    isActive: true,
    PK: 'ORG#test',
    SK: 'ACC#41100000',
    ...overrides
  };
}

function journalResponseFixture(
  overrides: Partial<{
    journalCode: string;
    journalName: string;
    type: 'PURCHASE' | 'SALE' | 'BANK' | 'MISC';
    year: number;
    PK: string;
    SK: string;
  }> = {}
) {
  return {
    year: 2026,
    journalCode: 'OD',
    journalName: 'Operations diverses',
    type: 'MISC',
    ...overrides
  };
}

function entryDetailFixture(
  overrides: Partial<{
    entryId: string;
    year: number;
    entryDate: string;
    journalCode: string;
    entryType: 'STANDARD' | 'OPENING' | 'CLOSING' | 'ADJUSTMENT';
    label: string;
    totalDebit: number;
    totalCredit: number;
    status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  }> = {}
) {
  return {
    entryId: 'E-123',
    year: 2026,
    entryDate: '2026-01-15',
    journalCode: 'OD',
    entryType: 'STANDARD',
    label: 'Draft sale',
    totalDebit: 1000,
    totalCredit: 1000,
    status: 'DRAFT',
    PK: 'ORG#technical',
    SK: 'E#E-123',
    entityType: 'ENTRY',
    lines: [
      {
        lineId: 'E-123#L1',
        accountId: '41100000',
        accountName: 'Clients',
        debit: 1000,
        credit: 0,
        PK: 'ORG#technical',
        SK: 'L#E-123#L1',
        GSI1PK: 'ORG#technical',
        entityType: 'ENTRY_LINE'
      }
    ],
    ...overrides
  };
}

async function settleDynamicImport(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
