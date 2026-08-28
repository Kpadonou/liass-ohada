import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { SalesCustomer, SalesCustomerListResponse } from '@liass-ohada/shared/sales';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, queryOptions, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ProductAccessState } from '../../../../core/product-access/product-access.state';
import { SalesCapabilities } from '../../data-access/sales-capabilities';
import { SalesCustomersApi } from '../../data-access/sales-customers.api';
import { SalesCustomersQueries } from '../../data-access/sales-customers.queries';
import { SalesCustomersPage } from './sales-customers.page';

describe('SalesCustomersPage', () => {
  let availability: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  let canRead: boolean;
  let canWrite: boolean;
  let list = vi.fn(async (_options: { cursor?: string; limit?: number }): Promise<SalesCustomerListResponse> => ({ items: [] }));
  const api = {
    activate: vi.fn(),
    deactivate: vi.fn()
  };
  const capabilities = {
    canRead: vi.fn(() => canRead),
    canWrite: vi.fn(() => canWrite)
  };
  const dialogService = {
    closeAll: vi.fn(),
    open: vi.fn(() => ({ afterClosed: () => of(null) }))
  };
  const queries = {
    rootKey: vi.fn(() => ['sales', 'org-sales', 'customers']),
    detailKey: vi.fn((id: string) => ['sales', 'org-sales', 'customers', id]),
    detail: vi.fn((id: string) => queryOptions({ queryKey: ['sales', 'org-sales', 'customers', id], queryFn: async () => customer({ id }) })),
    list: vi.fn((options: { cursor?: string; limit?: number }, enabled = true) =>
      queryOptions({
        queryKey: ['sales', 'org-sales', 'customers', { cursor: options.cursor ?? null, limit: options.limit ?? 50 }],
        queryFn: () => list(options),
        enabled
      })
    )
  };

  beforeEach(async () => {
    localStorage.clear();
    availability = 'AVAILABLE';
    canRead = true;
    canWrite = true;
    list = vi.fn(async (_options: { cursor?: string; limit?: number }): Promise<SalesCustomerListResponse> => ({ items: [] }));
    vi.clearAllMocks();
    capabilities.canRead.mockImplementation(() => canRead);
    capabilities.canWrite.mockImplementation(() => canWrite);
    dialogService.open.mockImplementation(() => ({ afterClosed: () => of(null) }));
    await TestBed.configureTestingModule({
      imports: [
        SalesCustomersPage,
        TranslocoTestingModule.forRoot({
          langs: { en: translations },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }
        })
      ],
      providers: [
        { provide: ProductAccessState, useValue: { availability: () => availability } },
        { provide: SalesCapabilities, useValue: capabilities },
        { provide: SalesCustomersApi, useValue: api },
        { provide: SalesCustomersQueries, useValue: queries },
        { provide: MatDialog, useValue: dialogService },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } }))
      ]
    }).compileComponents();
  });

  afterEach(() => {
    dialogService.closeAll();
    document.body.querySelectorAll('.cdk-overlay-container').forEach((element) => element.remove());
  });

  it.each(['UNKNOWN', 'UNAVAILABLE'] as const)(
    'does not call the customer API when SALES access is %s',
    async (state) => {
      availability = state;
      const fixture = TestBed.createComponent(SalesCustomersPage);
      fixture.detectChanges();
      await settle(fixture);

      expect(list).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).toContain(
        state === 'UNKNOWN' ? 'Checking access to Sales' : 'Customer directory unavailable'
      );
    }
  );

  it('shows explicit loading and then the empty state without a fake search control', async () => {
    let resolveList!: (value: SalesCustomerListResponse) => void;
    list.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    const fixture = TestBed.createComponent(SalesCustomersPage);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Loading customers');
    expect(fixture.nativeElement.querySelector('[role="status"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('input[type="search"]')).toBeNull();

    resolveList({ items: [] });
    await settle(fixture);
    expect(fixture.nativeElement.textContent).toContain('No customers yet');
    expect(fixture.nativeElement.textContent).toContain('New customer');
  });

  it('localizes type and status and hides every mutation action in read-only mode', async () => {
    canWrite = false;
    list.mockResolvedValue({ items: [customer()] });
    const fixture = TestBed.createComponent(SalesCustomersPage);
    fixture.detectChanges();
    await settle(fixture);

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Alpha SARL');
    expect(text).toContain('Business / organization');
    expect(text).toContain('Active');
    expect(text).not.toContain('New customer');
    expect(fixture.nativeElement.querySelector('button[aria-label="Open row actions"]')).toBeNull();
  });

  it('offers create to writers and never exposes Delete or deferred SALES features', async () => {
    list.mockResolvedValue({ items: [customer()] });
    const fixture = TestBed.createComponent(SalesCustomersPage);
    fixture.detectChanges();
    await settle(fixture);

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('New customer');
    expect(text).not.toContain('Delete');
    expect(text).not.toContain('Catalog');
    expect(text).not.toContain('Invoices');
  });

  it('uses nextCursor as opaque navigation state and returns to the previous page', async () => {
    list.mockImplementation(async (options: { cursor?: string }) =>
      options.cursor
        ? { items: [customer({ id: 'SC-2', name: 'Beta SA' })] }
        : { items: [customer()], nextCursor: 'opaque+/=next' }
    );
    const fixture = TestBed.createComponent(SalesCustomersPage);
    fixture.detectChanges();
    await settle(fixture);

    fixture.componentInstance['nextPage']();
    await settle(fixture);
    expect(list).toHaveBeenLastCalledWith({ limit: 50, cursor: 'opaque+/=next' });
    expect(fixture.nativeElement.textContent).toContain('Beta SA');

    fixture.componentInstance['previousPage']();
    await settle(fixture);
    expect(list).toHaveBeenLastCalledWith({ limit: 50, cursor: undefined });
    expect(fixture.nativeElement.textContent).toContain('Alpha SARL');
  });

  it('sends current expectedVersion for lifecycle changes and refreshes authoritative state', async () => {
    const current = customer({ version: 7, isActive: true });
    const updated = customer({ version: 8, isActive: false });
    api.deactivate.mockResolvedValue({ data: updated, message: null });
    list.mockResolvedValue({ items: [current] });
    const fixture = TestBed.createComponent(SalesCustomersPage);
    fixture.detectChanges();
    await settle(fixture);
    const queryClient = TestBed.inject(QueryClient);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await fixture.componentInstance['changeStatus'](current);

    expect(api.deactivate).toHaveBeenCalledWith('SC-1', 7);
    expect(api.activate).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sales', 'org-sales', 'customers'] });
  });
});

async function settle(fixture: { detectChanges(): void }): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

function customer(overrides: Partial<SalesCustomer> = {}): SalesCustomer {
  return {
    id: 'SC-1', customerType: 'BUSINESS', name: 'Alpha SARL', email: 'contact@alpha.example',
    phone: '+2290100000000', taxIdentifier: 'IFU-123', billingAddress: { city: 'Cotonou', country: 'BJ' },
    isActive: true, version: 7, createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides
  };
}

const translations = {
  COMMON: {
    ACTIONS: { CANCEL: 'Cancel', CREATE: 'Create', RETRY: 'Try again', SAVE: 'Save' },
    EMPTY_VALUE: '—',
    PAGINATION: { NEXT: 'Next', PREVIOUS: 'Previous' },
    TABLE: { ACTION_MENU: 'Open row actions' }
  },
  SALES: {
    CUSTOMERS: {
      ACCESS: { CHECKING: 'Checking access to Sales…', UNAVAILABLE_DESCRIPTION: 'Sales is unavailable.', UNAVAILABLE_TITLE: 'Customer directory unavailable' },
      ACTIONS: { ACTIVATE: 'Reactivate', COLUMNS: 'Columns', CREATE: 'New customer', DEACTIVATE: 'Deactivate', EDIT: 'Edit' },
      EMPTY: { DESCRIPTION: 'Create your first customer.', TITLE: 'No customers yet' },
      ERRORS: { DETAIL_FAILED: 'Detail failed.', LOAD_FAILED: 'Customers could not be loaded.', STATUS_FAILED: 'Status failed.', CONFLICT: 'Customer changed.' },
      LIFECYCLE: { ACTIVATE_DESCRIPTION: 'Activate {{name}}.', ACTIVATE_TITLE: 'Reactivate?', DEACTIVATE_DESCRIPTION: 'Deactivate {{name}}.', DEACTIVATE_TITLE: 'Deactivate?' },
      LIST: { DESCRIPTION: 'Customer contact details.', TITLE: 'Customer directory' },
      LOADING: 'Loading customers…',
      NOTIFICATIONS: { ACTIVATED: 'Customer reactivated.', DEACTIVATED: 'Customer deactivated.' },
      PAGE: { EYEBROW: 'Sales', SUBTITLE: 'Manage customers.', TITLE: 'Customers' },
      PAGINATION: { LABEL: 'Customer pagination', PAGE_SIZE: 'Up to {{count}} customers per page' },
      STATUS: { ACTIVE: 'Active', INACTIVE: 'Inactive' },
      TABLE: { ACTIONS: 'Actions', EMAIL: 'Email', NAME: 'Customer', PHONE: 'Phone', STATUS: 'Status', TAX_IDENTIFIER: 'Tax identifier', TYPE: 'Type' },
      TYPES: { BUSINESS: 'Business / organization', INDIVIDUAL: 'Individual' }
    }
  }
};
