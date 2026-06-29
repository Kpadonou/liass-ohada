import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { environment } from '../../../../../environments/environment';
import { ThirdPartiesPage } from './third-parties.page';

const translations = {
  en: {
    ACCOUNTING: {
      THIRD_PARTIES: {
        ACTIONS: {
          ACTIVATE: 'Activate',
          CLEAR_FILTERS: 'Reset',
          DEACTIVATE: 'Deactivate',
          EDIT: 'Edit',
          LOAD_MORE: 'Load more third parties',
          NEW_CUSTOMER: 'New customer',
          NEW_SUPPLIER: 'New supplier',
          RETRY: 'Retry'
        },
        DIALOG: {
          CREATE_CUSTOMER_TITLE: 'New customer',
          CREATE_SUPPLIER_TITLE: 'New supplier',
          EDIT_TITLE: 'Edit third party',
          EYEBROW: 'Auxiliary accounting',
          SUBTITLE: 'Enter third-party information.'
        },
        EMPTY: {
          DESCRIPTION: 'No third party is available yet for the current selection.',
          NO_RESULTS_DESCRIPTION: 'Adjust filters.',
          NO_RESULTS_TITLE: 'No third party matches.',
          TITLE: 'No third party loaded'
        },
        ERRORS: {
          ACTIVATE_FAILED: 'The third party could not be activated.',
          CREATE_FAILED: 'The third party could not be created.',
          DEACTIVATE_FAILED: 'The third party could not be deactivated.',
          LOAD_FAILED: 'Third parties could not be loaded. Check the active dossier or retry.',
          LOAD_MORE_FAILED: 'Additional results could not be loaded.',
          UPDATE_FAILED: 'The third party could not be updated.'
        },
        EYEBROW: 'Auxiliary reference',
        FIELDS: {
          ADDRESS: 'Address',
          CODE: 'Code',
          COUNTRY: 'Country',
          DISPLAY_NAME: 'Name',
          EMAIL: 'Email',
          PHONE: 'Phone',
          TAX_IDENTIFIER: 'Tax identifier',
          TYPE: 'Type'
        },
        FILTERS: {
          ACTIVE: 'Active',
          ALL: 'All',
          INACTIVE: 'Inactive',
          LOCAL_SEARCH_HINT: 'Search applies to loaded third parties.',
          SEARCH: 'Search',
          SEARCH_PLACEHOLDER: 'Search by third-party name or code',
          STATUS: 'Status',
          TYPE: 'Third-party type'
        },
        LOADING: 'Loading third parties...',
        NOTIFICATIONS: {
          ACTIVATED: 'Third party activated.',
          CREATED: 'Third party created.',
          DEACTIVATED: 'Third party deactivated.',
          NO_CHANGES: 'No changes to save.',
          UPDATED: 'Third party updated.'
        },
        STATUS: {
          ACTIVE: 'Active',
          INACTIVE: 'Inactive'
        },
        STATUS_DIALOG: {
          ACTIVATE_DESCRIPTION: 'This third party can be selected again.',
          ACTIVATE_TITLE: 'Activate this third party?',
          DEACTIVATE_DESCRIPTION: 'Existing accounting entries remain unchanged.',
          DEACTIVATE_TITLE: 'Deactivate this third party?',
          EYEBROW: 'Third-party status'
        },
        SUBTITLE: 'Manage customers and suppliers used in auxiliary accounting.',
        TABLE: {
          ACTIONS: 'Actions',
          CODE: 'Code',
          COUNTRY: 'Country',
          DESCRIPTION: 'Customers and suppliers.',
          EMAIL: 'Email',
          NAME: 'Name',
          PHONE: 'Phone',
          STATUS: 'Status',
          TITLE: 'Third-party list',
          TYPE: 'Type'
        },
        TITLE: 'Third parties',
        TYPES: {
          CUSTOMER: 'Customer',
          SUPPLIER: 'Supplier'
        },
        VALIDATION: {
          CODE: 'Enter a third-party code.',
          DISPLAY_NAME: 'Enter a name.',
          EMAIL: 'Enter a valid email address.'
        }
      }
    },
    COMMON: {
      ACTIONS: {
        CANCEL: 'Cancel',
        SAVE: 'Save'
      },
      TABLE: {
        ACTION_MENU: 'Open row actions'
      }
    }
  }
};

describe('ThirdPartiesPage', () => {
  let fixture: ComponentFixture<ThirdPartiesPage>;
  let httpMock: HttpTestingController;
  let snackBarOpen: ReturnType<typeof vi.fn>;
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();
    snackBarOpen = vi.fn();

    await TestBed.configureTestingModule({
      imports: [
        ThirdPartiesPage,
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
        { provide: MatSnackBar, useValue: { open: snackBarOpen } },
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
    fixture = TestBed.createComponent(ThirdPartiesPage);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    document.body.querySelectorAll('.cdk-overlay-container').forEach((element) => element.remove());
    localStorage.clear();
    httpMock.verify();
  });

  it('calls the list API with active customers by default and renders clean optional fields', async () => {
    const request = expectThirdPartyListRequest('CUSTOMER', 'ACTIVE');

    request.flush({
      data: {
        items: [
          {
            ...thirdPartyFixture(),
            email: null,
            phone: '',
            country: null,
            taxIdentifier: '',
            PK: 'ORG#technical',
            SK: 'TP#CUSTOMER#tp-cust-alpha',
            GSI1PK: 'ORG#technical',
            entityType: 'THIRD_PARTY'
          }
        ],
        hasMore: false,
        nextCursor: null
      }
    });
    await settle(fixture);

    const text = pageText();

    expect(text).toContain('CUST-ALPHA');
    expect(text).toContain('Client Alpha');
    expect(text).toContain('Customer');
    expect(text).toContain('Active');
    expect(text).not.toContain('tp-cust-alpha');
    expect(text).not.toContain('PK');
    expect(text).not.toContain('SK');
    expect(text).not.toContain('GSI');
    expect(text).not.toContain('entityType');
  });

  it('renders a clean error state and retries the initial list request', async () => {
    expectThirdPartyListRequest('CUSTOMER', 'ACTIVE').flush(
      {
        errors: [{ message: 'Expected string, received null', path: 'data.items.0.email' }],
        message: 'ZodError: PK SK GSI'
      },
      { status: 500, statusText: 'Server Error' }
    );
    await settle(fixture);

    expect(pageText()).toContain('Third parties could not be loaded. Check the active dossier or retry.');
    expect(pageText()).not.toContain('Zod');
    expect(pageText()).not.toContain('PK');
    expect(pageText()).not.toContain('GSI');

    const retryPromise = (fixture.componentInstance as unknown as { retryInitialLoad(): Promise<void> }).retryInitialLoad();
    fixture.detectChanges();
    expectThirdPartyListRequest('CUSTOMER', 'ACTIVE').flush({
      data: { items: [thirdPartyFixture()], hasMore: false }
    });
    await retryPromise;
    await settle(fixture);

    expect(pageText()).toContain('CUST-ALPHA');
  });

  it('uses Material selects for type and status with clear default labels', async () => {
    expectThirdPartyListRequest('CUSTOMER', 'ACTIVE').flush({
      data: { items: [], hasMore: false }
    });
    await settle(fixture);

    expect(elementText('[data-testid="third-party-type-trigger"]')).toContain('Customer');
    expect(elementText('[data-testid="third-party-status-trigger"]')).toContain('Active');
    expect(elementText('[data-testid="third-party-selected-type"]')).toContain('Customer');
    expect(elementText('[data-testid="third-party-selected-status"]')).toContain('Active');
    expect(pageText()).toContain('New customer');
    expect(fixture.nativeElement.querySelector('[data-testid="third-parties-table-preferences"]')).toBeNull();
  });

  it('reset restores customer type, active status, and empty search', async () => {
    expectThirdPartyListRequest('CUSTOMER', 'ACTIVE').flush({
      data: { items: [], hasMore: false }
    });
    await settle(fixture);

    (fixture.componentInstance as unknown as { updateType(type: 'SUPPLIER'): void }).updateType('SUPPLIER');
    fixture.detectChanges();
    expectThirdPartyListRequest('SUPPLIER', 'ACTIVE').flush({
      data: { items: [], hasMore: false }
    });
    await settle(fixture);

    (fixture.componentInstance as unknown as { updateStatusFilter(status: 'INACTIVE'): void }).updateStatusFilter('INACTIVE');
    fixture.detectChanges();
    expectThirdPartyListRequest('SUPPLIER', 'INACTIVE').flush({
      data: { items: [], hasMore: false }
    });
    await settle(fixture);

    setSearchValue('beta');
    await settle(fixture);

    (fixture.componentInstance as unknown as { clearFilters(): void }).clearFilters();
    fixture.detectChanges();
    await settle(fixture);

    expect(elementText('[data-testid="third-party-type-trigger"]')).toContain('Customer');
    expect(elementText('[data-testid="third-party-status-trigger"]')).toContain('Active');
    expect((fixture.nativeElement.querySelector('[data-testid="third-party-search"]') as HTMLInputElement).value).toBe('');
  });

  it('selecting suppliers refetches with type=SUPPLIER and updates the create action label', async () => {
    expectThirdPartyListRequest('CUSTOMER', 'ACTIVE').flush({
      data: { items: [], hasMore: false }
    });
    await settle(fixture);

    (fixture.componentInstance as unknown as { updateType(type: 'SUPPLIER'): void }).updateType('SUPPLIER');
    fixture.detectChanges();

    expectThirdPartyListRequest('SUPPLIER', 'ACTIVE').flush({
      data: {
        items: [
          thirdPartyFixture({
            code: 'SUP-BETA',
            displayName: 'Fournisseur Beta',
            thirdPartyId: 'tp-sup-beta',
            type: 'SUPPLIER'
          })
        ],
        hasMore: false
      }
    });
    await settle(fixture);

    expect(elementText('[data-testid="third-party-selected-type"]')).toContain('Supplier');
    expect(elementText('[data-testid="third-party-type-trigger"]')).toContain('Supplier');
    expect(pageText()).toContain('New supplier');
    expect(pageText()).toContain('SUP-BETA');
  });

  it('sends inactive status and omits the status query param for all statuses', async () => {
    expectThirdPartyListRequest('CUSTOMER', 'ACTIVE').flush({
      data: { items: [], hasMore: false }
    });
    await settle(fixture);

    (fixture.componentInstance as unknown as { updateStatusFilter(status: 'INACTIVE'): void }).updateStatusFilter('INACTIVE');
    fixture.detectChanges();
    expectThirdPartyListRequest('CUSTOMER', 'INACTIVE').flush({
      data: { items: [], hasMore: false }
    });
    await settle(fixture);
    expect(elementText('[data-testid="third-party-selected-status"]')).toContain('Inactive');
    expect(elementText('[data-testid="third-party-status-trigger"]')).toContain('Inactive');

    (fixture.componentInstance as unknown as { updateStatusFilter(status: 'ALL'): void }).updateStatusFilter('ALL');
    fixture.detectChanges();
    expectThirdPartyListRequest('CUSTOMER', null).flush({
      data: {
        items: [
          thirdPartyFixture(),
          thirdPartyFixture({
            code: 'CUST-INACTIVE',
            thirdPartyId: 'tp-inactive',
            status: 'INACTIVE'
          })
        ],
        hasMore: false
      }
    });
    await settle(fixture);

    expect(elementText('[data-testid="third-party-selected-status"]')).toContain('All');
    expect(elementText('[data-testid="third-party-status-trigger"]')).toContain('All');
    expect(pageText()).toContain('CUST-ALPHA');
    expect(pageText()).toContain('CUST-INACTIVE');
  });

  it('filters loaded rows locally by display name and code without backend search calls', async () => {
    expectThirdPartyListRequest('CUSTOMER', 'ACTIVE').flush({
      data: {
        items: [
          thirdPartyFixture(),
          thirdPartyFixture({
            code: 'CUST-GAMMA',
            displayName: 'Client Gamma',
            thirdPartyId: 'tp-gamma'
          })
        ],
        hasMore: true,
        nextCursor: 'cursor-2'
      }
    });
    await settle(fixture);

    setSearchValue('alpha');
    await settle(fixture);

    expect(pageText()).toContain('CUST-ALPHA');
    expect(pageText()).not.toContain('CUST-GAMMA');
    expect(pageText()).toContain('Search applies to loaded third parties.');
    expectNoThirdPartySearchRequest();

    setSearchValue('cUsT');
    await settle(fixture);

    expect(pageText()).toContain('CUST-ALPHA');
    expect(pageText()).toContain('CUST-GAMMA');
    expectNoThirdPartySearchRequest();
  });

  it('searches supplier rows locally by display name and supplier code', async () => {
    expectThirdPartyListRequest('CUSTOMER', 'ACTIVE').flush({
      data: { items: [], hasMore: false }
    });
    await settle(fixture);

    (fixture.componentInstance as unknown as { updateType(type: 'SUPPLIER'): void }).updateType('SUPPLIER');
    fixture.detectChanges();
    expectThirdPartyListRequest('SUPPLIER', 'ACTIVE').flush({
      data: {
        items: [
          thirdPartyFixture({
            code: 'SUP-BETA',
            displayName: 'Fournisseur Beta',
            thirdPartyId: 'tp-sup-beta',
            type: 'SUPPLIER'
          }),
          thirdPartyFixture({
            code: 'SUP-DELTA',
            displayName: 'Fournisseur Delta',
            thirdPartyId: 'tp-sup-delta',
            type: 'SUPPLIER'
          })
        ],
        hasMore: false
      }
    });
    await settle(fixture);

    setSearchValue('beta');
    await settle(fixture);

    expect(pageText()).toContain('SUP-BETA');
    expect(pageText()).not.toContain('SUP-DELTA');

    setSearchValue('sup');
    await settle(fixture);

    expect(pageText()).toContain('SUP-BETA');
    expect(pageText()).toContain('SUP-DELTA');
    expectNoThirdPartySearchRequest();
  });

  it('creates customers and suppliers with the selected type', async () => {
    expectThirdPartyListRequest('CUSTOMER', 'ACTIVE').flush({
      data: { items: [], hasMore: false }
    });
    await settle(fixture);

    (fixture.componentInstance as unknown as { openCreateThirdParty(): void }).openCreateThirdParty();
    fixture.detectChanges();

    let dialog = TestBed.inject(MatDialog).openDialogs.at(-1)?.componentInstance as any;
    dialog.form.controls.code.setValue(' cust-new ');
    dialog.form.controls.displayName.setValue('Client New');
    const createCustomerSubmit = dialog.submit();

    const createCustomer = httpMock.expectOne(`${apiBaseUrl}/third-parties`);
    expect(createCustomer.request.method).toBe('POST');
    expect(createCustomer.request.body).toMatchObject({
      code: 'CUST-NEW',
      displayName: 'Client New',
      type: 'CUSTOMER'
    });
    createCustomer.flush({
      thirdParty: thirdPartyFixture({
        code: 'CUST-NEW',
        displayName: 'Client New',
        thirdPartyId: 'tp-new'
      })
    });
    await createCustomerSubmit;
    await settle(fixture);

    (fixture.componentInstance as unknown as { updateType(type: 'SUPPLIER'): void }).updateType('SUPPLIER');
    fixture.detectChanges();
    expectThirdPartyListRequest('SUPPLIER', 'ACTIVE').flush({
      data: { items: [], hasMore: false }
    });
    await settle(fixture);

    (fixture.componentInstance as unknown as { openCreateThirdParty(): void }).openCreateThirdParty();
    fixture.detectChanges();

    dialog = TestBed.inject(MatDialog).openDialogs.at(-1)?.componentInstance as any;
    dialog.form.controls.code.setValue('sup-new');
    dialog.form.controls.displayName.setValue('Supplier New');
    const createSupplierSubmit = dialog.submit();

    const createSupplier = httpMock.expectOne(`${apiBaseUrl}/third-parties`);
    expect(createSupplier.request.body).toMatchObject({
      code: 'SUP-NEW',
      displayName: 'Supplier New',
      type: 'SUPPLIER'
    });
    createSupplier.flush({
      thirdParty: thirdPartyFixture({
        code: 'SUP-NEW',
        displayName: 'Supplier New',
        thirdPartyId: 'tp-sup-new',
        type: 'SUPPLIER'
      })
    });
    await createSupplierSubmit;
  });

  it('keeps create validation inline and shows duplicate code errors cleanly', async () => {
    expectThirdPartyListRequest('CUSTOMER', 'ACTIVE').flush({
      data: { items: [], hasMore: false }
    });
    await settle(fixture);

    (fixture.componentInstance as unknown as { openCreateThirdParty(): void }).openCreateThirdParty();
    fixture.detectChanges();

    const dialog = TestBed.inject(MatDialog).openDialogs.at(-1)?.componentInstance as any;

    await dialog.submit();
    expect(httpMock.match(`${apiBaseUrl}/third-parties`)).toHaveLength(0);

    dialog.form.controls.code.setValue('CUST-ALPHA');
    dialog.form.controls.displayName.setValue('Client Alpha');
    const duplicateSubmit = dialog.submit();

    const createRequest = httpMock.expectOne(`${apiBaseUrl}/third-parties`);
    createRequest.flush({ message: { message: 'A third party with this code already exists.' } }, { status: 409, statusText: 'Conflict' });
    await duplicateSubmit;
    await settle(fixture);

    expect(dialog.errorMessage()).toBe('A third party with this code already exists.');
    expect(dialog.errorMessage()).not.toContain('Zod');
    expect(dialog.errorMessage()).not.toContain('PK');
  });

  it('edits only changed mutable fields through the patch endpoint', async () => {
    expectThirdPartyListRequest('CUSTOMER', 'ACTIVE').flush({
      data: { items: [thirdPartyFixture()], hasMore: false }
    });
    await settle(fixture);

    (
      fixture.componentInstance as unknown as {
        openEditThirdParty(thirdParty: ReturnType<typeof thirdPartyFixture>): void;
      }
    ).openEditThirdParty(thirdPartyFixture());
    fixture.detectChanges();

    const dialog = TestBed.inject(MatDialog).openDialogs.at(-1)?.componentInstance as any;

    expect(dialog.form.controls.code.disabled).toBe(true);
    expect(dialog.form.controls.type.disabled).toBe(true);
    dialog.form.controls.displayName.setValue('Client Alpha SARL');
    dialog.form.controls.email.setValue('client@example.com');
    const updateSubmit = dialog.submit();

    const updateRequest = httpMock.expectOne((request) => request.url === `${apiBaseUrl}/third-parties/tp-cust-alpha`);
    expect(updateRequest.request.method).toBe('PATCH');
    expect(updateRequest.request.params.get('type')).toBe('CUSTOMER');
    expect(updateRequest.request.body).toEqual({
      displayName: 'Client Alpha SARL',
      email: 'client@example.com'
    });
    for (const forbiddenField of ['code', 'type', 'thirdPartyId', 'status', 'PK', 'SK', 'GSI1PK', 'GSI1SK', 'entityType']) {
      expect(updateRequest.request.body).not.toHaveProperty(forbiddenField);
    }
    updateRequest.flush({ thirdParty: thirdPartyFixture({ displayName: 'Client Alpha SARL' }) });
    await updateSubmit;
  });

  it('does not call update when no editable third-party field changed', async () => {
    expectThirdPartyListRequest('CUSTOMER', 'ACTIVE').flush({
      data: { items: [thirdPartyFixture()], hasMore: false }
    });
    await settle(fixture);

    (
      fixture.componentInstance as unknown as {
        openEditThirdParty(thirdParty: ReturnType<typeof thirdPartyFixture>): void;
      }
    ).openEditThirdParty(thirdPartyFixture());
    fixture.detectChanges();

    const dialog = TestBed.inject(MatDialog).openDialogs.at(-1)?.componentInstance as any;

    await dialog.submit();
    await settle(fixture);

    httpMock.expectNone((request) => request.method === 'PATCH' && request.url.includes('/third-parties/'));
    expect(dialog.errorMessage()).toBeNull();
    expect(snackBarOpen).toHaveBeenCalledWith('No changes to save.', undefined, expect.objectContaining({ panelClass: 'info-notification-overlay' }));
  });

  it('requires confirmation for deactivate and activate status endpoints', async () => {
    expectThirdPartyListRequest('CUSTOMER', 'ACTIVE').flush({
      data: { items: [thirdPartyFixture()], hasMore: false }
    });
    await settle(fixture);

    (
      fixture.componentInstance as unknown as {
        openStatusDialog(thirdParty: ReturnType<typeof thirdPartyFixture>): void;
      }
    ).openStatusDialog(thirdPartyFixture());
    fixture.detectChanges();
    httpMock.expectNone((request) => request.url.includes('/deactivate'));

    let dialog = TestBed.inject(MatDialog).openDialogs.at(-1)?.componentInstance as any;
    const deactivateConfirm = dialog.confirm();

    const deactivate = httpMock.expectOne((request) => request.url === `${apiBaseUrl}/third-parties/tp-cust-alpha/deactivate`);
    expect(deactivate.request.params.get('type')).toBe('CUSTOMER');
    deactivate.flush({ thirdParty: thirdPartyFixture({ status: 'INACTIVE' }) });
    await deactivateConfirm;
    await settle(fixture);

    (
      fixture.componentInstance as unknown as {
        openStatusDialog(thirdParty: ReturnType<typeof thirdPartyFixture>): void;
      }
    ).openStatusDialog(thirdPartyFixture({ status: 'INACTIVE' }));
    fixture.detectChanges();
    dialog = TestBed.inject(MatDialog).openDialogs.at(-1)?.componentInstance as any;
    const activateConfirm = dialog.confirm();

    const activate = httpMock.expectOne((request) => request.url === `${apiBaseUrl}/third-parties/tp-cust-alpha/activate`);
    expect(activate.request.params.get('type')).toBe('CUSTOMER');
    activate.flush({ thirdParty: thirdPartyFixture({ status: 'ACTIVE' }) });
    await activateConfirm;
  });

  it('refetches the list when the status refresh hook runs', async () => {
    expectThirdPartyListRequest('CUSTOMER', 'ACTIVE').flush({
      data: { items: [thirdPartyFixture()], hasMore: false }
    });
    await settle(fixture);

    (fixture.componentInstance as unknown as { refreshThirdPartiesAfterStatusChange(): void }).refreshThirdPartiesAfterStatusChange();

    expectThirdPartyListRequest('CUSTOMER', 'ACTIVE').flush({
      data: { items: [], hasMore: false }
    });
  });

  function expectThirdPartyListRequest(type: string, status: string | null = 'ACTIVE') {
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/third-parties`);

    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('type')).toBe(type);
    expect(request.request.params.get('limit')).toBe('200');
    expect(request.request.params.get('status')).toBe(status);
    expect(request.request.params.has('search')).toBe(false);

    return request;
  }

  function expectNoThirdPartySearchRequest(): void {
    httpMock.expectNone((request) => request.url === `${apiBaseUrl}/third-parties` && (request.params.has('search') || request.params.has('name') || request.params.has('displayName')));
  }

  function setSearchValue(value: string): void {
    const input = fixture.nativeElement.querySelector('[data-testid="third-party-search"]') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function pageText(): string {
    return fixture.nativeElement.textContent;
  }

  function elementText(selector: string): string {
    return (fixture.nativeElement.querySelector(selector)?.textContent ?? '').trim();
  }
});

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

async function settle(fixture: ComponentFixture<ThirdPartiesPage>): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }
}
