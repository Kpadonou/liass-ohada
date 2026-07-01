import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { environment } from '../../../../../environments/environment';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { CabinetDossiersApi } from '../../../identity/data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../../identity/data-access/workspaces.api';
import { AuxiliaryBalancePage } from './auxiliary-balance.page';

vi.mock('aws-amplify/auth', () => {
  const globalScope = globalThis as unknown as {
    __liassAmplifyAuthMock?: Record<string, ReturnType<typeof vi.fn>>;
  };
  globalScope.__liassAmplifyAuthMock ??= {
    confirmSignIn: vi.fn(),
    fetchAuthSession: vi.fn(),
    fetchUserAttributes: vi.fn(),
    getCurrentUser: vi.fn(),
    signIn: vi.fn(),
    signInWithRedirect: vi.fn(),
    signOut: vi.fn()
  };

  return globalScope.__liassAmplifyAuthMock;
});

const translations = {
  en: {
    ACCOUNTING: {
      ACCOUNTS: {
        SELECT: {
          LABEL: 'Account',
          LOADING: 'Searching accounts...',
          LOAD_MORE: 'Load more accounts',
          NO_RESULTS: 'No accounts found',
          SEARCH_PLACEHOLDER: 'Search by account number',
          TYPE_TO_SEARCH: 'Type to search'
        }
      },
      AUXILIARY_BALANCE: {
        ACTIONS: {
          LOAD: 'Load',
          LOAD_MORE: 'Load more',
          ROW_MENU: 'Open actions for {{ thirdParty }}',
          VIEW_AUXILIARY_LEDGER: 'View auxiliary ledger'
        },
        CURRENCY: 'Amounts in FCFA',
        EMPTY: {
          INITIAL_DESCRIPTION: 'Select an auxiliary account to review the auxiliary balance.',
          INITIAL_TITLE: 'Scope required',
          NO_DATA_DESCRIPTION: 'No third party with movement over the selected period.',
          NO_DATA_TITLE: 'No movement'
        },
        ERROR: {
          DESCRIPTION: 'The auxiliary balance could not be loaded.',
          LOAD_MORE_FAILED: 'The next auxiliary balance rows could not be loaded.',
          TITLE: 'Auxiliary balance unavailable'
        },
        EYEBROW: 'Auxiliary accounting',
        FILTERS: {
          ACCOUNT: 'Auxiliary account',
          DESCRIPTION: 'Choose scope.',
          END_DATE: 'End date',
          START_DATE: 'Start date',
          STATUS: 'Third-party status',
          TITLE: 'Scope',
          TYPE: 'Type'
        },
        LOADING: 'Loading auxiliary balance...',
        STATUS: {
          ACTIVE: 'Active',
          ALL: 'All',
          INACTIVE: 'Inactive'
        },
        SUBTITLE: 'Check customer and supplier balances by third party.',
        SUMMARY: {
          CLOSING_CREDIT: 'Total credit balance',
          CLOSING_DEBIT: 'Total debit balance',
          MOVEMENT_CREDIT: 'Total credit movements',
          MOVEMENT_DEBIT: 'Total debit movements',
          THIRD_PARTY_COUNT: 'Third parties'
        },
        TABLE: {
          ACTIONS: 'Actions',
          CLOSING_CREDIT: 'Credit balance',
          CLOSING_DEBIT: 'Debit balance',
          MOVEMENT_CREDIT: 'Credit mov.',
          MOVEMENT_DEBIT: 'Debit mov.',
          OPENING_CREDIT: 'Opening credit',
          OPENING_DEBIT: 'Opening debit',
          REMAINING: 'Unlettered / Remaining',
          THIRD_PARTY: 'Third party',
          TITLE: 'Balance by third party',
          TOTALS: 'Total'
        },
        TITLE: 'Auxiliary balance',
        TYPES: {
          CUSTOMER: 'Customer',
          SUPPLIER: 'Supplier'
        },
        TYPES_PLURAL: {
          CUSTOMER: 'Customers',
          SUPPLIER: 'Suppliers'
        }
      },
      FISCAL_YEAR_CONTEXT: {
        CHOOSE_ACTION: 'Choose fiscal year',
        CREATE_ACTION: 'Create fiscal year',
        EMPTY_DESCRIPTION: 'This feature needs an active fiscal year.',
        EMPTY_TITLE: 'Select a fiscal year'
      }
    },
    COMMON: {
      ACTIONS: {
        RETRY: 'Try again'
      },
      NOTIFICATIONS: {
        LOAD_ERROR: 'Loading failed.'
      }
    }
  }
};

describe('AuxiliaryBalancePage', () => {
  let fixture: ComponentFixture<AuxiliaryBalancePage>;
  let httpMock: HttpTestingController;
  let component: AuxiliaryBalancePage;
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [
        AuxiliaryBalancePage,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: {
            availableLangs: ['en'],
            defaultLang: 'en'
          }
        })
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTanStackQuery(
          new QueryClient({
            defaultOptions: {
              queries: {
                retry: false
              }
            }
          })
        ),
        { provide: WorkspacesApi, useValue: { listWorkspaces: () => Promise.resolve([]) } },
        { provide: CabinetDossiersApi, useValue: { listDossiers: () => Promise.resolve([]) } }
      ]
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-company-1',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company-1'
    );
    selectFiscalYear();
  });

  afterEach(() => {
    localStorage.clear();
    httpMock.verify();
  });

  it('renders initial state with Client and Active defaults while Load stays disabled until an account is selected', async () => {
    createPage();
    await settle();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Auxiliary balance');
    expect(text).toContain('Check customer and supplier balances by third party.');
    expect(text).toContain('Select an auxiliary account to review the auxiliary balance.');
    expect(text).toContain('Customer');
    expect(text).toContain('Active');
    expect((component as any).form.controls.thirdPartyType.value).toBe('CUSTOMER');
    expect((component as any).form.controls.status.value).toBe('ACTIVE');
    expect(loadButton().disabled).toBe(true);

    (component as any).form.controls.accountId.setValue('41110000');
    fixture.detectChanges();

    expect(loadButton().disabled).toBe(false);
  });

  it('calls third-party balance with customer scope and renders rows, summaries, totals, and clean business fields', async () => {
    createPage();
    await settle();

    applyScope({ accountId: '41110000', thirdPartyType: 'CUSTOMER', status: 'ACTIVE' });
    loadBalance();

    const request = expectBalanceRequest();
    expect(request.request.params.get('fiscalYear')).toBe('2026');
    expect(request.request.params.get('accountId')).toBe('41110000');
    expect(request.request.params.get('thirdPartyType')).toBe('CUSTOMER');
    expect(request.request.params.get('status')).toBe('ACTIVE');
    expect(request.request.params.get('startDate')).toBe('2026-01-01');
    expect(request.request.params.get('endDate')).toBe('2026-12-31');
    expect(request.request.params.get('limit')).toBe('100');
    request.flush({ data: customerBalanceResponse({ hasMore: true, nextCursor: 'cursor-next' }) });
    await settle();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('41110000');
    expect(text).toContain('Clients');
    expect(text).toContain('Third parties');
    expect(text).toContain('Total debit movements');
    expect(text).toContain('Total credit movements');
    expect(text).toContain('Total debit balance');
    expect(text).toContain('Total credit balance');
    expect(text).toContain('Client Alpha');
    expect(text).toContain('Opening debit');
    expect(text).toContain('Opening credit');
    expect(text).toContain('Debit mov.');
    expect(text).toContain('Credit mov.');
    expect(text).toContain('Debit balance');
    expect(text).toContain('Credit balance');
    expect(text).toContain('Unlettered / Remaining');
    expect(text).toContain('10\u202f000');
    expect(text).toContain('120\u202f000');
    expect(text).toContain('30\u202f000');
    expect(text).toContain('100\u202f000');
    expect(text).toContain('40\u202f000');
    expect(text).toContain('Total');
    expect(text).toContain('Load more');
    expect(fixture.nativeElement.querySelector('[data-testid="auxiliary-balance-table"]')).not.toBeNull();
    expect(text).not.toContain('tp-cust-alpha');
    expect(text).not.toContain('PK');
    expect(text).not.toContain('SK');
    expect(text).not.toContain('GSI');
    expect(text).not.toContain('entityType');
  });

  it('maps supplier scope to SUPPLIER and shows credit balances under the credit side', async () => {
    createPage();
    await settle();

    applyScope({ accountId: '40110000', thirdPartyType: 'SUPPLIER', status: 'ACTIVE' });
    loadBalance();

    const request = expectBalanceRequest();
    expect(request.request.params.get('accountId')).toBe('40110000');
    expect(request.request.params.get('thirdPartyType')).toBe('SUPPLIER');
    request.flush({ data: supplierBalanceResponse() });
    await settle();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Fournisseur Beta');
    expect(text).toContain('40110000');
    expect(text).toContain('Fournisseurs');
    expect(text).toContain('90\u202f000');
    const cells = Array.from(fixture.nativeElement.querySelectorAll('td')).map((cell) =>
      (cell as HTMLElement).textContent?.trim()
    );
    expect(cells).not.toContain('-90\u202f000');
  });

  it('omits status query parameter when status Tous is selected', async () => {
    createPage();
    await settle();

    applyScope({ accountId: '41110000', thirdPartyType: 'CUSTOMER', status: 'ALL' });
    loadBalance();

    const request = expectBalanceRequest();
    expect(request.request.params.has('status')).toBe(false);
    request.flush({ data: customerBalanceResponse() });
    await settle();
  });

  it('loads more rows with nextCursor and avoids duplicate third-party rows', async () => {
    createPage();
    await settle();

    applyScope({ accountId: '41110000', thirdPartyType: 'CUSTOMER', status: 'ACTIVE' });
    loadBalance();
    expectBalanceRequest().flush({ data: customerBalanceResponse({ hasMore: true, nextCursor: 'cursor-next' }) });
    await settle();

    void (component as any).loadMore();
    const nextRequest = expectBalanceRequest();
    expect(nextRequest.request.params.get('cursor')).toBe('cursor-next');
    nextRequest.flush({
      data: customerBalanceResponse({
        rows: [
          balanceRowFixture({ thirdPartyId: 'tp-cust-alpha', thirdPartyName: 'Client Alpha' }),
          balanceRowFixture({
            thirdPartyId: 'tp-cust-gamma',
            thirdPartyCode: 'CUST-GAMMA',
            thirdPartyName: 'Client Gamma',
            closingDebit: 25000,
            balance: 25000
          })
        ],
        count: 2,
        hasMore: false
      })
    });
    await settle();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Client Alpha');
    expect(text).toContain('Client Gamma');
    expect(text.match(/Client Alpha/g)?.length).toBe(1);
  });

  it('renders no-data, loading, and clean error states', async () => {
    createPage();
    await settle();

    applyScope({ accountId: '41110000', thirdPartyType: 'CUSTOMER', status: 'ACTIVE' });
    loadBalance();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading auxiliary balance...');
    expect(fixture.nativeElement.querySelector('liass-skeleton')).not.toBeNull();

    expectBalanceRequest().flush({ data: customerBalanceResponse({ rows: [], count: 0 }) });
    await settle();
    expect(fixture.nativeElement.textContent).toContain('No third party with movement over the selected period.');

    applyScope({ accountId: '41110000', thirdPartyType: 'CUSTOMER', status: 'INACTIVE' });
    loadBalance();
    expectBalanceRequest().flush(
      { message: 'PK ORG#test cannot be queried' },
      { status: 500, statusText: 'Server Error' }
    );
    await settle();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('The auxiliary balance could not be loaded.');
    expect(text).not.toContain('PK ORG#test');
  });

  it('navigates to auxiliary ledger with selected row context', async () => {
    createPage();
    await settle();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    applyScope({ accountId: '41110000', thirdPartyType: 'CUSTOMER', status: 'ACTIVE' });
    loadBalance();
    expectBalanceRequest().flush({ data: customerBalanceResponse() });
    await settle();

    (component as any).viewAuxiliaryLedger(balanceRowFixture());

    expect(navigate).toHaveBeenCalledWith(['/accounting/auxiliary-ledger'], {
      queryParams: {
        account: '41110000',
        accountId: '41110000',
        thirdPartyId: 'tp-cust-alpha',
        thirdPartyType: 'CUSTOMER',
        year: '2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31'
      }
    });
  });

  function createPage(): void {
    fixture = TestBed.createComponent(AuxiliaryBalancePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function applyScope(options: {
    accountId: string;
    thirdPartyType: 'CUSTOMER' | 'SUPPLIER';
    status: 'ACTIVE' | 'INACTIVE' | 'ALL';
  }): void {
    (component as any).form.controls.thirdPartyType.setValue(options.thirdPartyType);
    (component as any).form.patchValue({
      status: options.status,
      startDate: '2026-01-01',
      endDate: '2026-12-31'
    });
    (component as any).form.controls.accountId.setValue(options.accountId);
    fixture.detectChanges();
  }

  function loadBalance(): void {
    (component as any).loadBalance();
    fixture.detectChanges();
  }

  function expectBalanceRequest() {
    return httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/books/third-party-balance`);
  }

  function loadButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('liass-button button') as HTMLButtonElement;
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 25));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
});

function selectFiscalYear(): void {
  TestBed.inject(AccountingFiscalYearContextService).selectFiscalYear({
    accountingFramework: 'SYSCOHADA_REVISED',
    endDate: '2026-12-31',
    fiscalYearId: 'FY#2026',
    startDate: '2026-01-01',
    status: 'OPEN',
    year: 2026
  });
}

function accountFixture(overrides: Record<string, unknown> = {}) {
  return {
    accountId: '41110000',
    accountName: 'Clients',
    accountNature: 'BALANCE',
    accountUsage: 'BOTH',
    isThirdPartyAccount: true,
    requiresThirdParty: true,
    auxiliaryType: 'CUSTOMER',
    classCode: 4,
    financialStatementCode: 'ACTIF',
    allowReconciliation: true,
    isActive: true,
    ...overrides
  };
}

function balanceRowFixture(overrides: Record<string, unknown> = {}) {
  return {
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
    SK: 'BAL#technical',
    GSI1PK: 'ORG#technical',
    entityType: 'THIRD_PARTY_BALANCE',
    ...overrides
  };
}

function customerBalanceResponse(overrides: Record<string, unknown> = {}) {
  const rows = (overrides['rows'] as Array<Record<string, unknown>> | undefined) ?? [balanceRowFixture()];

  return {
    accountId: '41110000',
    thirdPartyType: 'CUSTOMER',
    account: accountFixture(),
    period: { fiscalYear: '2026', startDate: '2026-01-01', endDate: '2026-12-31' },
    rows,
    summary: {
      totalOpeningDebit: 10000,
      totalOpeningCredit: 0,
      totalMovementDebit: 120000,
      totalMovementCredit: 30000,
      totalClosingDebit: 100000,
      totalClosingCredit: 0,
      thirdPartyCount: rows.length,
      balance: 100000
    },
    count: rows.length,
    hasMore: false,
    ...overrides
  };
}

function supplierBalanceResponse() {
  return {
    ...customerBalanceResponse({
      accountId: '40110000',
      thirdPartyType: 'SUPPLIER',
      account: accountFixture({
        accountId: '40110000',
        accountName: 'Fournisseurs',
        auxiliaryType: 'SUPPLIER'
      }),
      rows: [
        balanceRowFixture({
          thirdPartyId: 'tp-sup-beta',
          thirdPartyType: 'SUPPLIER',
          thirdPartyCode: 'SUP-BETA',
          thirdPartyName: 'Fournisseur Beta',
          accountId: '40110000',
          accountCode: '40110000',
          accountLabel: 'Fournisseurs',
          openingDebit: 0,
          openingCredit: 5000,
          movementDebit: 20000,
          movementCredit: 105000,
          closingDebit: 0,
          closingCredit: 90000,
          balance: -90000,
          remainingAmount: 90000
        })
      ],
      summary: {
        totalOpeningDebit: 0,
        totalOpeningCredit: 5000,
        totalMovementDebit: 20000,
        totalMovementCredit: 105000,
        totalClosingDebit: 0,
        totalClosingCredit: 90000,
        thirdPartyCount: 1,
        balance: -90000
      },
      count: 1
    })
  };
}
