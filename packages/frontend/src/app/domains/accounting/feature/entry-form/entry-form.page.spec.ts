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
            ACCOUNT: 'Account',
            CREDIT: 'Credit',
            DEBIT: 'Debit',
            DESCRIPTION: 'Detailed line entry will be enabled later.',
            EMPTY_DESCRIPTION: 'The line editor will be added later.',
            EMPTY_TITLE: 'No lines entered',
            LABEL: 'Label',
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
            DATE_REQUIRED: 'Select an entry date.',
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

    flushJournals();
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

    flushJournals();
    await settle();

    const dateInput = fixture.nativeElement.querySelector('input[type="date"]') as HTMLInputElement;

    expect(dateInput.min).toBe('2026-01-01');
    expect(dateInput.max).toBe('2026-12-31');
  });

  it('keeps line editing, draft save, and posting disabled in the skeleton', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();

    flushJournals();
    await settle();

    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    const addLine = buttons.find((button) => button.textContent?.includes('Add line'));
    const saveDraft = buttons.find((button) => button.textContent?.includes('Save draft'));
    const publish = buttons.find((button) => button.textContent?.includes('Post entry'));

    expect(addLine?.disabled).toBe(true);
    expect(saveDraft?.disabled).toBe(true);
    expect(publish?.disabled).toBe(true);
  });

  it('does not display persistence keys', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();

    flushJournals();
    await settle();

    const text = fixture.nativeElement.textContent;

    expect(text).not.toContain('PK');
    expect(text).not.toContain('SK');
    expect(text).not.toContain('GSI');
    expect(text).not.toContain('entityType');
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

  function flushJournals(): void {
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
