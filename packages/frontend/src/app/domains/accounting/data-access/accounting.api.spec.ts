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
      active: false,
      activeOnly: true,
      class: 4,
      cursor: 'next-page',
      limit: 20,
      search: '411'
    });
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/accounts`);

    expect(request.request.params.get('active')).toBe('false');
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

  it('lists, creates, updates, activates, and deactivates third parties safely', async () => {
    const listPromise = api.listThirdParties({
      codePrefix: 'cust',
      cursor: 'next-page',
      limit: 200,
      status: 'ACTIVE',
      type: 'CUSTOMER'
    });
    const listRequest = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/third-parties`);

    expect(listRequest.request.method).toBe('GET');
    expect(listRequest.request.params.get('type')).toBe('CUSTOMER');
    expect(listRequest.request.params.get('status')).toBe('ACTIVE');
    expect(listRequest.request.params.get('limit')).toBe('200');
    expect(listRequest.request.params.get('cursor')).toBe('next-page');
    expect(listRequest.request.params.get('codePrefix')).toBe('cust');
    listRequest.flush({
      data: {
        items: [
          thirdPartyFixture({
            PK: 'ORG#technical',
            SK: 'TP#CUSTOMER#tp-cust-alpha',
            entityType: 'THIRD_PARTY'
          })
        ],
        hasMore: false
      }
    });

    await expect(listPromise).resolves.toEqual({
      items: [
        {
          thirdPartyId: 'tp-cust-alpha',
          code: 'CUST-ALPHA',
          displayName: 'Client Alpha',
          type: 'CUSTOMER',
          status: 'ACTIVE',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      hasMore: false,
      message: null
    });

    const createPromise = api.createThirdParty({
      code: 'CUST-ALPHA',
      displayName: 'Client Alpha',
      type: 'CUSTOMER'
    });
    const createRequest = httpMock.expectOne(`${apiBaseUrl}/third-parties`);

    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.body).toEqual({
      code: 'CUST-ALPHA',
      displayName: 'Client Alpha',
      type: 'CUSTOMER'
    });
    createRequest.flush({
      message: 'Tiers créé avec succès.',
      thirdParty: thirdPartyFixture()
    });

    await expect(createPromise).resolves.toMatchObject({
      data: { code: 'CUST-ALPHA', displayName: 'Client Alpha' },
      message: 'Tiers créé avec succès.'
    });

    const updatePromise = api.updateThirdParty('tp-cust-alpha', 'CUSTOMER', {
      displayName: 'Client Alpha SARL',
      email: 'client@example.com'
    });
    const updateRequest = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/third-parties/tp-cust-alpha`);

    expect(updateRequest.request.method).toBe('PATCH');
    expect(updateRequest.request.params.get('type')).toBe('CUSTOMER');
    expect(updateRequest.request.body).toEqual({
      displayName: 'Client Alpha SARL',
      email: 'client@example.com'
    });
    for (const forbiddenField of ['code', 'type', 'thirdPartyId', 'status', 'PK', 'SK', 'GSI1PK', 'GSI1SK', 'entityType']) {
      expect(updateRequest.request.body).not.toHaveProperty(forbiddenField);
    }
    updateRequest.flush({
      thirdParty: thirdPartyFixture({ displayName: 'Client Alpha SARL' })
    });

    await expect(updatePromise).resolves.toMatchObject({
      data: { displayName: 'Client Alpha SARL' }
    });

    const deactivatePromise = api.deactivateThirdParty('tp-cust-alpha', 'CUSTOMER');
    const deactivateRequest = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/third-parties/tp-cust-alpha/deactivate`);

    expect(deactivateRequest.request.method).toBe('POST');
    expect(deactivateRequest.request.params.get('type')).toBe('CUSTOMER');
    deactivateRequest.flush({
      thirdParty: thirdPartyFixture({ status: 'INACTIVE' })
    });

    await expect(deactivatePromise).resolves.toMatchObject({
      data: { status: 'INACTIVE' }
    });

    const activatePromise = api.activateThirdParty('tp-cust-alpha', 'CUSTOMER');
    const activateRequest = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/third-parties/tp-cust-alpha/activate`);

    expect(activateRequest.request.method).toBe('POST');
    expect(activateRequest.request.params.get('type')).toBe('CUSTOMER');
    activateRequest.flush({
      thirdParty: thirdPartyFixture({ status: 'ACTIVE' })
    });

    await expect(activatePromise).resolves.toMatchObject({
      data: { status: 'ACTIVE' }
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
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/books/general-ledger`);

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
          label: 'Report à nouveau',
          debit: 1000,
          credit: 0,
          balance: 1000
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
        label: 'Report à nouveau',
        debit: 1000,
        credit: 0,
        balance: 1000
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

  it('normalizes the deployed legacy general-ledger response', async () => {
    const promise = api.getGeneralLedger({
      fiscalYear: '2026',
      accountId: '52000000',
      limit: 50
    });
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/books/general-ledger`);

    request.flush({
      message: {
        code: 'SUCCESS_LEDGER_RETRIEVED',
        message: 'Grand livre du compte récupéré avec succès.'
      },
      data: {
        accountId: '52000000',
        openingBalance: {
          date: 'OPENING',
          label: 'Opening Balance (Report à Nouveau)',
          reference: 'RAN',
          journalCode: 'RAN',
          journal: 'RAN',
          debit: 0,
          credit: 0,
          runningBalance: 0
        },
        movements: [],
        finalBalance: 0
      }
    });

    await expect(promise).resolves.toEqual({
      accountId: '52000000',
      openingBalance: {
        date: 'OPENING',
        label: 'Opening Balance (Report à Nouveau)',
        debit: 0,
        credit: 0,
        balance: 0
      },
      movements: [],
      finalBalance: 0,
      hasMore: false,
      message: 'Grand livre du compte récupéré avec succès.'
    });
  });

  it('validates the six-column trial balance and preserves the response message', async () => {
    const promise = api.getTrialBalance({
      year: '2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      accountPrefix: '411',
      hideZeroMovement: true
    });
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/books/trial-balance`);

    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('year')).toBe('2026');
    expect(request.request.params.get('startDate')).toBe('2026-01-01');
    expect(request.request.params.get('endDate')).toBe('2026-12-31');
    expect(request.request.params.get('accountPrefix')).toBe('411');
    expect(request.request.params.get('hideZeroMovement')).toBe('true');
    request.flush({
      message: 'Balance récupérée.',
      data: {
        rows: [
          {
            PK: 'ORG#technical',
            accountCode: '41100000',
            accountLabel: 'Clients',
            openingDebit: 1000,
            openingCredit: 0,
            movementDebit: 500,
            movementCredit: 200,
            closingDebit: 1300,
            closingCredit: 0
          }
        ],
        totals: {
          openingDebit: 1000,
          openingCredit: 0,
          movementDebit: 500,
          movementCredit: 200,
          closingDebit: 1300,
          closingCredit: 0,
          isMovementBalanced: false,
          isClosingBalanced: false,
          movementDifference: 300,
          closingDifference: 1300
        },
        period: {
          fiscalYear: '2026',
          startDate: '2026-01-01',
          endDate: '2026-12-31'
        }
      }
    });

    await expect(promise).resolves.toEqual({
      rows: [
        {
          accountCode: '41100000',
          accountLabel: 'Clients',
          openingDebit: 1000,
          openingCredit: 0,
          movementDebit: 500,
          movementCredit: 200,
          closingDebit: 1300,
          closingCredit: 0
        }
      ],
      totals: {
        openingDebit: 1000,
        openingCredit: 0,
        movementDebit: 500,
        movementCredit: 200,
        closingDebit: 1300,
        closingCredit: 0,
        isMovementBalanced: false,
        isClosingBalanced: false,
        movementDifference: 300,
        closingDifference: 1300
      },
      period: {
        fiscalYear: '2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31'
      },
      message: 'Balance récupérée.'
    });
  });

  it('normalizes the deployed annual trial-balance response during rolling deployment', async () => {
    const promise = api.getTrialBalance({
      year: '2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31'
    });
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/books/trial-balance`);

    request.flush({
      message: 'Balance récupérée.',
      data: {
        rows: [
          {
            accountId: '40110000',
            openingDebit: 0,
            openingCredit: 0,
            movementDebit: 150000,
            movementCredit: 150000,
            finalDebit: 0,
            finalCredit: 0
          },
          {
            accountId: '70110000',
            openingDebit: 0,
            openingCredit: 0,
            movementDebit: 0,
            movementCredit: 150000,
            finalDebit: 0,
            finalCredit: 150000
          }
        ],
        totals: {
          openingDebit: 0,
          openingCredit: 0,
          movementDebit: 150000,
          movementCredit: 300000,
          finalDebit: 0,
          finalCredit: 150000
        }
      }
    });
    await Promise.resolve();

    const accountsRequest = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/accounts` && candidate.params.get('limit') === '200');
    accountsRequest.flush({
      data: {
        accounts: [
          accountResponseFixture({
            accountId: '40110000',
            accountName: 'Fournisseurs'
          }),
          accountResponseFixture({
            accountId: '70110000',
            accountName: 'Ventes de marchandises',
            accountNature: 'INCOME',
            accountUsage: 'CREDIT_ONLY',
            isThirdPartyAccount: false,
            classCode: 7,
            financialStatementCode: 'IS',
            allowReconciliation: false
          })
        ],
        hasMore: false
      }
    });

    await expect(promise).resolves.toEqual({
      rows: [
        {
          accountCode: '40110000',
          accountLabel: 'Fournisseurs',
          openingDebit: 0,
          openingCredit: 0,
          movementDebit: 150000,
          movementCredit: 150000,
          closingDebit: 0,
          closingCredit: 0
        },
        {
          accountCode: '70110000',
          accountLabel: 'Ventes de marchandises',
          openingDebit: 0,
          openingCredit: 0,
          movementDebit: 0,
          movementCredit: 150000,
          closingDebit: 0,
          closingCredit: 150000
        }
      ],
      totals: {
        openingDebit: 0,
        openingCredit: 0,
        movementDebit: 150000,
        movementCredit: 300000,
        closingDebit: 0,
        closingCredit: 150000,
        isMovementBalanced: false,
        isClosingBalanced: false,
        movementDifference: -150000,
        closingDifference: -150000
      },
      period: {
        fiscalYear: '2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31'
      },
      message: 'Balance récupérée.'
    });
  });

  it('rejects a legacy response for a partial period instead of returning false annual data', async () => {
    const promise = api.getTrialBalance({
      year: '2026',
      startDate: '2026-02-01',
      endDate: '2026-02-28'
    });
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/books/trial-balance`);

    request.flush({
      data: {
        rows: [],
        totals: {
          openingDebit: 0,
          openingCredit: 0,
          movementDebit: 0,
          movementCredit: 0,
          finalDebit: 0,
          finalCredit: 0
        }
      }
    });

    await expect(promise).rejects.toMatchObject({ name: 'ZodError' });
  });

  it('loads the global paginated journal book', async () => {
    const promise = api.getJournalBook({
      year: '2026',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      journalCode: 'VE',
      limit: 20,
      cursor: 'cursor-2'
    });
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/books/journal-book`);

    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('year')).toBe('2026');
    expect(request.request.params.get('startDate')).toBe('2026-01-01');
    expect(request.request.params.get('endDate')).toBe('2026-01-31');
    expect(request.request.params.get('journalCode')).toBe('VE');
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
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          journalCode: 'VE'
        },
        entries: [
          {
            GSI5PK: 'ORG#technical',
            entityType: 'ENTRY',
            entryId: 'E-001',
            entryNumber: 'E-001',
            accountingDate: '2026-01-15',
            journalCode: 'VE',
            journalLabel: 'Ventes',
            reference: 'FV-001',
            entryLabel: 'Vente',
            totalDebit: 125000,
            totalCredit: 125000,
            status: 'POSTED',
            isBalanced: true,
            lines: [
              {
                lineId: 'L-001',
                accountCode: '41100000',
                accountLabel: 'Clients',
                debit: 125000,
                credit: 0
              }
            ]
          }
        ],
        totals: {
          totalDebit: 125000,
          totalCredit: 125000,
          difference: 0,
          isBalanced: true,
          entryCount: 1,
          lineCount: 1
        },
        integrityWarnings: [],
        nextCursor: 'cursor-3',
        hasMore: true
      }
    });

    await expect(promise).resolves.toEqual({
      items: [
        {
          entryId: 'E-001',
          entryNumber: 'E-001',
          accountingDate: '2026-01-15',
          journalCode: 'VE',
          journalLabel: 'Ventes',
          reference: 'FV-001',
          entryLabel: 'Vente',
          totalDebit: 125000,
          totalCredit: 125000,
          status: 'POSTED',
          isBalanced: true,
          lines: [
            {
              lineId: 'L-001',
              accountCode: '41100000',
              accountLabel: 'Clients',
              debit: 125000,
              credit: 0
            }
          ]
        }
      ],
      meta: {
        year: '2026',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        journalCode: 'VE'
      },
      totals: {
        totalDebit: 125000,
        totalCredit: 125000,
        difference: 0,
        isBalanced: true,
        entryCount: 1,
        lineCount: 1
      },
      integrityWarnings: [],
      nextCursor: 'cursor-3',
      hasMore: true,
      message: 'Livre-journal récupéré.'
    });
  });

  it('rejects an invalid journal-book period before making an HTTP call', async () => {
    await expect(
      api.getJournalBook({
        year: '2026',
        startDate: '2026-02-01',
        endDate: '2026-01-01'
      })
    ).rejects.toThrow();

    httpMock.expectNone((candidate) => candidate.url.includes('/books/journal-book'));
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

  it('loads closing checks, closes periods, closes fiscal years, and loads income statement aggregates', async () => {
    const checksPromise = api.getClosingChecks(2026);
    const checksRequest = httpMock.expectOne(`${apiBaseUrl}/fiscal-year/2026/closing-checks`);

    expect(checksRequest.request.method).toBe('GET');
    checksRequest.flush({
      message: 'Contrôles récupérés.',
      data: {
        canClose: true,
        errors: [],
        warnings: [
          {
            code: 'UNLETTERED_AUXILIARY_LINES_REMAIN',
            scope: 'AUXILIARY',
            message: 'Des lignes auxiliaires restent non lettrées.',
            accountId: '40100000',
            PK: 'ORG#hidden',
            entityType: 'TECHNICAL'
          }
        ],
        summary: {
          fiscalYear: {
            year: 2026,
            fiscalYearId: 'FY#2026',
            startDate: '2026-01-01',
            endDate: '2026-12-31',
            status: 'OPEN',
            accountingFramework: 'SYSCOHADA_REVISED',
            PK: 'ORG#hidden',
            SK: 'FY#2026',
            entityType: 'FISCAL_YEAR'
          },
          draftEntriesCount: 0,
          postedEntriesCount: 6,
          unbalancedEntriesCount: 0,
          trialBalanceDebit: 150000,
          trialBalanceCredit: 150000,
          unletteredAuxiliaryLinesCount: 2
        }
      }
    });

    await expect(checksPromise).resolves.toEqual({
      canClose: true,
      errors: [],
      warnings: [
        {
          code: 'UNLETTERED_AUXILIARY_LINES_REMAIN',
          scope: 'AUXILIARY',
          message: 'Des lignes auxiliaires restent non lettrées.',
          accountId: '40100000'
        }
      ],
      summary: {
        fiscalYear: {
          year: 2026,
          fiscalYearId: 'FY#2026',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          status: 'OPEN',
          accountingFramework: 'SYSCOHADA_REVISED'
        },
        draftEntriesCount: 0,
        postedEntriesCount: 6,
        unbalancedEntriesCount: 0,
        trialBalanceDebit: 150000,
        trialBalanceCredit: 150000,
        unletteredAuxiliaryLinesCount: 2
      },
      message: 'Contrôles récupérés.'
    });

    const periodPromise = api.closePeriod(2026, 2);
    const periodRequest = httpMock.expectOne(`${apiBaseUrl}/fiscal-year/2026/periods/2/close`);

    expect(periodRequest.request.method).toBe('POST');
    expect(periodRequest.request.body).toEqual({
      year: 2026,
      month: 2
    });
    periodRequest.flush({
      message: 'Période clôturée.',
      data: {
        year: 2026,
        month: '02',
        status: 'LOCKED',
        PK: 'ORG#hidden',
        entityType: 'PERIOD_LOCK'
      }
    });

    await expect(periodPromise).resolves.toEqual({
      data: {
        year: 2026,
        month: '02',
        status: 'LOCKED'
      },
      message: 'Période clôturée.'
    });

    const closePromise = api.closeFiscalYear(2026, true);
    const closeRequest = httpMock.expectOne(`${apiBaseUrl}/fiscal-year/2026/close`);

    expect(closeRequest.request.method).toBe('POST');
    expect(closeRequest.request.body).toEqual({ year: '2026', confirmWarnings: true });
    closeRequest.flush({
      message: 'Exercice clôturé.',
      data: {
        fiscalYear: {
          year: 2026,
          fiscalYearId: 'FY#2026',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          status: 'CLOSED',
          accountingFramework: 'SYSCOHADA_REVISED',
          SK: 'FY#2026'
        },
        checks: {
          canClose: true,
          errors: [],
          warnings: [],
          summary: {
            fiscalYear: {
              year: 2026,
              fiscalYearId: 'FY#2026',
              startDate: '2026-01-01',
              endDate: '2026-12-31',
              status: 'CLOSED',
              accountingFramework: 'SYSCOHADA_REVISED',
              GSI1PK: 'TECHNICAL'
            },
            draftEntriesCount: 0,
            postedEntriesCount: 6,
            unbalancedEntriesCount: 0,
            trialBalanceDebit: 150000,
            trialBalanceCredit: 150000
          }
        }
      }
    });

    await expect(closePromise).resolves.toEqual({
      data: {
        fiscalYear: {
          year: 2026,
          fiscalYearId: 'FY#2026',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          status: 'CLOSED',
          accountingFramework: 'SYSCOHADA_REVISED'
        },
        checks: {
          canClose: true,
          errors: [],
          warnings: [],
          summary: {
            fiscalYear: {
              year: 2026,
              fiscalYearId: 'FY#2026',
              startDate: '2026-01-01',
              endDate: '2026-12-31',
              status: 'CLOSED',
              accountingFramework: 'SYSCOHADA_REVISED'
            },
            draftEntriesCount: 0,
            postedEntriesCount: 6,
            unbalancedEntriesCount: 0,
            trialBalanceDebit: 150000,
            trialBalanceCredit: 150000
          }
        }
      },
      message: 'Exercice clôturé.'
    });

    const statementPromise = api.getIncomeStatement(2026);
    const statementRequest = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/reports/income-statement`);

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
      fiscalYear: '2026',
      accountId: '41100000',
      thirdPartyId: 'CUST-1',
      thirdPartyType: 'CUSTOMER',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      limit: 50,
      cursor: 'cursor-1'
    });
    const ledgerRequest = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/books/third-party-ledger`);

    expect(ledgerRequest.request.params.get('fiscalYear')).toBe('2026');
    expect(ledgerRequest.request.params.get('accountId')).toBe('41100000');
    expect(ledgerRequest.request.params.get('thirdPartyId')).toBe('CUST-1');
    expect(ledgerRequest.request.params.get('thirdPartyType')).toBe('CUSTOMER');
    expect(ledgerRequest.request.params.get('startDate')).toBe('2026-01-01');
    expect(ledgerRequest.request.params.get('endDate')).toBe('2026-12-31');
    expect(ledgerRequest.request.params.get('limit')).toBe('50');
    expect(ledgerRequest.request.params.get('cursor')).toBe('cursor-1');
    ledgerRequest.flush({
      data: {
        accountId: '41100000',
        thirdPartyId: 'CUST-1',
        thirdPartyType: 'CUSTOMER',
        account: accountResponseFixture({ accountId: '41100000', accountName: 'Clients' }),
        thirdParty: thirdPartyFixture({
          thirdPartyId: 'CUST-1',
          code: 'CUST-1',
          displayName: 'Client One',
          type: 'CUSTOMER'
        }),
        period: { fiscalYear: '2026', startDate: '2026-01-01', endDate: '2026-12-31' },
        openingBalance: {
          date: '2026-01-01',
          label: 'Opening balance',
          debit: 0,
          credit: 0,
          balance: 0
        },
        movements: [
          {
            date: '2026-01-15',
            label: 'Invoice',
            reference: 'FAC-CUST-001',
            journalCode: 'VE',
            debit: 1000,
            credit: 0,
            runningBalance: 1000,
            letteringCode: null,
            letteringStatus: 'UNLETTERED',
            entryId: 'E-1',
            lineId: 'L-1'
          }
        ],
        summary: { totalDebit: 1000, totalCredit: 300, balance: 700 },
        count: 1,
        finalBalance: 700,
        hasMore: false
      }
    });

    await expect(ledgerPromise).resolves.toMatchObject({ thirdPartyId: 'CUST-1', count: 1 });

    const balancePromise = api.getThirdPartyBalance({
      fiscalYear: '2026',
      accountId: '41110000',
      thirdPartyType: 'CUSTOMER',
      status: 'ACTIVE',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      limit: 100,
      cursor: 'cursor-2'
    });
    const balanceRequest = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/books/third-party-balance`);

    expect(balanceRequest.request.params.get('fiscalYear')).toBe('2026');
    expect(balanceRequest.request.params.get('accountId')).toBe('41110000');
    expect(balanceRequest.request.params.get('thirdPartyType')).toBe('CUSTOMER');
    expect(balanceRequest.request.params.get('status')).toBe('ACTIVE');
    expect(balanceRequest.request.params.get('startDate')).toBe('2026-01-01');
    expect(balanceRequest.request.params.get('endDate')).toBe('2026-12-31');
    expect(balanceRequest.request.params.get('limit')).toBe('100');
    expect(balanceRequest.request.params.get('cursor')).toBe('cursor-2');
    balanceRequest.flush({
      data: thirdPartyBalanceFixture({
        nextCursor: 'cursor-3',
        hasMore: true
      })
    });

    await expect(balancePromise).resolves.toMatchObject({
      accountId: '41110000',
      thirdPartyType: 'CUSTOMER',
      rows: [
        expect.objectContaining({
          thirdPartyName: 'Client Alpha',
          closingDebit: 100000
        })
      ],
      nextCursor: 'cursor-3',
      hasMore: true
    });

    const reportPromise = api.getMatchingReport({
      accountId: '41100000',
      thirdPartyId: 'CUST-1'
    });
    const reportRequest = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/books/matching-report`);

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
    const unletteredRequest = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/lettering/unlettered`);

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

  it('loads manual lettering candidates and match records with frontend-safe DTOs', async () => {
    const candidatesPromise = api.getLetteringCandidates({
      accountId: '41100000',
      cursor: 'next-cursor',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      fiscalYear: 2026,
      limit: 25,
      thirdPartyId: 'CUST-1',
      thirdPartyType: 'CUSTOMER'
    });
    const candidatesRequest = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/lettering/candidates`);

    expect(candidatesRequest.request.method).toBe('GET');
    expect(candidatesRequest.request.params.get('fiscalYear')).toBe('2026');
    expect(candidatesRequest.request.params.get('accountId')).toBe('41100000');
    expect(candidatesRequest.request.params.get('thirdPartyId')).toBe('CUST-1');
    expect(candidatesRequest.request.params.get('thirdPartyType')).toBe('CUSTOMER');
    expect(candidatesRequest.request.params.get('dateFrom')).toBe('2026-01-01');
    expect(candidatesRequest.request.params.get('dateTo')).toBe('2026-12-31');
    expect(candidatesRequest.request.params.get('cursor')).toBe('next-cursor');
    expect(candidatesRequest.request.params.get('limit')).toBe('25');
    candidatesRequest.flush({
      data: {
        accountCode: '41100000',
        accountId: '41100000',
        hasMore: true,
        lines: [
          {
            ...unletteredCandidateFixture(),
            GSI3PK: 'UNLETTERED#org#41100000#CUST-1',
            PK: 'ORG#demo',
            entityType: 'ENTRY_LINE'
          }
        ],
        nextCursor: 'cursor-2',
        thirdPartyId: 'CUST-1',
        thirdPartyName: 'Client Demo',
        thirdPartyType: 'CUSTOMER'
      }
    });

    const candidates = await candidatesPromise;

    expect(candidates).toMatchObject({
      accountId: '41100000',
      hasMore: true,
      nextCursor: 'cursor-2',
      thirdPartyId: 'CUST-1'
    });
    expect(candidates.lines[0]).not.toHaveProperty('PK');
    expect(candidates.lines[0]).not.toHaveProperty('GSI3PK');
    expect(candidates.lines[0]).not.toHaveProperty('entityType');

    const createPayload = {
      accountId: '41100000',
      allocations: [
        { amount: 1000, entryId: 'E-1', lineId: 'L-1' },
        { amount: 1000, entryId: 'E-2', lineId: 'L-2' }
      ],
      fiscalYear: 2026,
      thirdPartyId: 'CUST-1',
      thirdPartyType: 'CUSTOMER' as const
    };
    const createPromise = api.createLetteringMatch(createPayload);
    const createRequest = httpMock.expectOne(`${apiBaseUrl}/lettering/matches`);

    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.body).toEqual(createPayload);
    createRequest.flush({
      data: letteringMatchFixture(),
      message: { message: 'Lettrage enregistré.' }
    });

    await expect(createPromise).resolves.toMatchObject({
      data: {
        letteringId: 'LM-001',
        status: 'ACTIVE'
      },
      message: 'Lettrage enregistré.'
    });

    const detailPromise = api.getLetteringMatch(2026, 'LM-001');
    const detailRequest = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/lettering/matches/LM-001`);

    expect(detailRequest.request.method).toBe('GET');
    expect(detailRequest.request.params.get('fiscalYear')).toBe('2026');
    detailRequest.flush({
      data: letteringMatchFixture({
        PK: 'ORG#demo',
        SK: 'LTR#LM-001',
        entityType: 'LETTERING_MATCH'
      })
    });

    const detail = await detailPromise;

    expect(detail.letteringId).toBe('LM-001');
    expect(detail).not.toHaveProperty('PK');
    expect(detail).not.toHaveProperty('entityType');

    const cancelPromise = api.cancelLetteringMatch({
      cancellationReason: 'Manual correction',
      fiscalYear: 2026,
      letteringId: 'LM-001'
    });
    const cancelRequest = httpMock.expectOne(`${apiBaseUrl}/lettering/matches/LM-001/cancel`);

    expect(cancelRequest.request.method).toBe('POST');
    expect(cancelRequest.request.body).toEqual({
      cancellationReason: 'Manual correction',
      fiscalYear: 2026
    });
    cancelRequest.flush({
      data: letteringMatchFixture({ status: 'CANCELLED' }),
      message: 'Lettrage annulé.'
    });

    await expect(cancelPromise).resolves.toMatchObject({
      data: {
        letteringId: 'LM-001',
        status: 'CANCELLED'
      },
      message: 'Lettrage annulé.'
    });
  });

  it('rejects invalid matching and unlettered responses', async () => {
    const reportPromise = api.getMatchingReport({
      accountId: '41100000',
      thirdPartyId: 'CUST-1'
    });
    const reportRequest = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/books/matching-report`);

    reportRequest.flush({ data: { accountId: '41100000' } });

    await expect(reportPromise).rejects.toThrow();

    const unletteredPromise = api.getUnletteredLines({
      accountId: '41100000',
      thirdPartyId: 'CUST-1'
    });
    const unletteredRequest = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/lettering/unlettered`);

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

function thirdPartyFixture(
  overrides: Partial<{
    thirdPartyId: string;
    code: string;
    displayName: string;
    type: 'CUSTOMER' | 'SUPPLIER';
    status: 'ACTIVE' | 'INACTIVE';
    email: string;
    phone: string;
    country: string;
    createdAt: string;
    updatedAt: string;
    PK: string;
    SK: string;
    entityType: string;
  }> = {}
) {
  return {
    thirdPartyId: 'tp-cust-alpha',
    code: 'CUST-ALPHA',
    displayName: 'Client Alpha',
    type: 'CUSTOMER' as const,
    status: 'ACTIVE' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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

function unletteredCandidateFixture() {
  return {
    accountCode: '41100000',
    accountId: '41100000',
    accountLabel: 'Clients',
    accountingDate: '2026-01-15',
    credit: 0,
    debit: 1000,
    entryId: 'E-1',
    entryNumber: 'VE-0001',
    fiscalYear: 2026,
    journalCode: 'VE',
    label: 'Invoice',
    letteredAmount: 0,
    letteringStatus: 'UNLETTERED',
    lineId: 'L-1',
    originalAmount: 1000,
    reference: 'FAC-001',
    remainingAmount: 1000,
    stableLineIndex: 1,
    thirdPartyCode: 'C001',
    thirdPartyId: 'CUST-1',
    thirdPartyName: 'Client Demo',
    thirdPartyType: 'CUSTOMER'
  };
}

function thirdPartyBalanceFixture(
  overrides: Partial<{
    accountId: string;
    thirdPartyType: 'CUSTOMER' | 'SUPPLIER';
    rows: Array<Record<string, unknown>>;
    nextCursor: string;
    hasMore: boolean;
  }> = {}
) {
  return {
    accountId: '41110000',
    thirdPartyType: 'CUSTOMER' as const,
    account: accountResponseFixture({ accountId: '41110000', accountName: 'Clients' }),
    period: { fiscalYear: '2026', startDate: '2026-01-01', endDate: '2026-12-31' },
    rows: [
      {
        thirdPartyId: 'tp-cust-alpha',
        thirdPartyType: 'CUSTOMER',
        thirdPartyCode: 'CUST-ALPHA',
        thirdPartyName: 'Client Alpha',
        accountId: '41110000',
        accountCode: '41110000',
        accountLabel: 'Clients',
        openingDebit: 10000,
        openingCredit: 0,
        movementDebit: 120000,
        movementCredit: 30000,
        closingDebit: 100000,
        closingCredit: 0,
        balance: 100000,
        remainingAmount: 40000,
        PK: 'ORG#technical',
        entityType: 'THIRD_PARTY_BALANCE'
      }
    ],
    summary: {
      totalOpeningDebit: 10000,
      totalOpeningCredit: 0,
      totalMovementDebit: 120000,
      totalMovementCredit: 30000,
      totalClosingDebit: 100000,
      totalClosingCredit: 0,
      thirdPartyCount: 1,
      balance: 100000
    },
    count: 1,
    hasMore: false,
    ...overrides
  };
}

function letteringMatchFixture(overrides: Partial<ReturnType<typeof letteringMatchFixtureShape>> & Record<string, unknown> = {}) {
  return {
    ...letteringMatchFixtureShape(),
    ...overrides
  };
}

function letteringMatchFixtureShape() {
  return {
    accountCode: '41100000',
    accountId: '41100000',
    allocations: [
      {
        accountingDate: '2026-01-15',
        allocatedAmount: 1000,
        credit: 0,
        debit: 1000,
        entryId: 'E-1',
        entryNumber: 'VE-0001',
        journalCode: 'VE',
        label: 'Invoice',
        lineId: 'L-1',
        reference: 'FAC-001'
      },
      {
        accountingDate: '2026-01-20',
        allocatedAmount: 1000,
        credit: 1000,
        debit: 0,
        entryId: 'E-2',
        entryNumber: 'BQ-0001',
        journalCode: 'BQ',
        label: 'Payment',
        lineId: 'L-2'
      }
    ],
    createdAt: '2026-02-01T10:00:00.000Z',
    createdBy: 'user-1',
    fiscalYear: 2026,
    letteringId: 'LM-001',
    status: 'ACTIVE',
    thirdPartyId: 'CUST-1',
    thirdPartyType: 'CUSTOMER',
    totalCredit: 1000,
    totalDebit: 1000
  };
}

async function settleDynamicImport(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
