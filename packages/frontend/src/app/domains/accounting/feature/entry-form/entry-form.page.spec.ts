import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { type AccountDto } from '@liass-ohada/shared/accounting';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { NotificationService } from '../../../../core/notifications/notification.service';
import { environment } from '../../../../../environments/environment';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { CabinetDossiersApi } from '../../../identity/data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../../identity/data-access/workspaces.api';
import { ThirdPartySelectComponent } from '../../ui/third-party-search-select/third-party-search-select.component';
import { EntryFormPage } from './entry-form.page';

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
          ERRORS: {
            CREATE_FAILED: 'The draft could not be saved.',
            UPDATE_FAILED: 'The draft changes could not be saved.'
          },
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
          NOTIFICATIONS: {
            CREATED: 'Entry draft saved.',
            UPDATED: 'Entry draft updated.'
          },
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
            LABEL_REQUIRED: 'Enter a label.',
            THIRD_PARTY_REQUIRED: 'Select a third party for this auxiliary account.',
            THIRD_PARTY_TYPE_UNSUPPORTED: 'This auxiliary account requires a third party type.'
          }
        },
        TOTALS: {
          CREDIT: 'Total credit',
          DEBIT: 'Total debit'
        },
        NOTIFICATIONS: {
          POST_FAILED: 'The entry could not be posted.',
          POSTED: 'The entry was posted.'
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
  const activatedRouteStub = {
    snapshot: {
      paramMap: convertToParamMap({})
    }
  };
  const notification = {
    error: vi.fn(),
    success: vi.fn()
  };
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(async () => {
    localStorage.clear();
    activatedRouteStub.snapshot.paramMap = convertToParamMap({});
    notification.error.mockReset();
    notification.success.mockReset();

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
          useValue: activatedRouteStub
        },
        { provide: NotificationService, useValue: notification },
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
      'liass-account-search-select[formcontrolname="accountId"]'
    );

    expect(selectors.length).toBe(2);
  });

  it('does not show a third-party selector when no account is selected', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();

    flushReferenceData();
    await settle();

    expect(fixture.nativeElement.querySelector('liass-third-party-select')).toBeNull();
  });

  it('shows a CUSTOMER third-party selector for a customer auxiliary account', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();
    flushReferenceData();
    await settle();

    setLineAccount(0, accountDtoFixture('41110000', 'Clients', 'CUSTOMER'));
    await flushThirdPartyList('CUSTOMER');
    await settle();

    const selector = thirdPartySelectorAt(0);
    expect(selector).toBeTruthy();
    expect(selector.type()).toBe('CUSTOMER');
    expect(fixture.nativeElement.textContent).toContain(
      'Select a third party for this auxiliary account.'
    );
  });

  it('shows a SUPPLIER third-party selector for a supplier auxiliary account', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();
    flushReferenceData();
    await settle();

    setLineAccount(0, accountDtoFixture('40110000', 'Fournisseurs', 'SUPPLIER'));
    await flushThirdPartyList('SUPPLIER');
    await settle();

    const selector = thirdPartySelectorAt(0);
    expect(selector).toBeTruthy();
    expect(selector.type()).toBe('SUPPLIER');
  });

  it('hides and clears the third-party selector for a non-auxiliary account', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();
    flushReferenceData();
    await settle();

    setLineAccount(0, accountDtoFixture('41110000', 'Clients', 'CUSTOMER'));
    await flushThirdPartyList('CUSTOMER');
    await settle();
    selectLineThirdParty(0, 'tp-cust-alpha');
    expect(firstLine().controls.thirdPartyId.value).toBe('tp-cust-alpha');

    setLineAccount(0, accountDtoFixture('52110000', 'Banque'));
    await settle();

    expect(thirdPartySelectorAt(0)).toBeNull();
    expect(firstLine().controls.thirdPartyId.value).toBe('');
    expect(firstLine().controls.thirdPartyType.value).toBe('');
  });

  it('clears a selected customer when switching to a supplier auxiliary account', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();
    flushReferenceData();
    await settle();

    setLineAccount(0, accountDtoFixture('41110000', 'Clients', 'CUSTOMER'));
    await flushThirdPartyList('CUSTOMER');
    await settle();
    selectLineThirdParty(0, 'tp-cust-alpha');

    setLineAccount(0, accountDtoFixture('40110000', 'Fournisseurs', 'SUPPLIER'));
    await flushThirdPartyList('SUPPLIER');
    await settle();

    expect(firstLine().controls.thirdPartyId.value).toBe('');
    expect(firstLine().controls.thirdPartyType.value).toBe('');
    selectLineThirdParty(0, 'tp-sup-beta');
    expect(firstLine().controls.thirdPartyId.value).toBe('tp-sup-beta');
    expect(firstLine().controls.thirdPartyType.value).toBe('SUPPLIER');
  });

  it('clears a selected third party when switching from auxiliary to non-auxiliary', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();
    flushReferenceData();
    await settle();

    setLineAccount(0, accountDtoFixture('41110000', 'Clients', 'CUSTOMER'));
    await flushThirdPartyList('CUSTOMER');
    await settle();
    selectLineThirdParty(0, 'tp-cust-alpha');

    setLineAccount(0, accountDtoFixture('70110000', 'Ventes'));
    await settle();

    expect(firstLine().controls.thirdPartyId.value).toBe('');
    expect(firstLine().controls.thirdPartyType.value).toBe('');
    expect(thirdPartySelectorAt(0)).toBeNull();
  });

  it('keeps debit and credit mutually exclusive while entering a line amount', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();

    flushReferenceData();
    await settle();

    const component = fixture.componentInstance as any;
    component.lines.at(0).patchValue({
      accountId: '41100000',
      credit: 500
    });
    fixture.detectChanges();

    const firstRow = fixture.nativeElement.querySelector(
      '[data-testid="entry-line-row"]'
    ) as HTMLTableRowElement;
    const debitInput = firstRow.querySelector(
      'input[formcontrolname="debit"]'
    ) as HTMLInputElement;
    debitInput.value = '1000';
    debitInput.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    expect(component.lines.at(0).controls.debit.value).toBe(1000);
    expect(component.lines.at(0).controls.credit.value).toBe(0);
    expect(component.lines.at(0).hasError('bothDebitAndCredit')).toBe(false);

    const creditInput = firstRow.querySelector(
      'input[formcontrolname="credit"]'
    ) as HTMLInputElement;
    creditInput.value = '750';
    creditInput.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    expect(component.lines.at(0).controls.debit.value).toBe(0);
    expect(component.lines.at(0).controls.credit.value).toBe(750);
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
    setLineAccount(0, accountDtoFixture('41110000', 'Clients', 'CUSTOMER'));
    await flushThirdPartyList('CUSTOMER');
    await settle();
    selectLineThirdParty(0, 'tp-cust-alpha');
    component.lines.at(0).patchValue({
      debit: 1000,
      credit: 0
    });
    setLineAccount(1, accountDtoFixture('70110000', 'Ventes'));
    component.lines.at(1).patchValue({
      debit: 0,
      credit: 1000
    });

    const model = component.draftModel();
    const serialized = JSON.stringify(model);

    expect(model.year).toBe(2026);
    expect(model.lines[0]).toMatchObject({
      accountId: '41110000',
      thirdPartyId: 'tp-cust-alpha',
      thirdPartyType: 'CUSTOMER',
      debit: 1000,
      credit: 0
    });
    expect(model.lines[1]).toEqual({
      accountId: '70110000',
      debit: 0,
      credit: 1000
    });
    expect(serialized).not.toContain('PK');
    expect(serialized).not.toContain('SK');
    expect(serialized).not.toContain('GSI');
    expect(serialized).not.toContain('entityType');
  });

  it('submits supplier auxiliary lines with thirdPartyId and thirdPartyType SUPPLIER', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();

    flushReferenceData();
    await settle();
    const component = fixture.componentInstance as any;

    setLineAccount(0, accountDtoFixture('40110000', 'Fournisseurs', 'SUPPLIER'));
    await flushThirdPartyList('SUPPLIER');
    await settle();
    selectLineThirdParty(0, 'tp-sup-beta');
    component.lines.at(0).patchValue({ debit: 1000, credit: 0 });
    setLineAccount(1, accountDtoFixture('60110000', 'Achats'));
    component.lines.at(1).patchValue({ debit: 0, credit: 1000 });

    expect(component.draftModel().lines[0]).toMatchObject({
      accountId: '40110000',
      thirdPartyId: 'tp-sup-beta',
      thirdPartyType: 'SUPPLIER'
    });
  });

  it('blocks submission with an inline error until a required third party is selected', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();

    flushReferenceData();
    await settle();
    const component = fixture.componentInstance as any;

    component.form.patchValue({
      entryDate: '2026-02-15',
      journalCode: 'VE',
      label: 'Customer sale'
    });
    setLineAccount(0, accountDtoFixture('41110000', 'Clients', 'CUSTOMER'));
    await flushThirdPartyList('CUSTOMER');
    setLineAccount(1, accountDtoFixture('70110000', 'Ventes'));
    component.lines.at(0).patchValue({ debit: 1000, credit: 0 });
    component.lines.at(1).patchValue({ debit: 0, credit: 1000 });
    await settle();

    expect(component.form.invalid).toBe(true);
    expect(saveDraftButton().disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain(
      'Select a third party for this auxiliary account.'
    );

    selectLineThirdParty(0, 'tp-cust-alpha');
    await settle();

    expect(component.form.valid).toBe(true);
    expect(saveDraftButton().disabled).toBe(false);
  });

  it('uses the reusable third-party selector without displaying internal ids', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();

    flushReferenceData();
    await settle();

    setLineAccount(0, accountDtoFixture('41110000', 'Clients', 'CUSTOMER'));
    await flushThirdPartyList('CUSTOMER');
    await settle();
    selectLineThirdParty(0, 'tp-cust-alpha');
    await settle();

    expect(thirdPartySelectorAt(0)).toBeTruthy();
    expect(thirdPartyInputAt(0).value).toBe('Client Alpha');
    expect(thirdPartyInputAt(0).value).not.toContain('CUST-ALPHA');
    expect(fixture.nativeElement.textContent).not.toContain('CUST-ALPHA');
    expect(fixture.nativeElement.textContent).not.toContain('tp-cust-alpha');
    expect(fixture.nativeElement.innerHTML).toContain('dark:');
  });

  it('creates a draft with business identifiers, uses the backend message, and opens edit mode', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();
    flushReferenceData();
    await settle();
    await fillValidDraft();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const savePromise = (fixture.componentInstance as any).saveDraft();
    await settleDynamicImport();
    const request = httpMock.expectOne(`${apiBaseUrl}/entries/drafts`);

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      year: 2026,
      entryDate: '2026-02-15',
      journalCode: 'VE',
      voucherNumber: 'FAC-001',
      entryType: 'STANDARD',
      label: 'Customer sale',
      lines: [
        {
          accountId: '41110000',
          thirdPartyId: 'tp-cust-alpha',
          thirdPartyType: 'CUSTOMER',
          debit: 1000,
          credit: 0
        },
        {
          accountId: '70110000',
          debit: 0,
          credit: 1000
        }
      ]
    });
    expect(JSON.stringify(request.request.body)).not.toMatch(/PK|SK|GSI|entityType|orgId/);
    request.flush({
      message: { code: 'SUCCESS_ENTRY_DRAFT_CREATED', message: 'Draft saved by service.' },
      data: entryDetailFixture()
    });
    await savePromise;

    expect(notification.success).toHaveBeenCalledWith('Draft saved by service.');
    expect(navigate).toHaveBeenCalledWith(
      ['/accounting/entries', 'ENTRY-001', 'edit'],
      { replaceUrl: true }
    );
  });

  it('uses the translated create fallback only when the response has no message', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();
    flushReferenceData();
    await settle();
    await fillValidDraft();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const savePromise = (fixture.componentInstance as any).saveDraft();
    await settleDynamicImport();
    httpMock.expectOne(`${apiBaseUrl}/entries/drafts`).flush({
      data: entryDetailFixture()
    });
    await savePromise;

    expect(notification.success).toHaveBeenCalledWith('Entry draft saved.');
  });

  it('posts a balanced new entry by saving it as a draft first', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();
    flushReferenceData();
    await settle();
    await fillValidDraft();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    expect(publishButton().disabled).toBe(false);

    const publishPromise = (fixture.componentInstance as any).publishEntry();
    await settleDynamicImport();
    const createRequest = httpMock.expectOne(`${apiBaseUrl}/entries/drafts`);

    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.body).toMatchObject({
      year: 2026,
      entryDate: '2026-02-15',
      journalCode: 'VE',
      label: 'Customer sale'
    });
    createRequest.flush({
      data: entryDetailFixture({ entryId: 'ENTRY-POST' })
    });
    await settleDynamicImport();
    const postRequest = httpMock.expectOne(`${apiBaseUrl}/entries/ENTRY-POST/post`);

    expect(postRequest.request.method).toBe('POST');
    expect(postRequest.request.body).toEqual({ year: 2026 });
    postRequest.flush({
      message: { code: 'SUCCESS_ENTRY_POSTED', message: 'Entry posted by accounting.' },
      entryId: 'ENTRY-POST'
    });
    await publishPromise;

    expect(notification.success).toHaveBeenCalledWith('Entry posted by accounting.');
    expect(navigate).toHaveBeenCalledWith(['/accounting/entries']);
  });

  it('updates an existing draft and keeps the user on the edit form', async () => {
    activatedRouteStub.snapshot.paramMap = convertToParamMap({ entryId: 'ENTRY-001' });
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();
    flushReferenceData();
    await settleDynamicImport();
    httpMock.expectOne((request) => request.url === `${apiBaseUrl}/entries/ENTRY-001`).flush({
      data: entryDetailFixture()
    });
    await flushAccountDetail(accountDtoFixture('41110000', 'Clients', 'CUSTOMER'));
    await flushAccountDetail(accountDtoFixture('70110000', 'Ventes'));
    await flushThirdPartyList('CUSTOMER');
    await settle();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const savePromise = (fixture.componentInstance as any).saveDraft();
    await settleDynamicImport();
    const request = httpMock.expectOne(`${apiBaseUrl}/entries/ENTRY-001/draft`);

    expect(request.request.method).toBe('PUT');
    expect(request.request.body.year).toBe(2026);
    expect(request.request.body.lines).toHaveLength(2);
    expect(request.request.body).not.toHaveProperty('entryId');
    request.flush({
      message: 'Draft updated by service.',
      data: entryDetailFixture({ label: 'Updated draft' })
    });
    await savePromise;

    expect(notification.success).toHaveBeenCalledWith('Draft updated by service.');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps form values and uses the backend error message when draft creation fails', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();
    flushReferenceData();
    await settle();
    await fillValidDraft();

    const savePromise = (fixture.componentInstance as any).saveDraft();
    await settleDynamicImport();
    httpMock.expectOne(`${apiBaseUrl}/entries/drafts`).flush(
      {
        message: {
          code: 'ERROR_ENTRY_DRAFT_REJECTED',
          message: 'This draft cannot be saved for the selected period.'
        }
      },
      { status: 400, statusText: 'Bad Request' }
    );
    await savePromise;

    expect(notification.error).toHaveBeenCalledWith(
      'This draft cannot be saved for the selected period.'
    );
    expect((fixture.componentInstance as any).form.controls.label.value).toBe('Customer sale');
    expect((fixture.componentInstance as any).lines.at(0).controls.accountId.value).toBe(
      '41110000'
    );
  });

  it('uses the translated error fallback when no safe backend message exists', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();
    flushReferenceData();
    await settle();
    await fillValidDraft();

    const savePromise = (fixture.componentInstance as any).saveDraft();
    await settleDynamicImport();
    httpMock.expectOne(`${apiBaseUrl}/entries/drafts`).flush(
      { message: 'ConditionalCheckFailedException from DynamoDB' },
      { status: 500, statusText: 'Server Error' }
    );
    await savePromise;

    expect(notification.error).toHaveBeenCalledWith('The draft could not be saved.');
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

  async function fillValidDraft(): Promise<void> {
    const component = fixture.componentInstance as any;

    component.form.patchValue({
      entryDate: '2026-02-15',
      journalCode: 'VE',
      voucherNumber: 'FAC-001',
      label: 'Customer sale'
    });
    setLineAccount(0, accountDtoFixture('41110000', 'Clients', 'CUSTOMER'));
    await flushThirdPartyList('CUSTOMER');
    component.lines.at(0).patchValue({
      thirdPartyId: 'tp-cust-alpha',
      thirdPartyType: 'CUSTOMER',
      debit: 1000,
      credit: 0
    });
    setLineAccount(1, accountDtoFixture('70110000', 'Ventes'));
    component.lines.at(1).patchValue({
      debit: 0,
      credit: 1000
    });
    fixture.detectChanges();
  }

  function firstLine(): any {
    return (fixture.componentInstance as any).lines.at(0);
  }

  function setLineAccount(index: number, account: AccountDto): void {
    const component = fixture.componentInstance as any;
    const line = component.lines.at(index);
    line.controls.accountId.setValue(account.accountId);
    component.handleLineAccountSelected(line, account);
    fixture.detectChanges();
  }

  function thirdPartySelectorAt(index: number): any | null {
    const row = fixture.debugElement.queryAll(By.css('[data-testid="entry-line-row"]'))[index];
    return row?.query(By.directive(ThirdPartySelectComponent))?.componentInstance ?? null;
  }

  function thirdPartyInputAt(index: number): HTMLInputElement {
    const row = fixture.nativeElement.querySelectorAll('[data-testid="entry-line-row"]')[
      index
    ] as HTMLElement;
    return row.querySelector('liass-third-party-select input') as HTMLInputElement;
  }

  function selectLineThirdParty(index: number, thirdPartyId: string): void {
    const selector = thirdPartySelectorAt(index);
    if (!selector) {
      throw new Error(`Third-party selector at line ${index} was not rendered.`);
    }
    selector.selectOption({ option: { value: thirdPartyId } });
    fixture.detectChanges();
  }

  function saveDraftButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="save-entry-draft"] button');
  }

  function publishButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="publish-entry"] button');
  }

  async function flushThirdPartyList(type: 'CUSTOMER' | 'SUPPLIER'): Promise<void> {
    const request = await expectOneEventually((candidate) => {
      return (
        candidate.url === `${apiBaseUrl}/third-parties` &&
        candidate.params.get('type') === type &&
        candidate.params.get('status') === 'ACTIVE' &&
        candidate.params.get('limit') === '200'
      );
    });

    request.flush({
      data: {
        hasMore: false,
        items:
          type === 'CUSTOMER'
            ? [thirdPartyDtoFixture('tp-cust-alpha', 'CUST-ALPHA', 'Client Alpha', 'CUSTOMER')]
            : [thirdPartyDtoFixture('tp-sup-beta', 'SUP-BETA', 'Fournisseur Beta', 'SUPPLIER')]
      }
    });
  }

  async function flushAccountDetail(account: AccountDto): Promise<void> {
    const request = await expectOneEventually(`${apiBaseUrl}/accounts/${account.accountId}`);
    request.flush({ account });
  }

  async function expectOneEventually(
    match: Parameters<HttpTestingController['expectOne']>[0]
  ) {
    let lastError: unknown;

    for (let index = 0; index < 30; index += 1) {
      try {
        return httpMock.expectOne(match);
      } catch (error) {
        lastError = error;
        await settleDynamicImport();
        fixture.detectChanges();
      }
    }

    throw lastError;
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 25));
    fixture.detectChanges();
  }

  async function settleDynamicImport(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
});

function entryDetailFixture(overrides: Record<string, unknown> = {}) {
  return {
    entryId: 'ENTRY-001',
    year: 2026,
    entryDate: '2026-02-15',
    journalCode: 'VE',
    voucherNumber: 'FAC-001',
    entryType: 'STANDARD',
    label: 'Customer sale',
    totalDebit: 1000,
    totalCredit: 1000,
    status: 'DRAFT',
    lines: [
      {
        lineId: 'LINE-001',
        accountId: '41110000',
        debit: 1000,
        credit: 0,
        thirdPartyId: 'tp-cust-alpha',
        thirdPartyType: 'CUSTOMER'
      },
      {
        lineId: 'LINE-002',
        accountId: '70110000',
        debit: 0,
        credit: 1000
      }
    ],
    ...overrides
  };
}

function accountDtoFixture(
  accountId: string,
  accountName: string,
  auxiliaryType?: 'CUSTOMER' | 'SUPPLIER' | 'THIRD_PARTY'
): AccountDto {
  return {
    accountId,
    accountName,
    accountNature: accountId.startsWith('7') || accountId.startsWith('6') ? 'INCOME' : 'BALANCE',
    accountUsage: 'BOTH',
    allowReconciliation: true,
    auxiliaryType: auxiliaryType ?? 'NONE',
    classCode: Number(accountId.charAt(0)),
    financialStatementCode: 'BS',
    isActive: true,
    isThirdPartyAccount: !!auxiliaryType,
    requiresThirdParty: !!auxiliaryType
  };
}

function thirdPartyDtoFixture(
  thirdPartyId: string,
  code: string,
  displayName: string,
  type: 'CUSTOMER' | 'SUPPLIER'
) {
  return {
    code,
    createdAt: '2026-01-01T00:00:00.000Z',
    displayName,
    status: 'ACTIVE' as const,
    thirdPartyId,
    type,
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}
