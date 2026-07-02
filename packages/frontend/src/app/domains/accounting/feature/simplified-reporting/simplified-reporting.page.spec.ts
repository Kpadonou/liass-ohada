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
import { SimplifiedReportingPage } from './simplified-reporting.page';

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
  fr: {
    ACCOUNTING: {
      SIMPLIFIED_REPORTING: {
        ACTIONS: {
          CHOOSE_FISCAL_YEAR: 'Choisir un exercice',
          OPEN_CLOSING_ASSISTANT: 'Voir l’assistant de clôture',
          REFRESH: 'Actualiser'
        },
        AUXILIARY: {
          BALANCE_CREDIT: 'Solde crédit',
          BALANCE_DEBIT: 'Solde débit',
          CUSTOMERS: 'Clients',
          SUPPLIERS: 'Fournisseurs',
          THIRD_PARTIES: 'Tiers',
          TITLE: 'Synthèse auxiliaire',
          UNLETTERED: 'Montant non lettré / restant'
        },
        CLOSING: {
          DESCRIPTION: 'Synthèse des contrôles disponibles.',
          DRAFT_ENTRIES: 'Brouillons',
          ERRORS: 'Erreurs',
          NEEDS_REVIEW: 'À revoir',
          READY: 'Clôture possible',
          TITLE: 'Préparation clôture',
          UNBALANCED_ENTRIES: 'Écritures déséquilibrées',
          UNLETTERED_LINES: 'Lignes non lettrées',
          WARNINGS: 'Avertissements'
        },
        ERROR: {
          DESCRIPTION: 'La vue d’ensemble n’a pas pu être chargée.',
          TITLE: 'Vue d’ensemble indisponible'
        },
        EYEBROW: 'Reporting opérationnel',
        FILTERS: {
          DESCRIPTION: 'Ajustez la période.',
          END_DATE: 'Date fin',
          FISCAL_YEAR: 'Exercice',
          INCLUDE_AUXILIARY: 'Inclure l’auxiliaire',
          INCLUDE_CLOSING: 'Inclure la clôture',
          START_DATE: 'Date début',
          TITLE: 'Filtres'
        },
        INCOME: {
          BENEFIT: 'Bénéfice',
          DESCRIPTION: 'Synthèse produits / charges.',
          EXPENSE: 'Charges',
          EXPENSE_ACCOUNTS: 'Comptes de charges',
          LOSS: 'Perte',
          NET_RESULT: 'Résultat net',
          REVENUE: 'Produits',
          REVENUE_ACCOUNTS: 'Comptes de produits',
          TITLE: 'Résultat simplifié'
        },
        INFO_NOTE: 'Cette vue est une synthèse opérationnelle. Elle ne remplace pas les états financiers OHADA officiels.',
        PERIOD: {
          GENERATED_AT: 'Généré le',
          TITLE: 'Période'
        },
        STATES: {
          LOADING: 'Chargement de la vue d’ensemble…',
          NO_ACTIVE_FISCAL_YEAR: 'Aucun exercice actif sélectionné.',
          NO_ACTIVE_FISCAL_YEAR_DESCRIPTION: 'Sélectionnez un exercice.',
          NO_DATA: 'Aucune donnée de reporting disponible pour la période sélectionnée.'
        },
        SUBTITLE: 'Suivez les principaux indicateurs comptables de l’exercice actif.',
        TITLE: 'Vue d’ensemble',
        TRIAL_BALANCE: {
          ACCOUNTS: 'Comptes',
          BALANCED: 'Équilibrée',
          DIFFERENCE: 'Écart',
          MOVEMENTS: 'Mouvements',
          STATUS: 'Statut',
          TITLE: 'Balance synthétique',
          TOTAL_CREDIT: 'Total crédit',
          TOTAL_DEBIT: 'Total débit',
          UNBALANCED: 'Déséquilibrée'
        },
        VALIDATION: {
          DATE_RANGE: 'La date de début doit être antérieure ou égale à la date de fin.',
          OUTSIDE_FISCAL_YEAR: 'La période doit rester comprise dans l’exercice sélectionné.',
          PERIOD_REQUIRED: 'Sélectionnez un exercice, une date de début et une date de fin.'
        }
      }
    },
    COMMON: {
      ACTIONS: {
        RETRY: 'Réessayer'
      }
    }
  }
};

describe('SimplifiedReportingPage', () => {
  let fixture: ComponentFixture<SimplifiedReportingPage>;
  let httpMock: HttpTestingController;
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [
        SimplifiedReportingPage,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: {
            availableLangs: ['fr'],
            defaultLang: 'fr'
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

  it('renders the no active fiscal year state without calling the report endpoint', async () => {
    createPage();
    await settle();

    const text = pageText();
    expect(text).toContain('Vue d’ensemble');
    expect(text).toContain('Suivez les principaux indicateurs comptables de l’exercice actif.');
    expect(text).toContain('Aucun exercice actif sélectionné.');
    expect(text).not.toContain('Plan comptable');
    expect(text).not.toContain('Journaux');
    expect(text).not.toContain('Reporting simplifié');
    expect(text).not.toContain('États OHADA');
    httpMock.expectNone((candidate) => candidate.url === `${apiBaseUrl}/reports/simplified`);
  });

  it('shows a stable loading state after the selected fiscal year triggers closing-ready reporting', async () => {
    selectFiscalYear();
    createPage();
    fixture.detectChanges();

    expect(pageText()).toContain('Chargement de la vue d’ensemble');
    expect(fixture.nativeElement.querySelector('liass-skeleton')).not.toBeNull();
    expectReportRequest().flush(reportResponse());
    await settle();
  });

  it('calls GET /reports/simplified with active fiscal-year defaults and renders all report sections safely', async () => {
    selectFiscalYear();
    createPage();

    const request = expectReportRequest();
    expect(request.request.params.get('fiscalYear')).toBe('2026');
    expect(request.request.params.get('startDate')).toBe('2026-01-01');
    expect(request.request.params.get('endDate')).toBe('2026-12-31');
    expect(request.request.params.get('includeAuxiliary')).toBe('true');
    expect(request.request.params.get('includeClosingChecks')).toBe('true');
    request.flush(reportResponse());
    await settle();

    const text = pageText();
    expect(text).toContain(
      'Cette vue est une synthèse opérationnelle. Elle ne remplace pas les états financiers OHADA officiels.'
    );
    expect(text).toContain('Vue d’ensemble');
    expect(text).toContain('2026');
    expect(text).toContain('Total débit');
    expect(text).toContain('Total crédit');
    expect(text).toContain('150\u202f000');
    expect(text).toContain('Équilibrée');
    expect(text).toContain('Produits');
    expect(text).toContain('Charges');
    expect(text).toContain('Résultat net');
    expect(text).toContain('Bénéfice');
    expect(text).toContain('70100000');
    expect(text).toContain('60100000');
    expect(text).toContain('Clients');
    expect(text).toContain('Fournisseurs');
    expect(text).toContain('Solde débit');
    expect(text).toContain('Montant non lettré / restant');
    expect(text).toContain('Préparation clôture');
    expect(text).toContain('À revoir');
    expect(text).toContain('Voir l’assistant de clôture');
    expect(fixture.nativeElement.querySelector('a[href="/accounting/fiscal-years"]')).not.toBeNull();
    expect(text).not.toContain('Plan comptable');
    expect(text).not.toContain('Journaux');
    expect(text).not.toContain('Reporting simplifié');
    expect(text).not.toContain('États OHADA');
    expect(text).not.toContain('PK');
    expect(text).not.toContain('SK');
    expect(text).not.toContain('GSI');
    expect(text).not.toContain('entityType');
  });

  it('passes date range and inclusion toggles when filters are refreshed', async () => {
    selectFiscalYear();
    createPage();
    expectReportRequest().flush(reportResponse());
    await settle();

    const component = fixture.componentInstance as any;
    component.filterForm.patchValue({
      startDate: '2026-03-01',
      endDate: '2026-06-30',
      includeAuxiliary: false,
      includeClosingChecks: false
    });
    fixture.detectChanges();
    refreshButton().click();
    fixture.detectChanges();

    const request = expectReportRequest();
    expect(request.request.params.get('fiscalYear')).toBe('2026');
    expect(request.request.params.get('startDate')).toBe('2026-03-01');
    expect(request.request.params.get('endDate')).toBe('2026-06-30');
    expect(request.request.params.get('includeAuxiliary')).toBe('false');
    expect(request.request.params.get('includeClosingChecks')).toBe('false');
    request.flush(reportResponse());
    await settle();
  });

  it('shows validation and avoids a new request for an invalid date range', async () => {
    selectFiscalYear();
    createPage();
    expectReportRequest().flush(reportResponse());
    await settle();

    const component = fixture.componentInstance as any;
    component.filterForm.patchValue({
      startDate: '2026-12-31',
      endDate: '2026-01-01'
    });
    fixture.detectChanges();
    refreshButton().click();
    await settle();

    expect(pageText()).toContain('La date de début doit être antérieure ou égale à la date de fin.');
    httpMock.expectNone((candidate) => candidate.url === `${apiBaseUrl}/reports/simplified`);
  });

  it('renders unbalanced and loss states without turning warnings into blocking copy', async () => {
    selectFiscalYear();
    createPage();
    expectReportRequest().flush(reportResponse({
      trialBalance: {
        totalDebit: 150000,
        totalCredit: 149000,
        isBalanced: false,
        accountCount: 4,
        movementCount: 8
      },
      income: {
        totalRevenue: 40000,
        totalExpense: 70000,
        netResult: -30000
      },
      closingReadiness: {
        canClose: true,
        errorsCount: 0,
        warningsCount: 2,
        draftEntriesCount: 0,
        unbalancedEntriesCount: 0,
        unletteredAuxiliaryLinesCount: 2
      }
    }));
    await settle();

    const text = pageText();
    expect(text).toContain('Déséquilibrée');
    expect(text).toContain('Perte');
    expect(text).toContain('Clôture possible');
    expect(text).toContain('Avertissements');
    expect(text).not.toContain('Corrections requises');
  });

  it('renders no-data and clean backend error states', async () => {
    selectFiscalYear();
    createPage();
    expectReportRequest().flush(reportResponse({
      trialBalance: {
        totalDebit: 0,
        totalCredit: 0,
        isBalanced: true,
        accountCount: 0,
        movementCount: 0
      },
      income: {
        totalRevenue: 0,
        totalExpense: 0,
        netResult: 0
      },
      auxiliary: undefined,
      closingReadiness: undefined
    }));
    await settle();

    expect(pageText()).toContain('Aucune donnée de reporting disponible pour la période sélectionnée.');

    refreshButton().click();
    const request = expectReportRequest();
    request.flush(
      { message: 'Le reporting simplifié n’a pas pu être chargé.' },
      { status: 500, statusText: 'Server Error' }
    );
    await settle();

    const text = pageText();
    expect(text).toContain('Le reporting simplifié n’a pas pu être chargé.');
    expect(text).not.toContain('HttpErrorResponse');
    expect(text).not.toContain('Zod');
    expect(text).not.toContain('PK');
    expect(text).not.toContain('SK');
    expect(text).not.toContain('GSI');
    expect(text).not.toContain('entityType');
  });

  function createPage(): void {
    fixture = TestBed.createComponent(SimplifiedReportingPage);
    fixture.detectChanges();
  }

  function expectReportRequest() {
    return httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/reports/simplified`);
  }

  function refreshButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('button[aria-label="Actualiser"]') as HTMLButtonElement;
  }

  function pageText(): string {
    return fixture.nativeElement.textContent;
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

function reportResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      period: {
        fiscalYear: '2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        generatedAt: '2026-07-02T10:00:00.000Z',
        PK: 'ORG#technical'
      },
      trialBalance: {
        totalDebit: 150000,
        totalCredit: 150000,
        isBalanced: true,
        accountCount: 4,
        movementCount: 8,
        entityType: 'TECHNICAL'
      },
      income: {
        totalRevenue: 100000,
        totalExpense: 40000,
        netResult: 60000,
        revenueAccounts: [
          {
            accountId: '70100000',
            totalDebit: 0,
            totalCredit: 100000,
            netAmount: 100000,
            SK: 'ACCOUNT#70100000'
          }
        ],
        expenseAccounts: [
          {
            accountId: '60100000',
            totalDebit: 40000,
            totalCredit: 0,
            netAmount: 40000
          }
        ]
      },
      auxiliary: {
        customers: {
          accountIds: ['41100000'],
          totalDebit: 120000,
          totalCredit: 50000,
          totalBalanceDebit: 70000,
          totalBalanceCredit: 0,
          unletteredAmount: 25000,
          thirdPartyCount: 2
        },
        suppliers: {
          accountIds: ['40100000'],
          totalDebit: 20000,
          totalCredit: 60000,
          totalBalanceDebit: 0,
          totalBalanceCredit: 40000,
          unletteredAmount: 15000,
          thirdPartyCount: 1
        }
      },
      closingReadiness: {
        canClose: false,
        errorsCount: 1,
        warningsCount: 2,
        draftEntriesCount: 1,
        unbalancedEntriesCount: 0,
        unletteredAuxiliaryLinesCount: 3
      },
      ...overrides
    }
  };
}
