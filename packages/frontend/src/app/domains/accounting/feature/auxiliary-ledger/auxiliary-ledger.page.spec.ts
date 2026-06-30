import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { environment } from '../../../../../environments/environment';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { CabinetDossiersApi } from '../../../identity/data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../../identity/data-access/workspaces.api';
import { AuxiliaryLedgerPage } from './auxiliary-ledger.page';

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
          MIN_CHARACTERS: 'Enter at least 2 characters.',
          NO_RESULTS: 'No accounts found',
          SEARCH_PLACEHOLDER: 'Search by account number',
          TYPE_TO_SEARCH: 'Type to search'
        }
      },
      AUXILIARY_LEDGER: {
        ACTIONS: {
          ADVANCED_FILTERS: 'Advanced filters',
          LOAD: 'Load',
          LOAD_MORE: 'Load more'
        },
        BALANCE: {
          CREDIT: 'Credit balance {{amount}}',
          DEBIT: 'Debit balance {{amount}}',
          ZERO: 'Balance 0'
        },
        EMPTY: {
          INITIAL_DESCRIPTION: 'Select an auxiliary account and a third party to review the auxiliary ledger.',
          INITIAL_TITLE: 'Define the scope',
          NO_RESULTS_DESCRIPTION: 'No auxiliary movement for this third party over the period.',
          NO_RESULTS_TITLE: 'No movements'
        },
        ERRORS: {
          LOAD_FAILED: 'The auxiliary ledger could not be loaded.',
          LOAD_MORE_FAILED: 'The next movements could not be loaded.'
        },
        EYEBROW: 'Auxiliary accounting',
        FILTERS: {
          ACCOUNT: 'Auxiliary account',
          DESCRIPTION: 'Choose scope.',
          END_DATE: 'End date',
          START_DATE: 'Start date',
          THIRD_PARTY: 'Third party',
          THIRD_PARTY_PLACEHOLDER: 'Search for a third party',
          TITLE: 'Scope',
          TYPE: 'Type'
        },
        LETTERING_STATUS: {
          COMPLETE: 'Lettered',
          LETTERED: 'Lettered',
          PARTIAL: 'Partial',
          UNLETTERED: 'Unlettered'
        },
        LOADING: 'Loading auxiliary ledger...',
        SUBTITLE: 'Review posted movements.',
        SUMMARY: {
          ACCOUNT: 'Account',
          FINAL: 'Final balance',
          OPENING: 'Opening balance',
          PERIOD: 'Period',
          THIRD_PARTY: 'Third party',
          TOTAL_CREDIT: 'Total credit',
          TOTAL_DEBIT: 'Total debit'
        },
        TABLE: {
          CREDIT: 'Credit',
          DATE: 'Date',
          DEBIT: 'Debit',
          DESCRIPTION: 'Posted auxiliary movements.',
          JOURNAL: 'Journal',
          LABEL: 'Label',
          LETTERING: 'Lettering',
          REFERENCE: 'Reference',
          RUNNING_BALANCE: 'Running balance',
          TITLE: 'Movements'
        },
        TITLE: 'Auxiliary ledger',
        TYPES: {
          CUSTOMER: 'Customer',
          SUPPLIER: 'Supplier'
        }
      },
      FISCAL_YEAR_CONTEXT: {
        CHOOSE_ACTION: 'Choose fiscal year',
        CREATE_ACTION: 'Create fiscal year',
        EMPTY_DESCRIPTION: 'This feature needs an active fiscal year.',
        EMPTY_TITLE: 'Select a fiscal year'
      },
      THIRD_PARTIES: {
        SELECT: {
          EMPTY: 'No third party found',
          ERROR: 'Third parties could not be loaded.',
          LABEL: 'Third party',
          LOAD_MORE: 'Load more third parties',
          LOADING: 'Loading third parties...',
          PLACEHOLDER: 'Search for a third party',
          TYPE_TO_SEARCH: 'Enter a third-party name'
        },
        STATUS: {
          ACTIVE: 'Active',
          INACTIVE: 'Inactive'
        }
      }
    },
    COMMON: {
      ACTIONS: {
        RETRY: 'Try again'
      },
      SELECT: {
        NO_RESULTS: 'No results',
        SEARCH_PLACEHOLDER: 'Search...'
      }
    }
  }
};

describe('AuxiliaryLedgerPage', () => {
  let fixture: ComponentFixture<AuxiliaryLedgerPage>;
  let httpMock: HttpTestingController;
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [
        AuxiliaryLedgerPage,
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
  });

  afterEach(() => {
    localStorage.clear();
    httpMock.verify();
  });

  it('renders the auxiliary-ledger page with the reusable third-party selector and disabled Load action', async () => {
    selectFiscalYear();
    createPage();
    flushThirdParties();
    await settle();

    expect(fixture.nativeElement.textContent).toContain('Auxiliary ledger');
    expect(fixture.nativeElement.textContent).toContain(
      'Select an auxiliary account and a third party to review the auxiliary ledger.'
    );
    expect(fixture.nativeElement.querySelector('liass-third-party-select')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('input[type="date"]').length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('Advanced filters');
    expect(loadButton().disabled).toBe(true);
  });

  it('maps customer scope to the backend third-party ledger query and renders movements', async () => {
    selectFiscalYear();
    createPage();
    flushThirdParties();
    await settle();

    applyScope('CUSTOMER', '41110000', customerAlpha());
    loadLedger();

    const request = expectLedgerRequest();
    expect(request.request.params.get('fiscalYear')).toBe('2026');
    expect(request.request.params.get('accountId')).toBe('41110000');
    expect(request.request.params.get('thirdPartyId')).toBe('tp-cust-alpha');
    expect(request.request.params.get('thirdPartyType')).toBe('CUSTOMER');
    expect(request.request.params.get('startDate')).toBe('2026-01-01');
    expect(request.request.params.get('endDate')).toBe('2026-12-31');
    expect(request.request.params.get('limit')).toBe('50');
    request.flush(customerLedgerResponse());
    await settle();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('41110000 — Clients');
    expect(text).toContain('CUST-ALPHA — Client Alpha');
    expect(text).toContain('FAC-CUST-001');
    expect(text).toContain('PAY-CUST-001');
    expect(text).toContain('FAC-CUST-002');
    expect(text).toContain('PAY-CUST-002');
    expect(text).toContain('Opening balance');
    expect(text).toContain('Debit balance 100\u202f000');
    expect(text).toContain('100\u202f000');
    expect(text).toContain('Lettered');
    expect(text).toContain('Partial');
    expect(fixture.nativeElement.querySelector('liass-skeleton')).toBeNull();
    expect(text).not.toContain('tp-cust-alpha');
    expect(text).not.toContain('PK');
    expect(text).not.toContain('GSI');
    expect(text).not.toContain('entityType');
  });

  it('maps supplier scope to SUPPLIER and presents credit balances clearly', async () => {
    selectFiscalYear();
    createPage();
    flushThirdParties();
    await settle();

    applyScope('SUPPLIER', '40110000', supplierBeta());
    loadLedger();

    const request = expectLedgerRequest();
    expect(request.request.params.get('accountId')).toBe('40110000');
    expect(request.request.params.get('thirdPartyId')).toBe('tp-sup-beta');
    expect(request.request.params.get('thirdPartyType')).toBe('SUPPLIER');
    request.flush(supplierLedgerResponse());
    await settle();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('40110000 — Fournisseurs');
    expect(text).toContain('SUP-BETA — Fournisseur Beta');
    expect(text).toContain('INV-SUP-001');
    expect(text).toContain('PAY-SUP-001');
    expect(text).toContain('Credit balance 80\u202f000');
  });

  it('loads the next cursor page and appends movements without duplicates', async () => {
    selectFiscalYear();
    createPage();
    flushThirdParties();
    await settle();

    applyScope('CUSTOMER', '41110000', customerAlpha());
    loadLedger();
    expectLedgerRequest().flush(customerLedgerResponse({ hasMore: true, nextCursor: 'cursor-2' }));
    await settle();

    const component = fixture.componentInstance as unknown as { loadMore: () => Promise<void> };
    const loadMorePromise = component.loadMore();
    const request = httpMock.expectOne(
      (candidate) =>
        candidate.url === `${apiBaseUrl}/books/third-party-ledger` &&
        candidate.params.get('cursor') === 'cursor-2'
    );
    request.flush(
      customerLedgerResponse({
        count: 2,
        finalBalance: 210000,
        hasMore: false,
        movements: [
          customerMovement({ reference: 'FAC-CUST-001' }),
          customerMovement({
            date: '2026-02-10',
            entryId: 'E-CUST-003',
            label: 'Facture client complémentaire',
            lineId: 'L-CUST-003',
            reference: 'FAC-CUST-003',
            runningBalance: 210000
          })
        ],
        summary: { totalDebit: 210000, totalCredit: 0, balance: 210000 }
      })
    );
    await loadMorePromise;
    await settle();

    const text = fixture.nativeElement.textContent;
    expect((text.match(/FAC-CUST-001/g) ?? []).length).toBe(1);
    expect(text).toContain('FAC-CUST-003');
    expect(text).toContain('Debit balance 210\u202f000');
  });

  it('renders no-result and clean error states', async () => {
    selectFiscalYear();
    createPage();
    flushThirdParties();
    await settle();

    applyScope('CUSTOMER', '41110000', customerAlpha());
    loadLedger();
    expectLedgerRequest().flush(customerLedgerResponse({ count: 0, movements: [] }));
    await settle();
    expect(fixture.nativeElement.textContent).toContain(
      'No auxiliary movement for this third party over the period.'
    );

    applyScope('CUSTOMER', '41110000', customerAlpha());
    setDateRange('2026-02-01', '2026-02-28');
    loadLedger();
    expectLedgerRequest().flush(
      { message: { message: 'Auxiliary ledger is temporarily unavailable.' } },
      { status: 500, statusText: 'Server error' }
    );
    await settle();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Auxiliary ledger is temporarily unavailable.');
    expect(text).not.toContain('Zod');
    expect(text).not.toContain('invalid_type');
  });

  function createPage(): void {
    fixture = TestBed.createComponent(AuxiliaryLedgerPage);
    fixture.detectChanges();
  }

  function flushThirdParties(): void {
    httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/third-parties`).flush({
      data: {
        items: [customerAlpha(), supplierBeta()],
        hasMore: false
      }
    });
  }

  function loadButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
  }

  function applyScope(
    type: 'CUSTOMER' | 'SUPPLIER',
    accountId: string,
      thirdParty: ReturnType<typeof customerAlpha> | ReturnType<typeof supplierBeta>
  ): void {
    const component = fixture.componentInstance as unknown as {
      form: {
        controls: {
          accountId: { setValue: (value: string) => void };
          thirdPartyId: { setValue: (value: string) => void };
          thirdPartyType: { setValue: (value: 'CUSTOMER' | 'SUPPLIER') => void };
        };
      };
      updateSelectedThirdPartyDto: (value: {
        thirdPartyId: string;
        thirdPartyType: 'CUSTOMER' | 'SUPPLIER';
        code: string;
        displayName: string;
      }) => void;
    };
    component.form.controls.thirdPartyType.setValue(type);
    fixture.detectChanges();
    flushPendingThirdPartyRequests();
    component.form.controls.accountId.setValue(accountId);
    component.form.controls.thirdPartyId.setValue(thirdParty.thirdPartyId);
    component.updateSelectedThirdPartyDto({
      thirdPartyId: thirdParty.thirdPartyId,
      thirdPartyType: thirdParty.type,
      code: thirdParty.code,
      displayName: thirdParty.displayName
    });
    fixture.detectChanges();
    flushPendingThirdPartyRequests();
  }

  function setDateRange(startDate: string, endDate: string): void {
    const component = fixture.componentInstance as unknown as {
      form: {
        controls: {
          startDate: { setValue: (value: string) => void };
          endDate: { setValue: (value: string) => void };
        };
      };
    };
    component.form.controls.startDate.setValue(startDate);
    component.form.controls.endDate.setValue(endDate);
    fixture.detectChanges();
  }

  function flushPendingThirdPartyRequests(): void {
    httpMock.match((candidate) => candidate.url === `${apiBaseUrl}/third-parties`).forEach((request) => {
      request.flush({
        data: {
          items: [customerAlpha(), supplierBeta()],
          hasMore: false
        }
      });
    });
  }

  function loadLedger(): void {
    const component = fixture.componentInstance as unknown as { loadLedger: () => void };
    component.loadLedger();
    fixture.detectChanges();
  }

  function expectLedgerRequest() {
    return httpMock.expectOne(
      (candidate) => candidate.url === `${apiBaseUrl}/books/third-party-ledger`
    );
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

function customerAlpha() {
  return {
    thirdPartyId: 'tp-cust-alpha',
    code: 'CUST-ALPHA',
    displayName: 'Client Alpha',
    type: 'CUSTOMER' as const,
    status: 'ACTIVE' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

function supplierBeta() {
  return {
    thirdPartyId: 'tp-sup-beta',
    code: 'SUP-BETA',
    displayName: 'Fournisseur Beta',
    type: 'SUPPLIER' as const,
    status: 'ACTIVE' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

function customerMovement(overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-01-15',
    label: 'Facture client',
    reference: 'FAC-CUST-001',
    journalCode: 'VE',
    debit: 100000,
    credit: 0,
    runningBalance: 100000,
    letteringCode: 'LET-CUST-001',
    letteringStatus: 'LETTERED',
    entryId: 'E-CUST-001',
    lineId: 'L-CUST-001',
    ...overrides
  };
}

function customerLedgerResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      accountId: '41110000',
      thirdPartyId: 'tp-cust-alpha',
      thirdPartyType: 'CUSTOMER',
      account: accountFixture(),
      thirdParty: customerAlpha(),
      period: { fiscalYear: '2026', startDate: '2026-01-01', endDate: '2026-12-31' },
      openingBalance: {
        date: '2026-01-01',
        label: 'Opening balance',
        debit: 0,
        credit: 0,
        balance: 0
      },
      movements: [
        customerMovement(),
        customerMovement({
          date: '2026-01-20',
          entryId: 'E-CUST-002',
          label: 'Règlement client',
          lineId: 'L-CUST-002',
          reference: 'PAY-CUST-001',
          debit: 0,
          credit: 100000,
          runningBalance: 0,
          letteringCode: 'LET-CUST-001',
          letteringStatus: 'PARTIAL'
        }),
        customerMovement({
          date: '2026-02-01',
          entryId: 'E-CUST-004',
          lineId: 'L-CUST-004',
          reference: 'FAC-CUST-002',
          debit: 150000,
          credit: 0,
          runningBalance: 150000,
          letteringCode: null,
          letteringStatus: 'UNLETTERED'
        }),
        customerMovement({
          date: '2026-02-15',
          entryId: 'E-CUST-005',
          label: 'Règlement client partiel',
          lineId: 'L-CUST-005',
          reference: 'PAY-CUST-002',
          debit: 0,
          credit: 50000,
          runningBalance: 100000,
          letteringCode: null,
          letteringStatus: 'UNLETTERED'
        })
      ],
      summary: { totalDebit: 250000, totalCredit: 150000, balance: 100000 },
      count: 4,
      finalBalance: 100000,
      hasMore: false,
      PK: 'ORG#org-company-1',
      GSI2PK: 'TECHNICAL',
      entityType: 'LEDGER_LINE',
      ...overrides
    }
  };
}

function supplierLedgerResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      accountId: '40110000',
      thirdPartyId: 'tp-sup-beta',
      thirdPartyType: 'SUPPLIER',
      account: accountFixture({
        accountId: '40110000',
        accountName: 'Fournisseurs',
        auxiliaryType: 'SUPPLIER'
      }),
      thirdParty: supplierBeta(),
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
          date: '2026-01-10',
          label: 'Facture fournisseur',
          reference: 'INV-SUP-001',
          journalCode: 'AC',
          debit: 0,
          credit: 80000,
          runningBalance: -80000,
          letteringCode: null,
          letteringStatus: 'UNLETTERED',
          entryId: 'E-SUP-001',
          lineId: 'L-SUP-001'
        },
        {
          date: '2026-01-18',
          label: 'Paiement fournisseur',
          reference: 'PAY-SUP-001',
          journalCode: 'BQ',
          debit: 80000,
          credit: 0,
          runningBalance: 0,
          letteringCode: null,
          letteringStatus: 'UNLETTERED',
          entryId: 'E-SUP-002',
          lineId: 'L-SUP-002'
        }
      ],
      summary: { totalDebit: 80000, totalCredit: 160000, balance: -80000 },
      count: 2,
      finalBalance: -80000,
      hasMore: false,
      ...overrides
    }
  };
}
