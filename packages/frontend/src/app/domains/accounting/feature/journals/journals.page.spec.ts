import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';

import { environment } from '../../../../../environments/environment';
import { JournalsPage } from './journals.page';

const translations = {
  en: {
    ACCOUNTING: {
      ERRORS: {
        CREATE_JOURNAL_FAILED: 'The journal could not be created.',
        DISABLE_JOURNAL_FAILED: 'The journal could not be disabled.',
        LOAD_FAILED: 'Accounting data could not be loaded.',
        UPDATE_JOURNAL_FAILED: 'The journal could not be updated.'
      },
      JOURNALS: {
        ACTIONS: {
          CLEAR_FILTERS: 'Reset',
          DISABLE_JOURNAL: 'Disable',
          EDIT_JOURNAL: 'Edit',
          NEW_JOURNAL: 'New journal',
          RETRY: 'Retry',
          VIEW_DETAILS: 'View details',
          VIEW_ENTRIES: 'View entries'
        },
        CREATE: {
          EYEBROW: 'Journal book',
          SUBTITLE: 'Create a journal.',
          TITLE: 'Create journal'
        },
        DETAIL: {
          EYEBROW: 'Journal detail',
          PROTECTION: 'Protection',
          SYSTEM_DESCRIPTION: 'This system journal is protected.'
        },
        DISABLE: {
          DESCRIPTION: 'Disabling {{ journalCode }} - {{ journalName }} prevents future use.',
          EYEBROW: 'Disable',
          TITLE: 'Disable this journal?'
        },
        EDIT: {
          EYEBROW: 'Journal book',
          SUBTITLE: 'Update a journal.',
          TITLE: 'Edit journal'
        },
        EMPTY: {
          DESCRIPTION: 'No journal is configured.',
          NO_RESULTS_DESCRIPTION: 'Adjust filters.',
          NO_RESULTS_TITLE: 'No journal matches the filters.',
          TITLE: 'No journal loaded'
        },
        EYEBROW: 'Journals',
        FIELDS: {
          CODE: 'Code',
          NAME: 'Label',
          TYPE: 'Type',
          YEAR: 'Fiscal year'
        },
        FILTERS: {
          ALL_SYSTEM: 'All journals',
          ALL_TYPES: 'All types',
          SEARCH: 'Search',
          STANDARD_ONLY: 'Standard journals',
          SYSTEM: 'Origin',
          SYSTEM_ONLY: 'System journals',
          TYPE: 'Type'
        },
        LOADING: 'Loading journals...',
        STATUS: {
          ACTIVE: 'Active'
        },
        SUBTITLE: 'Manage journals.',
        SYSTEM: {
          STANDARD: 'Standard',
          SYSTEM: 'System'
        },
        TABLE: {
          ACTIONS: 'Actions',
          CODE: 'Code',
          DESCRIPTION: 'Available journals.',
          NAME: 'Label',
          STATUS: 'Status',
          SYSTEM: 'Origin',
          TITLE: 'Journals',
          TYPE: 'Type',
          YEAR: 'Fiscal year'
        },
        TITLE: 'Journals',
        TYPES: {
          BANK: 'Bank',
          MISC: 'Miscellaneous',
          PURCHASE: 'Purchases',
          SALE: 'Sales'
        },
        VALIDATION: {
          CODE: 'Enter a journal code.',
          NAME: 'Enter a journal label.',
          TYPE: 'Select a journal type.',
          YEAR: 'Enter a valid fiscal year.'
        }
      }
    },
    COMMON: {
      ACTIONS: {
        CANCEL: 'Cancel',
        CLOSE: 'Close',
        SAVE: 'Save'
      }
    }
  }
};

describe('JournalsPage', () => {
  let fixture: ComponentFixture<JournalsPage>;
  let httpMock: HttpTestingController;
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(async () => {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [
        JournalsPage,
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
        )
      ]
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(JournalsPage);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    httpMock.verify();
  });

  it('shows translated loading feedback while journals are loading', () => {
    const text = fixture.nativeElement.textContent;
    const loadingState = fixture.nativeElement.querySelector('[role="status"]');
    const request = httpMock.expectOne(`${apiBaseUrl}/journals`);

    expect(text).toContain('Loading journals...');
    expect(text).not.toContain('No journal loaded');
    expect(loadingState?.getAttribute('aria-busy')).toBe('true');

    request.flush({ data: [] });
  });

  it('renders journal rows with status and system badges', async () => {
    flushJournals(httpMock, apiBaseUrl, [
      journalFixture({ journalCode: 'RAN', journalName: 'Report a nouveau', type: 'MISC' }),
      journalFixture({ journalCode: 'VE', journalName: 'Ventes', type: 'SALE' })
    ]);
    await settle(fixture);

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('RAN');
    expect(text).toContain('Report a nouveau');
    expect(text).toContain('VE');
    expect(text).toContain('Ventes');
    expect(text).toContain('Active');
    expect(text).toContain('System');
    expect(text).toContain('Standard');
  });

  it('filters journals by search, type, and system origin without another backend call', async () => {
    flushJournals(httpMock, apiBaseUrl, [
      journalFixture({ journalCode: 'RAN', journalName: 'Report a nouveau', type: 'MISC' }),
      journalFixture({ journalCode: 'VE', journalName: 'Ventes locales', type: 'SALE' }),
      journalFixture({ journalCode: 'BQ', journalName: 'Banque principale', type: 'BANK' })
    ]);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      searchQuery: { set: (value: string) => void };
      systemFilter: { set: (value: 'ALL' | 'SYSTEM' | 'STANDARD') => void };
      typeFilter: { set: (value: 'ALL' | 'SALE' | 'BANK' | 'MISC' | 'PURCHASE') => void };
    };
    component.typeFilter.set('SALE');
    component.systemFilter.set('STANDARD');
    component.searchQuery.set('vente');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Ventes locales');
    expect(text).not.toContain('Report a nouveau');
    expect(text).not.toContain('Banque principale');
    httpMock.expectNone(`${apiBaseUrl}/journals`);
  });

  it('shows empty and no-results states only after loading has completed', async () => {
    flushJournals(httpMock, apiBaseUrl, []);
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('No journal loaded');
  });

  it('shows a no-results state when filters hide loaded journals', async () => {
    flushJournals(httpMock, apiBaseUrl, [journalFixture()]);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      searchQuery: { set: (value: string) => void };
    };
    component.searchQuery.set('missing');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No journal matches the filters.');
  });

  it('keeps the error state distinct from loading and empty states', async () => {
    const request = httpMock.expectOne(`${apiBaseUrl}/journals`);

    request.flush({ message: 'Nope' }, { status: 500, statusText: 'Server Error' });
    await settle(fixture);

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Accounting data could not be loaded.');
    expect(text).not.toContain('Loading journals...');
    expect(text).not.toContain('No journal loaded');
  });

  it('creates a journal from the dialog and updates the list without navigation', async () => {
    flushJournals(httpMock, apiBaseUrl, []);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      openCreateJournal: () => void;
    };
    component.openCreateJournal();
    fixture.detectChanges();

    const dialogRef = TestBed.inject(MatDialog).openDialogs[0];
    const dialogInstance = dialogRef.componentInstance as unknown as {
      form: {
        setValue: (value: Record<string, unknown>) => void;
      };
      submit: () => Promise<void>;
    };
    dialogInstance.form.setValue({
      journalCode: 've',
      journalName: 'Ventes',
      type: 'SALE',
      year: 2026
    });

    const submitPromise = dialogInstance.submit();
    const createRequest = httpMock.expectOne(`${apiBaseUrl}/journals`);

    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.body).toEqual({
      journalCode: 'VE',
      journalName: 'Ventes',
      type: 'SALE',
      year: 2026
    });
    createRequest.flush({
      data: journalFixture({ journalCode: 'VE', journalName: 'Ventes', type: 'SALE' })
    });
    await submitPromise;
    await waitForDialogClose();
    await settle(fixture);

    expect(TestBed.inject(MatDialog).openDialogs.length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('VE');
    expect(fixture.nativeElement.textContent).toContain('Ventes');
  });

  it('edits a standard journal while keeping protected identifiers read-only', async () => {
    const existingJournal = journalFixture({ journalCode: 'VE', journalName: 'Ventes', type: 'SALE' });
    flushJournals(httpMock, apiBaseUrl, [existingJournal]);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      openEditJournal: (journal: ReturnType<typeof journalFixture>) => void;
    };
    component.openEditJournal(existingJournal);
    fixture.detectChanges();

    const dialogRef = TestBed.inject(MatDialog).openDialogs[0];
    const dialogInstance = dialogRef.componentInstance as unknown as {
      form: {
        controls: {
          journalCode: { disabled: boolean };
          year: { disabled: boolean };
        };
        patchValue: (value: Record<string, unknown>) => void;
      };
      submit: () => Promise<void>;
    };

    expect(dialogInstance.form.controls.journalCode.disabled).toBe(true);
    expect(dialogInstance.form.controls.year.disabled).toBe(true);
    dialogInstance.form.patchValue({ journalName: 'Ventes export' });

    const submitPromise = dialogInstance.submit();
    const updateRequest = httpMock.expectOne(`${apiBaseUrl}/journals/VE`);

    expect(updateRequest.request.method).toBe('PUT');
    expect(updateRequest.request.body).toEqual({
      journalName: 'Ventes export',
      type: 'SALE',
      year: 2026
    });
    updateRequest.flush({
      data: journalFixture({ journalCode: 'VE', journalName: 'Ventes export', type: 'SALE' })
    });
    await submitPromise;
    await waitForDialogClose();
    await settle(fixture);

    expect(TestBed.inject(MatDialog).openDialogs.length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('Ventes export');
  });

  it('keeps the edit dialog open on failure and prevents duplicate submit', async () => {
    const existingJournal = journalFixture({ journalCode: 'VE', journalName: 'Ventes', type: 'SALE' });
    flushJournals(httpMock, apiBaseUrl, [existingJournal]);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      openEditJournal: (journal: ReturnType<typeof journalFixture>) => void;
    };
    component.openEditJournal(existingJournal);
    fixture.detectChanges();

    const dialogRef = TestBed.inject(MatDialog).openDialogs[0];
    const dialogInstance = dialogRef.componentInstance as unknown as {
      form: {
        patchValue: (value: Record<string, unknown>) => void;
      };
      submit: () => Promise<void>;
    };
    dialogInstance.form.patchValue({ journalName: 'Ventes corrigees' });

    const submitPromise = dialogInstance.submit();
    void dialogInstance.submit();
    const updateRequest = httpMock.expectOne(`${apiBaseUrl}/journals/VE`);

    expect(updateRequest.request.method).toBe('PUT');
    expect(updateRequest.request.body).toMatchObject({
      journalName: 'Ventes corrigees'
    });
    httpMock.expectNone((request) => request.method === 'PUT' && request !== updateRequest.request);
    updateRequest.flush({ message: 'Nope' }, { status: 500, statusText: 'Server Error' });
    await submitPromise;
    await settle(fixture);

    expect(TestBed.inject(MatDialog).openDialogs.length).toBe(1);
    expect(document.body.textContent).toContain('The journal could not be updated.');
  });

  it('does not open edit dialogs for protected system journals', async () => {
    const systemJournal = journalFixture({ journalCode: 'RAN', journalName: 'Report a nouveau' });
    flushJournals(httpMock, apiBaseUrl, [systemJournal]);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      canEditJournal: (journal: ReturnType<typeof journalFixture>) => boolean;
      openEditJournal: (journal: ReturnType<typeof journalFixture>) => void;
    };

    expect(component.canEditJournal(systemJournal)).toBe(false);
    component.openEditJournal(systemJournal);
    fixture.detectChanges();

    expect(TestBed.inject(MatDialog).openDialogs.length).toBe(0);
  });

  it('opens journal details in a drawer with protection context', async () => {
    const journal = journalFixture({ journalCode: 'VE', journalName: 'Ventes', type: 'SALE' });
    flushJournals(httpMock, apiBaseUrl, [journal]);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      openJournalDetails: (journal: ReturnType<typeof journalFixture>) => void;
    };
    component.openJournalDetails(journal);
    fixture.detectChanges();
    await settle(fixture);

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Journal detail');
    expect(text).toContain('VE');
    expect(text).toContain('Ventes');
    expect(text).toContain('Protection');
    expect(text).toContain('Standard');
  });

  it('disables a standard journal through confirmation and refreshes the list', async () => {
    const journal = journalFixture({ journalCode: 'VE', journalName: 'Ventes', type: 'SALE' });
    flushJournals(httpMock, apiBaseUrl, [
      journal,
      journalFixture({ journalCode: 'AC', journalName: 'Achats', type: 'PURCHASE' })
    ]);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      openDisableJournal: (journal: ReturnType<typeof journalFixture>) => void;
    };
    component.openDisableJournal(journal);
    fixture.detectChanges();

    const dialogRef = TestBed.inject(MatDialog).openDialogs[0];
    const dialogInstance = dialogRef.componentInstance as unknown as {
      confirm: () => Promise<void>;
    };
    const confirmPromise = dialogInstance.confirm();
    const disableRequest = httpMock.expectOne(`${apiBaseUrl}/journals/VE`);

    expect(disableRequest.request.method).toBe('DELETE');
    disableRequest.flush({ data: {} });
    await confirmPromise;
    await waitForDialogClose();
    await settle(fixture);

    expect(TestBed.inject(MatDialog).openDialogs.length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('Achats');
    expect(fixture.nativeElement.textContent).not.toContain('Ventes');
    httpMock.expectNone(`${apiBaseUrl}/journals`);
  });

  it('keeps the disable confirmation open on failure and prevents duplicate submit', async () => {
    const journal = journalFixture({ journalCode: 'VE', journalName: 'Ventes', type: 'SALE' });
    flushJournals(httpMock, apiBaseUrl, [journal]);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      openDisableJournal: (journal: ReturnType<typeof journalFixture>) => void;
    };
    component.openDisableJournal(journal);
    fixture.detectChanges();

    const dialogRef = TestBed.inject(MatDialog).openDialogs[0];
    const dialogInstance = dialogRef.componentInstance as unknown as {
      confirm: () => Promise<void>;
    };
    const confirmPromise = dialogInstance.confirm();
    void dialogInstance.confirm();
    const disableRequest = httpMock.expectOne(`${apiBaseUrl}/journals/VE`);

    expect(disableRequest.request.method).toBe('DELETE');
    httpMock.expectNone((request) => request.method === 'DELETE' && request !== disableRequest.request);
    disableRequest.flush({ message: 'Nope' }, { status: 500, statusText: 'Server Error' });
    await confirmPromise;
    await settle(fixture);

    expect(TestBed.inject(MatDialog).openDialogs.length).toBe(1);
    expect(document.body.textContent).toContain('The journal could not be disabled.');
  });

  it('does not open disable confirmation for protected system journals', async () => {
    const systemJournal = journalFixture({ journalCode: 'RAN', journalName: 'Report a nouveau' });
    flushJournals(httpMock, apiBaseUrl, [systemJournal]);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      canDisableJournal: (journal: ReturnType<typeof journalFixture>) => boolean;
      openDisableJournal: (journal: ReturnType<typeof journalFixture>) => void;
    };

    expect(component.canDisableJournal(systemJournal)).toBe(false);
    component.openDisableJournal(systemJournal);
    fixture.detectChanges();

    expect(TestBed.inject(MatDialog).openDialogs.length).toBe(0);
    httpMock.expectNone(`${apiBaseUrl}/journals/RAN`);
  });
});

function flushJournals(
  httpMock: HttpTestingController,
  apiBaseUrl: string,
  journals: ReturnType<typeof journalFixture>[]
): void {
  const request = httpMock.expectOne(`${apiBaseUrl}/journals`);

  expect(request.request.method).toBe('GET');
  request.flush({ data: journals });
}

function journalFixture(
  overrides: Partial<{
    journalCode: string;
    journalName: string;
    type: 'PURCHASE' | 'SALE' | 'BANK' | 'MISC';
    year: number;
  }> = {}
) {
  return {
    journalCode: 'OD',
    journalName: 'Operations diverses',
    type: 'MISC',
    year: 2026,
    ...overrides
  };
}

async function settle(fixture: ComponentFixture<JournalsPage>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

async function waitForDialogClose(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 250));
}
