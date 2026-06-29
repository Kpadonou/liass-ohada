import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import {
  type AccountDto,
  type LetteringMatchDto,
  type ThirdPartyDto,
  type UnletteredLineDto
} from '@liass-ohada/shared/accounting';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { NotificationService } from '../../../../core/notifications/notification.service';
import { environment } from '../../../../../environments/environment';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { LetteringPage } from './lettering.page';

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
      ERRORS: {
        LOAD_FAILED: 'Accounting data could not be loaded.'
      },
      LETTERING: {
        ACTIONS: {
          CANCEL_GROUP: 'Cancel lettering',
          LOAD: 'Load',
          POST: 'Letter',
          RETRY: 'Retry'
        },
        CONTEXT: {
          DOSSIER: 'Active dossier'
        },
        CONFIRM: {
          CANCEL_MESSAGE: 'This restores the selected lines to the lettering queue.',
          CANCEL_TITLE: 'Cancel lettering?',
          CANCEL_WARNING: 'The accounting entry remains unchanged.',
          CREATE_MESSAGE: 'Create a balanced lettering match for these lines.',
          CREATE_TITLE: 'Confirm lettering'
        },
        EMPTY_SCOPE: 'Select an auxiliary account and a third party to load lines.',
        EMPTY_SCOPE_TITLE: 'Define the scope',
        ERRORS: {
          ALLOCATION_INVALID: 'Correct allocation amounts before confirming.',
          ALLOCATION_POSITIVE: 'Enter a positive amount.',
          ALLOCATION_TOO_HIGH: 'Maximum: {{remaining}}.',
          AMOUNT_RANGE: 'The minimum amount must be less than or equal to the maximum amount.',
          DATE_RANGE: 'The start date must be before the end date.',
          LOAD_FAILED: 'Lettering lines could not be loaded. Try again.',
          POST_FAILED: 'Lettering could not be saved.',
          SELECTION_REQUIRED: 'Select balanced debit and credit lines.',
          THIRD_PARTY_REQUIRED: 'Select a third party.'
        },
        EYEBROW: 'Auxiliary accounts',
        FIELDS: {
          ACCOUNT: 'Third-party account',
          DATE_FROM: 'From',
          DATE_TO: 'To',
          FISCAL_YEAR: 'Fiscal year',
          MAX_REMAINING: 'Maximum remaining',
          MIN_REMAINING: 'Minimum remaining',
          REFERENCE: 'Reference or label',
          THIRD_PARTY: 'Third party',
          THIRD_PARTY_TYPE: 'Third-party type'
        },
        FILTERS: {
          ADVANCED: 'Advanced filters',
          DESCRIPTION: 'Auxiliary account, third party, and work filters.',
          TITLE: 'Scope'
        },
        LATEST_MATCH: {
          CREATED_AT: 'Created at',
          DESCRIPTION: 'Last operation created from this page.',
          TOTAL: 'Lettered total',
          TITLE: 'Latest match'
        },
        LINE_TYPES: {
          CREDIT: 'Credit',
          DEBIT: 'Debit'
        },
        LOADING: 'Loading lettering candidates...',
        MATCH_STATUS: {
          ACTIVE: 'Active',
          CANCELLED: 'Cancelled'
        },
        MESSAGES: {
          CANCELLED: 'Lettering cancelled.',
          POSTED: 'Lettering saved.'
        },
        METRICS: {
          DIFFERENCE: 'Difference',
          SELECTED_CREDIT: 'Selected credit',
          SELECTED_DEBIT: 'Selected debit',
          SELECTED_LINES: 'Selected lines'
        },
        REPORT: {
          GROUP_LINES: '{{count}} line(s)'
        },
        SELECTED_PREVIEW: {
          TITLE: 'Selection'
        },
        SELECTION_HELP: 'Select debit and credit lines with equal totals.',
        STATUS: {
          LETTERED: 'Lettered',
          PARTIAL: 'Partial',
          UNLETTERED: 'Unlettered'
        },
        SUBTITLE: 'Match posted auxiliary debit and credit lines.',
        SUGGESTIONS: {
          DESCRIPTION: 'Suggestions from loaded lines.',
          EXACT: '{{amount}} balanced',
          PARTIAL: '{{amount}} partial',
          PARTIAL_BADGE: 'Partial',
          TITLE: 'Matching suggestions'
        },
        SUMMARY: {
          BALANCED: 'Balanced',
          DIFFERENCE: 'Difference to letter',
          STATUS: 'Status',
          TITLE: 'Lettering summary'
        },
        TABLE: {
          ALLOCATION: 'Allocation',
          CREDIT: 'Credit',
          DATE: 'Date',
          DEBIT: 'Debit',
          ENTRY: 'Entry',
          JOURNAL: 'Journal',
          LABEL: 'Label',
          REFERENCE: 'Reference',
          REMAINING: 'Remaining',
          SELECT: 'Select',
          SELECT_LINE: 'Select line',
          STATUS: 'Status'
        },
        THIRD_PARTY_TYPES: {
          CUSTOMER: 'Customer',
          CUSTOMER_PLURAL: 'Customers',
          SUPPLIER_PLURAL: 'Suppliers',
          SUPPLIER: 'Supplier'
        },
        THIRD_PARTY_SELECT: {
          LOAD_MORE: 'Load more third parties',
          LOADING: 'Loading third parties...',
          NO_RESULTS: 'No third party found',
          PLACEHOLDER: 'Search by third-party code or name',
          TYPE_TO_SEARCH: 'Type a third-party code or name'
        },
        TITLE: 'Lettering',
        UNLETTERED: {
          DESCRIPTION: 'Select lines to match or apply a suggestion.',
          EMPTY: 'No unlettered line for this third party.',
          EMPTY_TITLE: 'No line to letter',
          TITLE: 'Unlettered lines',
          TOTAL: 'Unlettered lines'
        }
      }
    },
    COMMON: {
      ACTIONS: {
        CANCEL: 'Cancel'
      },
      SELECT: {
        NO_RESULTS: 'No results',
        SEARCH_PLACEHOLDER: 'Search...'
      }
    }
  }
};

interface TestableLetteringPage {
  allocationAmount: (line: UnletteredLineDto) => number;
  applySuggestion: (suggestion: {
    amount: number;
    debitLine: UnletteredLineDto;
    creditLine: UnletteredLineDto;
  }) => void;
  applyFilters: () => void;
  canLoadScope: () => boolean;
  canCreateMatch: () => boolean;
  candidates: () => UnletteredLineDto[];
  confirmCancelLatestMatch: () => Promise<void>;
  confirmCreateMatch: () => Promise<void>;
  handleAccountSelected: (account: AccountDto | null) => void;
  handleThirdPartySelected: (thirdParty: ThirdPartyDto | null) => void;
  form: {
    controls: {
      accountId: { setValue: (value: string) => void };
      dateFrom: { setValue: (value: string) => void };
      dateTo: { setValue: (value: string) => void };
      thirdPartyId: { setValue: (value: string) => void };
      thirdPartyType: { setValue: (value: 'CUSTOMER' | 'SUPPLIER') => void };
    };
  };
  filteredCandidates: () => UnletteredLineDto[];
  selectedCreditTotal: () => number;
  selectedDebitTotal: () => number;
  selectedDifference: () => number;
  suggestions: () => Array<{
    amount: number;
    debitLine: UnletteredLineDto;
    creditLine: UnletteredLineDto;
  }>;
  toggleLine: (line: UnletteredLineDto, checked: boolean) => void;
  updateAllocation: (line: UnletteredLineDto, event: Event) => void;
}

describe('LetteringPage', () => {
  let fixture: ComponentFixture<LetteringPage>;
  let httpMock: HttpTestingController;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let notifications: {
    error: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
  };
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();
    dialogOpen = vi.fn(() => ({ afterClosed: () => of(true) }));
    notifications = {
      error: vi.fn(),
      success: vi.fn()
    };
    const fiscalYear = {
      accountingFramework: 'SYSCOHADA_REVISED' as const,
      endDate: '2026-12-31',
      fiscalYearId: 'FY#2026',
      startDate: '2026-01-01',
      status: 'OPEN' as const,
      year: 2026
    };
    const fiscalYearContext = {
      activeFiscalYear: signal(fiscalYear),
      activeYear: signal(2026),
      hasActiveFiscalYear: signal(true)
    };

    await TestBed.configureTestingModule({
      imports: [
        LetteringPage,
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
        { provide: MatDialog, useValue: { open: dialogOpen } },
        { provide: NotificationService, useValue: notifications },
        { provide: AccountingFiscalYearContextService, useValue: fiscalYearContext }
      ]
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LetteringPage);
    const componentInternals = fixture.componentInstance as unknown as {
      dialog: { open: typeof dialogOpen };
      notifications: typeof notifications;
    };
    componentInternals.dialog = { open: dialogOpen };
    componentInternals.notifications = notifications;
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('renders the filters and initial empty scope without loading candidates', async () => {
    await settle(fixture);

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Lettering');
    expect(text).toContain('Scope');
    expect(text).toContain('Unlettered lines');
    expect(text).toContain('Lettering summary');
    expect(text).toContain('Third-party account');
    expect(text).toContain('Third-party type');
    expect(text).toContain('Third party');
    expect(text).toContain('Customers');
    expect(text).toContain('Advanced filters');
    expect(text).toContain('Select an auxiliary account and a third party to load lines.');
    expect(text).not.toContain('Project');
    expect(text).not.toContain('From');
    httpMock.expectNone((request) => request.url === `${apiBaseUrl}/lettering/candidates`);
  });

  it('keeps the perimeter in a horizontal filter bar with advanced filters collapsed by default', async () => {
    await settle(fixture);

    expect(fixture.nativeElement.innerHTML).toContain(
      'lg:grid-cols-[180px_minmax(240px,300px)_minmax(320px,1fr)_auto_auto]'
    );
    expect(fixture.nativeElement.innerHTML).toContain('xl:grid-cols-[minmax(0,1fr)_300px]');
    expect(fixture.nativeElement.innerHTML).not.toContain(
      'xl:grid-cols-[320px_minmax(0,1fr)_300px]'
    );
    expect(fixture.nativeElement.querySelector('mat-select')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('From');

    const advancedButton = (
      Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]
    ).find((button) => button.textContent?.includes('Advanced filters'));

    advancedButton?.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('From');
    expect(fixture.nativeElement.textContent).toContain('To');
    expect(fixture.nativeElement.textContent).toContain('Reference or label');
  });

  it('hides account and third-party context badges until values are selected', async () => {
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('Active dossier');
    expect(fixture.nativeElement.textContent).toContain('Fiscal year 2026');
    expect(fixture.nativeElement.textContent).toContain('Customer');
    expect(fixture.nativeElement.textContent).not.toContain('41100000 — Clients');
    expect(fixture.nativeElement.textContent).not.toContain('C001 — Client Demo');

    const component = testable(fixture);
    component.form.controls.accountId.setValue('41100000');
    component.form.controls.thirdPartyId.setValue('TP-001');
    component.handleAccountSelected(accountDtoFixture('41100000', 'Clients'));
    component.handleThirdPartySelected(thirdPartyDtoFixture('TP-001', 'C001', 'Client Demo', 'CUSTOMER'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('41100000 — Clients');
    expect(fixture.nativeElement.textContent).toContain('C001 — Client Demo');
  });

  it('keeps loading disabled until fiscal year, type, account, and third party are valid', async () => {
    await settle(fixture);

    const component = testable(fixture);

    expect(component.canLoadScope()).toBe(false);
    expect(loadButton(fixture).disabled).toBe(true);

    component.form.controls.accountId.setValue('41100000');
    component.form.controls.thirdPartyId.setValue('TP-001');
    fixture.detectChanges();

    expect(component.canLoadScope()).toBe(false);

    component.handleAccountSelected(accountDtoFixture('41100000', 'Clients'));
    component.handleThirdPartySelected(thirdPartyDtoFixture('TP-001', 'C001', 'Client Demo', 'CUSTOMER'));
    fixture.detectChanges();

    expect(component.canLoadScope()).toBe(true);
    expect(loadButton(fixture).disabled).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Test scenarios');
  });

  it('loads GSI3-backed candidates for the selected account, third party, type, and year', async () => {
    setScope(fixture);
    await flushCandidates(httpMock, apiBaseUrl, [
      candidateLine({ PK: 'ORG#demo', GSI3PK: 'UNLETTERED#org#411#TP-001', entityType: 'ENTRY_LINE' })
    ]);
    await settle(fixture);

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Unlettered lines');
    expect(text).toContain('Customer invoice');
    expect(text).toContain('41100000 — Clients');
    expect(text).toContain('C001 — Client Demo');
    expect(text).toContain('Remaining');
    expect(text).not.toContain('ORG#demo');
    expect(text).not.toContain('GSI3PK');
    expect(text).not.toContain('ENTRY_LINE');
  });

  it('renders a dense accounting table without a dominant entry-number column', async () => {
    setScope(fixture);
    await flushCandidates(httpMock, apiBaseUrl, [
      candidateLine({
        entryNumber: 'VE-2026-VERY-LONG-ENTRY-NUMBER-0000001',
        label: 'Very long customer invoice label that should remain scannable in the table'
      })
    ]);
    await settle(fixture);

    const headers = (
      Array.from(fixture.nativeElement.querySelectorAll('thead th')) as HTMLElement[]
    ).map((header) => header.textContent?.trim());

    expect(headers).toEqual([
      'Select',
      'Date',
      'Journal',
      'Reference',
      'Label',
      'Debit',
      'Credit',
      'Remaining',
      'Allocation'
    ]);
    expect(headers).not.toContain('Entry');
    expect(fixture.nativeElement.textContent).toContain('VE-2026-VERY-LONG-ENTRY-NUMBER-0000001');
    expect(normalizedText(fixture)).toContain('100 000');
    expect(testable(fixture).allocationAmount(testable(fixture).candidates()[0])).toBe(100_000);
  });

  it('computes selected debit and credit totals and enables lettering only when balanced', async () => {
    setScope(fixture);
    await flushCandidates(httpMock, apiBaseUrl, [
      candidateLine({ debit: 100_000, credit: 0, lineId: 'L-DEBIT', label: 'Customer invoice' }),
      candidateLine({
        accountingDate: '2026-01-12',
        debit: 0,
        credit: 80_000,
        entryId: 'E-CREDIT',
        lineId: 'L-CREDIT',
        label: 'Partial payment',
        originalAmount: 80_000,
        remainingAmount: 80_000
      })
    ]);
    await settle(fixture);

    const component = testable(fixture);
    const [debitLine, creditLine] = component.candidates();

    component.toggleLine(debitLine, true);
    fixture.detectChanges();

    expect(component.selectedDebitTotal()).toBe(100_000);
    expect(component.selectedCreditTotal()).toBe(0);
    expect(component.canCreateMatch()).toBe(false);
    expect(letterButton(fixture).disabled).toBe(true);

    component.toggleLine(creditLine, true);
    debitLine.remainingAmount = 80_000;
    component.toggleLine(debitLine, false);
    component.toggleLine(debitLine, true);
    fixture.detectChanges();

    expect(component.selectedDebitTotal()).toBe(80_000);
    expect(component.selectedCreditTotal()).toBe(80_000);
    expect(component.selectedDifference()).toBe(0);
    expect(component.canCreateMatch()).toBe(true);
    expect(letterButton(fixture).disabled).toBe(false);
  });

  it('uses exact amount suggestions to select balanced debit and credit rows', async () => {
    setScope(fixture);
    await flushCandidates(httpMock, apiBaseUrl, balancedCandidateLines());
    await settle(fixture);

    const component = testable(fixture);
    const suggestion = component.suggestions()[0];

    const suggestionButton = (
      Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]
    ).find((button) => normalizeSpaces(button.textContent ?? '').includes('100 000 balanced'));

    expect(suggestionButton).toBeTruthy();
    suggestionButton?.click();
    fixture.detectChanges();

    expect(component.selectedDebitTotal()).toBe(100_000);
    expect(component.selectedCreditTotal()).toBe(100_000);
    expect(component.selectedDifference()).toBe(0);
    expect(component.canCreateMatch()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Selection');
    expect(fixture.nativeElement.textContent).toContain('FAC-001');
    expect(normalizedText(fixture)).toContain('Debit 100 000');
    expect(normalizedText(fixture)).toContain('Credit 100 000');
    expect(suggestion.amount).toBe(100_000);
  });

  it('hides the suggestions bar when loaded candidates cannot suggest a match', async () => {
    setScope(fixture);
    await flushCandidates(httpMock, apiBaseUrl, [
      candidateLine({ debit: 100_000, credit: 0, lineId: 'L-DEBIT' })
    ]);
    await settle(fixture);

    expect(testable(fixture).suggestions()).toHaveLength(0);
    expect(fixture.nativeElement.textContent).not.toContain('Matching suggestions');
  });

  it('uses partial suggestions to allocate the smaller credit amount', async () => {
    setScope(fixture);
    await flushCandidates(httpMock, apiBaseUrl, [
      candidateLine({ debit: 150_000, credit: 0, entryId: 'E-DEBIT', lineId: 'L-DEBIT', remainingAmount: 150_000, originalAmount: 150_000 }),
      candidateLine({
        accountingDate: '2026-01-12',
        debit: 0,
        credit: 50_000,
        entryId: 'E-CREDIT',
        lineId: 'L-CREDIT',
        label: 'Partial payment',
        originalAmount: 50_000,
        remainingAmount: 50_000
      })
    ]);
    await settle(fixture);

    const component = testable(fixture);
    const suggestion = component.suggestions()[0];

    component.applySuggestion(suggestion);
    fixture.detectChanges();

    expect(component.allocationAmount(suggestion.debitLine)).toBe(50_000);
    expect(component.allocationAmount(suggestion.creditLine)).toBe(50_000);
    expect(component.selectedDebitTotal()).toBe(50_000);
    expect(component.selectedCreditTotal()).toBe(50_000);
    expect(component.canCreateMatch()).toBe(true);
  });

  it('rejects an allocation greater than the remaining amount', async () => {
    setScope(fixture);
    await flushCandidates(httpMock, apiBaseUrl, balancedCandidateLines());
    await settle(fixture);

    const component = testable(fixture);
    const [debitLine, creditLine] = component.candidates();
    component.toggleLine(debitLine, true);
    component.toggleLine(creditLine, true);
    component.updateAllocation?.(debitLine, { target: { value: '120000' } } as unknown as Event);
    fixture.detectChanges();

    expect(component.selectedDebitTotal()).toBe(120_000);
    expect(component.canCreateMatch()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Maximum: 100');
  });

  it('updates the synthesis status and selected-line preview from the current selection', async () => {
    setScope(fixture);
    await flushCandidates(httpMock, apiBaseUrl, [
      candidateLine({ debit: 100_000, credit: 0, lineId: 'L-DEBIT', reference: 'FAC-CUST-001' }),
      candidateLine({
        accountingDate: '2026-01-12',
        credit: 60_000,
        debit: 0,
        entryId: 'E-CREDIT',
        lineId: 'L-CREDIT',
        originalAmount: 60_000,
        reference: 'PAY-CUST-001',
        remainingAmount: 60_000
      })
    ]);
    await settle(fixture);

    const component = testable(fixture);
    const [debitLine, creditLine] = component.candidates();
    component.toggleLine(debitLine, true);
    component.toggleLine(creditLine, true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Selected lines');
    expect(fixture.nativeElement.textContent).toContain('2');
    expect(fixture.nativeElement.textContent).toContain('Selected debit');
    expect(normalizedText(fixture)).toContain('100 000');
    expect(fixture.nativeElement.textContent).toContain('Selected credit');
    expect(normalizedText(fixture)).toContain('60 000');
    expect(normalizedText(fixture)).toContain('+40 000');
    expect(fixture.nativeElement.textContent).toContain('Difference to letter');
    expect(letterButton(fixture).disabled).toBe(true);

    component.updateAllocation(debitLine, { target: { value: '60000' } } as unknown as Event);
    fixture.detectChanges();

    expect(component.canCreateMatch()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Balanced');
    expect(fixture.nativeElement.textContent).toContain('FAC-CUST-001');
    expect(fixture.nativeElement.textContent).toContain('PAY-CUST-001');
    expect(letterButton(fixture).disabled).toBe(false);
  });

  it('confirms a balanced lettering match, prioritizes the backend message, and refreshes candidates', async () => {
    setScope(fixture);
    await flushCandidates(httpMock, apiBaseUrl, balancedCandidateLines());
    await settle(fixture);

    const component = testable(fixture);
    component.candidates().forEach((line) => component.toggleLine(line, true));
    fixture.detectChanges();

    const action = component.confirmCreateMatch();
    const postRequest = await expectOneEventually(httpMock, (request) => {
      return request.url === `${apiBaseUrl}/lettering/matches`;
    });

    expect(dialogOpen).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'CREATE',
          creditTotal: 100_000,
          debitTotal: 100_000,
          lineCount: 2
        })
      })
    );
    expect(postRequest.request.method).toBe('POST');
    expect(postRequest.request.body).toEqual({
      accountId: '41100000',
      allocations: [
        { amount: 100_000, entryId: 'E-DEBIT', lineId: 'L-DEBIT' },
        { amount: 100_000, entryId: 'E-CREDIT', lineId: 'L-CREDIT' }
      ],
      fiscalYear: 2026,
      thirdPartyId: 'TP-001',
      thirdPartyType: 'CUSTOMER'
    });
    postRequest.flush({
      data: letteringMatchFixture(),
      message: { message: 'Lettrage enregistré côté serveur.' }
    });
    await flushCandidates(httpMock, apiBaseUrl, []);
    await action;
    await settle(fixture);

    expect(notifications.success).toHaveBeenCalledWith('Lettrage enregistré côté serveur.');
    expect(fixture.nativeElement.textContent).toContain('No line to letter');
  });

  it('renders the no-candidates state after a valid load returns no lines', async () => {
    setScope(fixture);
    await flushCandidates(httpMock, apiBaseUrl, []);
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('No unlettered line for this third party.');
  });

  it('renders a clean error state without raw technical details', async () => {
    setScope(fixture);
    const request = await expectOneEventually(httpMock, (candidate) => {
      return candidate.url === `${apiBaseUrl}/lettering/candidates`;
    });
    request.flush(
      { message: 'ZodError GSI3PK ConditionalCheckFailedException DynamoDB stack trace' },
      { status: 500, statusText: 'Server Error' }
    );
    await settle(fixture);

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Lettering lines could not be loaded. Try again.');
    expect(text).toContain('Retry');
    expect(text).not.toContain('ZodError');
    expect(text).not.toContain('GSI3PK');
    expect(text).not.toContain('DynamoDB');
  });

  it('falls back to safe copy instead of displaying technical backend errors', async () => {
    setScope(fixture);
    await flushCandidates(httpMock, apiBaseUrl, balancedCandidateLines());
    await settle(fixture);

    const component = testable(fixture);
    component.candidates().forEach((line) => component.toggleLine(line, true));
    fixture.detectChanges();

    const action = component.confirmCreateMatch();
    const postRequest = await expectOneEventually(httpMock, (request) => {
      return request.url === `${apiBaseUrl}/lettering/matches`;
    });

    postRequest.flush(
      { message: 'GSI3PK ConditionalCheckFailedException DynamoDB stack trace' },
      { status: 409, statusText: 'Conflict' }
    );
    await action;
    await settle(fixture);

    expect(notifications.error).toHaveBeenCalledWith('Lettering could not be saved.');
    expect(JSON.stringify(notifications.error.mock.calls)).not.toContain('GSI3PK');
  });

  it('can cancel the latest active match and refresh the queue', async () => {
    setScope(fixture);
    await flushCandidates(httpMock, apiBaseUrl, balancedCandidateLines());
    await settle(fixture);

    const component = testable(fixture);
    component.candidates().forEach((line) => component.toggleLine(line, true));
    fixture.detectChanges();

    const createAction = component.confirmCreateMatch();
    const postRequest = await expectOneEventually(httpMock, (request) => {
      return request.url === `${apiBaseUrl}/lettering/matches`;
    });
    postRequest.flush({
      data: letteringMatchFixture(),
      message: 'Lettering saved.'
    });
    await flushCandidates(httpMock, apiBaseUrl, []);
    await createAction;
    await settle(fixture);

    const cancelAction = component.confirmCancelLatestMatch();
    const cancelRequest = await expectOneEventually(httpMock, (request) => {
      return request.url === `${apiBaseUrl}/lettering/matches/LM-001/cancel`;
    });

    expect(cancelRequest.request.method).toBe('POST');
    expect(cancelRequest.request.body).toEqual({ fiscalYear: 2026 });
    cancelRequest.flush({
      data: letteringMatchFixture({ status: 'CANCELLED' }),
      message: 'Lettering cancelled by backend.'
    });
    await flushCandidates(httpMock, apiBaseUrl, balancedCandidateLines());
    await cancelAction;
    await settle(fixture);

    expect(notifications.success).toHaveBeenLastCalledWith('Lettering cancelled by backend.');
    expect(fixture.nativeElement.textContent).toContain('Customer invoice');
  });

  it('keeps the candidate table readable with dark-mode classes available', async () => {
    setScope(fixture);
    await flushCandidates(httpMock, apiBaseUrl, balancedCandidateLines());
    await settle(fixture);

    expect(fixture.nativeElement.innerHTML).toContain('dark:');
    expect(fixture.nativeElement.textContent).toContain('Selected debit');
    expect(fixture.nativeElement.textContent).toContain('Selected credit');
    expect(fixture.nativeElement.innerHTML).toContain('xl:grid-cols-[minmax(0,1fr)_300px]');
    expect(fixture.nativeElement.innerHTML).toContain('xl:sticky');
  });
});

async function settle(fixture: ComponentFixture<LetteringPage>): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }
}

function testable(fixture: ComponentFixture<LetteringPage>): TestableLetteringPage {
  return fixture.componentInstance as unknown as TestableLetteringPage;
}

function setScope(
  fixture: ComponentFixture<LetteringPage>,
  options: {
    accountId?: string;
    dateFrom?: string;
    dateTo?: string;
    thirdPartyId?: string;
    thirdPartyType?: 'CUSTOMER' | 'SUPPLIER';
  } = {}
): void {
  const component = testable(fixture);

  component.form.controls.accountId.setValue(options.accountId ?? '41100000');
  component.form.controls.thirdPartyId.setValue(options.thirdPartyId ?? 'TP-001');
  component.form.controls.thirdPartyType.setValue(options.thirdPartyType ?? 'CUSTOMER');
  component.handleAccountSelected(
    accountDtoFixture(
      options.accountId ?? '41100000',
      options.thirdPartyType === 'SUPPLIER' ? 'Fournisseurs' : 'Clients'
    )
  );
  component.handleThirdPartySelected(
    thirdPartyDtoFixture(
      options.thirdPartyId ?? 'TP-001',
      options.thirdPartyType === 'SUPPLIER' ? 'F001' : 'C001',
      options.thirdPartyType === 'SUPPLIER' ? 'Fournisseur Demo' : 'Client Demo',
      options.thirdPartyType ?? 'CUSTOMER'
    )
  );
  component.form.controls.dateFrom.setValue(options.dateFrom ?? '');
  component.form.controls.dateTo.setValue(options.dateTo ?? '');
  component.applyFilters();
  fixture.detectChanges();
}

async function flushCandidates(
  httpMock: HttpTestingController,
  apiBaseUrl: string,
  lines: UnletteredLineDto[],
  params: {
    accountId?: string;
    thirdPartyId?: string;
    thirdPartyType?: 'CUSTOMER' | 'SUPPLIER';
  } = {}
): Promise<void> {
  const accountId = params.accountId ?? '41100000';
  const thirdPartyId = params.thirdPartyId ?? 'TP-001';
  const thirdPartyType = params.thirdPartyType ?? 'CUSTOMER';
  const request = await expectOneEventually(httpMock, (candidate) => {
    return (
      candidate.url === `${apiBaseUrl}/lettering/candidates` &&
      candidate.params.get('fiscalYear') === '2026' &&
      candidate.params.get('accountId') === accountId &&
      candidate.params.get('thirdPartyId') === thirdPartyId &&
      candidate.params.get('thirdPartyType') === thirdPartyType &&
      candidate.params.get('limit') === '100'
    );
  });

  expect(request.request.method).toBe('GET');
  request.flush({
    data: {
      accountCode: '41100000',
      accountId,
      hasMore: false,
      lines,
      thirdPartyId,
      thirdPartyName: thirdPartyType === 'CUSTOMER' ? 'Client Demo' : 'Fournisseur Beta',
      thirdPartyType
    },
    message: 'Candidates loaded'
  });
}

async function expectOneEventually(
  httpMock: HttpTestingController,
  predicate: Parameters<HttpTestingController['expectOne']>[0]
) {
  let lastError: unknown;

  for (let index = 0; index < 30; index += 1) {
    try {
      return httpMock.expectOne(predicate);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve));
    }
  }

  throw lastError;
}

function letterButton(fixture: ComponentFixture<LetteringPage>): HTMLButtonElement {
  const buttons = Array.from(
    fixture.nativeElement.querySelectorAll('button')
  ) as HTMLButtonElement[];
  const button = buttons.find((candidate) => candidate.textContent?.includes('Letter'));

  if (!button) {
    throw new Error('Letter action button not found');
  }

  return button;
}

function loadButton(fixture: ComponentFixture<LetteringPage>): HTMLButtonElement {
  const buttons = Array.from(
    fixture.nativeElement.querySelectorAll('button')
  ) as HTMLButtonElement[];
  const button = buttons.find((candidate) => candidate.textContent?.includes('Load'));

  if (!button) {
    throw new Error('Load action button not found');
  }

  return button;
}

function normalizedText(fixture: ComponentFixture<LetteringPage>): string {
  return normalizeSpaces(fixture.nativeElement.textContent ?? '');
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, ' ');
}

function balancedCandidateLines(): UnletteredLineDto[] {
  return [
    candidateLine({ debit: 100_000, credit: 0, entryId: 'E-DEBIT', lineId: 'L-DEBIT' }),
    candidateLine({
      accountingDate: '2026-01-12',
      debit: 0,
      credit: 100_000,
      entryId: 'E-CREDIT',
      lineId: 'L-CREDIT',
      label: 'Customer payment'
    })
  ];
}

function candidateLine(
  overrides: Partial<UnletteredLineDto> & Record<string, unknown> = {}
): UnletteredLineDto {
  return {
    accountCode: '41100000',
    accountId: '41100000',
    accountLabel: 'Clients',
    accountingDate: '2026-01-05',
    credit: 0,
    debit: 100_000,
    entryId: 'E-DEBIT',
    entryNumber: 'VE-0001',
    fiscalYear: 2026,
    journalCode: 'VE',
    label: 'Customer invoice',
    letteredAmount: 0,
    letteringStatus: 'UNLETTERED',
    lineId: 'L-DEBIT',
    originalAmount: 100_000,
    reference: 'FAC-001',
    remainingAmount: 100_000,
    stableLineIndex: 1,
    thirdPartyCode: 'C001',
    thirdPartyId: 'TP-001',
    thirdPartyName: 'Client Demo',
    thirdPartyType: 'CUSTOMER',
    ...overrides
  };
}

function accountDtoFixture(accountId: string, accountName: string): AccountDto {
  const auxiliaryType = accountId.startsWith('401') ? 'SUPPLIER' : 'CUSTOMER';

  return {
    accountId,
    accountName,
    accountNature: 'BALANCE',
    accountUsage: 'BOTH',
    allowReconciliation: true,
    auxiliaryType,
    classCode: 4,
    financialStatementCode: 'BS',
    isActive: true,
    isThirdPartyAccount: true,
    requiresThirdParty: true
  };
}

function thirdPartyDtoFixture(
  thirdPartyId: string,
  code: string,
  displayName: string,
  type: 'CUSTOMER' | 'SUPPLIER'
): ThirdPartyDto {
  return {
    code,
    createdAt: '2026-01-01T00:00:00.000Z',
    displayName,
    status: 'ACTIVE',
    thirdPartyId,
    type,
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

function letteringMatchFixture(overrides: Partial<LetteringMatchDto> = {}): LetteringMatchDto {
  return {
    ...letteringMatchFixtureShape(),
    ...overrides
  };
}

function letteringMatchFixtureShape(): LetteringMatchDto {
  return {
    accountCode: '41100000',
    accountId: '41100000',
    allocations: [
      {
        accountingDate: '2026-01-05',
        allocatedAmount: 100_000,
        credit: 0,
        debit: 100_000,
        entryId: 'E-DEBIT',
        entryNumber: 'VE-0001',
        journalCode: 'VE',
        label: 'Customer invoice',
        lineId: 'L-DEBIT',
        reference: 'FAC-001'
      },
      {
        accountingDate: '2026-01-12',
        allocatedAmount: 100_000,
        credit: 100_000,
        debit: 0,
        entryId: 'E-CREDIT',
        entryNumber: 'BQ-0001',
        journalCode: 'BQ',
        label: 'Customer payment',
        lineId: 'L-CREDIT'
      }
    ],
    createdAt: '2026-02-01T10:00:00.000Z',
    createdBy: 'user-1',
    fiscalYear: 2026,
    letteringId: 'LM-001',
    status: 'ACTIVE' as const,
    thirdPartyId: 'TP-001',
    thirdPartyType: 'CUSTOMER' as const,
    totalCredit: 100_000,
    totalDebit: 100_000
  };
}
