import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';

import { environment } from '../../../../../environments/environment';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { CabinetDossiersApi } from '../../../identity/data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../../identity/data-access/workspaces.api';
import { EntryFormPage } from './entry-form.page';

const translations = {
  en: {
    ACCOUNTING: {
      ENTRIES: {
        EYEBROW: 'Journal entry',
        FIELDS: {
          DATE: 'Entry date',
          JOURNAL: 'Journal',
          LABEL: 'Description',
          VOUCHER: 'Reference'
        },
        FORM: {
          ACTIONS: {
            ADD_LINE: 'Add line',
            PUBLISH: 'Post entry',
            REMOVE_LINE: 'Remove line',
            SAVE_DRAFT: 'Save draft'
          },
          ACTIVE_FISCAL_YEAR: 'Active fiscal year',
          BACK_TO_LIST: 'Back to entries',
          DRAFT_REQUIRED: 'Only draft entries can be edited.',
          EDIT_SUBTITLE: 'Prepare the draft.',
          EDIT_TITLE: 'Edit entry',
          GENERAL: {
            DESCRIPTION: 'Enter the identifying information.',
            TITLE: 'General information'
          },
          LINES: {
            ACTIONS: 'Actions',
            ACCOUNT: 'Account',
            CREDIT: 'Credit',
            DEBIT: 'Debit',
            DESCRIPTION: 'Compose the entry line by line.',
            LABEL: 'Label',
            MONEY_HINT: 'Amounts are entered as integers.',
            THIRD_PARTY: 'Third party',
            TITLE: 'Entry lines'
          },
          LOAD_DRAFT_ERROR: 'The draft could not be loaded.',
          LOADING_DRAFT: 'Loading draft...',
          NEW_SUBTITLE: 'Prepare the general information.',
          NEW_TITLE: 'New entry',
          TOTALS: {
            ACCESSIBLE_LABEL: 'Entry totals',
            DIFFERENCE: 'Difference'
          },
          VALIDATION: {
            ACCOUNT_REQUIRED: 'Select a valid account.',
            AMOUNT_REQUIRED: 'Enter an amount.',
            DATE_REQUIRED: 'Select an entry date.',
            DEBIT_CREDIT_EXCLUSIVE: 'A line cannot contain both debit and credit.',
            ENTRY_UNBALANCED: 'The entry must be balanced.',
            JOURNAL_REQUIRED: 'Select a journal.',
            LABEL_REQUIRED: 'Enter a label.'
          }
        },
        TOTALS: {
          CREDIT: 'Total credit',
          DEBIT: 'Total debit'
        }
      },
      FISCAL_YEAR: {
        STATUS: {
          OPEN: 'Open'
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
        CANCEL: 'Cancel'
      },
      SELECT: {
        NO_RESULTS: 'No result',
        SEARCH_PLACEHOLDER: 'Search'
      }
    }
  }
};

describe('EntryFormPage', () => {
  let fixture: ComponentFixture<EntryFormPage>;
  let httpMock: HttpTestingController;
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [
        EntryFormPage,
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
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({})
            }
          }
        },
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

  it('renders the dedicated new entry page with the general form and totals', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();

    flushReferenceData();
    await settle();

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('New entry');
    expect(text).toContain('Active fiscal year');
    expect(text).toContain('General information');
    expect(text).toContain('Entry date');
    expect(text).toContain('Journal');
    expect(text).toContain('Reference');
    expect(text).toContain('Description');
    expect(text).toContain('Entry lines');
    expect(text).toContain('Total debit');
    expect(text).toContain('Total credit');
    expect(text).toContain('Difference');
  });

  it('shows the fiscal-year guard without loading form reference data', async () => {
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();
    await settle();

    expect(fixture.nativeElement.textContent).toContain('Select a fiscal year');
    httpMock.expectNone((request) => request.url === `${apiBaseUrl}/journals`);
  });

  it('constrains the entry date to the active fiscal year', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();

    flushReferenceData();
    await settle();

    const dateInput = fixture.nativeElement.querySelector('input[type="date"]') as HTMLInputElement;

    expect(dateInput.min).toBe('2026-01-01');
    expect(dateInput.max).toBe('2026-12-31');
  });

  it('adds and removes draft lines while keeping at least two lines', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();

    flushReferenceData();
    await settle();

    const component = fixture.componentInstance as unknown as {
      lines: { length: number };
    };
    const addLine = fixture.nativeElement.querySelector(
      '[data-testid="add-entry-line"] button'
    ) as HTMLButtonElement;

    expect(component.lines.length).toBe(2);
    addLine.click();
    await settle();
    expect(component.lines.length).toBe(3);

    const removeButtons = fixture.nativeElement.querySelectorAll(
      '[data-testid="remove-entry-line"] button'
    ) as NodeListOf<HTMLButtonElement>;
    removeButtons[2].click();
    await settle();

    expect(component.lines.length).toBe(2);
  });

  it('uses the searchable account selector for every line', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();

    flushReferenceData();
    await settle();

    const selectors = fixture.nativeElement.querySelectorAll(
      'liass-searchable-select[formcontrolname="accountId"]'
    );

    expect(selectors.length).toBe(2);
  });

  it('rejects debit and credit on the same line', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();

    flushReferenceData();
    await settle();

    const component = fixture.componentInstance as any;
    component.lines.at(0).patchValue({
      accountId: '41100000',
      debit: 1000,
      credit: 500
    });
    await settle();

    expect(component.lines.at(0).hasError('bothDebitAndCredit')).toBe(true);
    expect(fixture.nativeElement.textContent).toContain(
      'A line cannot contain both debit and credit.'
    );
  });

  it('updates totals and difference live and keeps publish disabled while unbalanced', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();

    flushReferenceData();
    await settle();

    const component = fixture.componentInstance as any;
    component.lines.at(0).patchValue({
      accountId: '41100000',
      debit: 125000,
      credit: 0
    });
    component.lines.at(1).patchValue({
      accountId: '70100000',
      debit: 0,
      credit: 100000
    });
    await settle();

    expect(component.totalDebit()).toBe(125000);
    expect(component.totalCredit()).toBe(100000);
    expect(component.difference()).toBe(25000);
    expect(fixture.nativeElement.querySelector('[data-testid="entry-difference"]').textContent)
      .toContain('25');
    expect(fixture.nativeElement.textContent).toContain('The entry must be balanced.');
    expect(
      (fixture.nativeElement.querySelector('[data-testid="publish-entry"] button') as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it('builds a business-only draft model without persistence keys', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();

    flushReferenceData();
    await settle();

    const component = fixture.componentInstance as any;
    component.form.patchValue({
      entryDate: '2026-02-15',
      journalCode: 'VE',
      voucherNumber: 'FAC-001',
      label: 'Customer sale'
    });
    component.lines.at(0).patchValue({
      accountId: '41100000',
      thirdPartyId: 'CLIENT-001',
      debit: 1000,
      credit: 0
    });
    component.lines.at(1).patchValue({
      accountId: '70100000',
      debit: 0,
      credit: 1000
    });

    const model = component.draftModel();
    const serialized = JSON.stringify(model);

    expect(model.year).toBe(2026);
    expect(model.lines[0]).toMatchObject({
      accountId: '41100000',
      thirdPartyId: 'CLIENT-001',
      debit: 1000,
      credit: 0
    });
    expect(serialized).not.toContain('PK');
    expect(serialized).not.toContain('SK');
    expect(serialized).not.toContain('GSI');
    expect(serialized).not.toContain('entityType');
  });

  function selectFiscalYear(): void {
    TestBed.inject(AccountingFiscalYearContextService).selectFiscalYear({
      accountingFramework: 'SYSCOHADA_REVISED',
      endDate: '2026-12-31',
      fiscalYearId: 'FY-2026',
      startDate: '2026-01-01',
      status: 'OPEN',
      year: 2026
    });
  }

  function flushReferenceData(): void {
    httpMock.expectOne((request) => request.url === `${apiBaseUrl}/accounts`).flush({
      data: {
        accounts: [
          {
            accountId: '41100000',
            accountName: 'Customers',
            accountNature: 'BALANCE',
            accountUsage: 'BOTH',
            isThirdPartyAccount: true,
            classCode: 4,
            financialStatementCode: 'BS',
            allowReconciliation: true
          },
          {
            accountId: '70100000',
            accountName: 'Sales',
            accountNature: 'INCOME',
            accountUsage: 'CREDIT_ONLY',
            isThirdPartyAccount: false,
            classCode: 7,
            financialStatementCode: 'IS',
            allowReconciliation: false
          }
        ],
        hasMore: false
      }
    });
    httpMock.expectOne(`${apiBaseUrl}/journals`).flush({
      data: [
        {
          journalCode: 'VE',
          journalName: 'Sales',
          type: 'SALE',
          year: 2026
        }
      ]
    });
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 25));
    fixture.detectChanges();
  }
});
