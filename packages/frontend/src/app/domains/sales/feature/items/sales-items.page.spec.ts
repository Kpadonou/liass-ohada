import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { SalesCatalogItem, SalesCatalogItemListResponse } from '@liass-ohada/shared/sales';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, queryOptions, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ProductAccessState } from '../../../../core/product-access/product-access.state';
import { SalesCapabilities } from '../../data-access/sales-capabilities';
import { SalesItemsApi } from '../../data-access/sales-items.api';
import { SalesItemsQueries } from '../../data-access/sales-items.queries';
import { SalesItemsPage } from './sales-items.page';

describe('SalesItemsPage', () => {
  let availability: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  let canRead: boolean;
  let canWrite: boolean;
  let list = vi.fn(async (_options: { cursor?: string; limit?: number }): Promise<SalesCatalogItemListResponse> => ({ items: [] }));
  const api = { activate: vi.fn(), deactivate: vi.fn() };
  const capabilities = { canRead: vi.fn(() => canRead), canWrite: vi.fn(() => canWrite) };
  const dialogService = { closeAll: vi.fn(), open: vi.fn(() => ({ afterClosed: () => of(null) })) };
  const queries = {
    rootKey: vi.fn(() => ['sales', 'org-sales', 'items']),
    detailKey: vi.fn((id: string) => ['sales', 'org-sales', 'items', id]),
    detail: vi.fn((id: string) => queryOptions({ queryKey: ['sales', 'org-sales', 'items', id], queryFn: async () => item({ id }) })),
    list: vi.fn((options: { cursor?: string; limit?: number }, enabled = true) => queryOptions({
      queryKey: ['sales', 'org-sales', 'items', { cursor: options.cursor ?? null, limit: options.limit ?? 50 }],
      queryFn: () => list(options), enabled
    }))
  };

  beforeEach(async () => {
    localStorage.clear();
    availability = 'AVAILABLE';
    canRead = true;
    canWrite = true;
    list = vi.fn(async (): Promise<SalesCatalogItemListResponse> => ({ items: [] }));
    vi.clearAllMocks();
    capabilities.canRead.mockImplementation(() => canRead);
    capabilities.canWrite.mockImplementation(() => canWrite);
    dialogService.open.mockImplementation(() => ({ afterClosed: () => of(null) }));
    await TestBed.configureTestingModule({
      imports: [SalesItemsPage, TranslocoTestingModule.forRoot({
        langs: { en: translations }, preloadLangs: true,
        translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }
      })],
      providers: [
        { provide: ProductAccessState, useValue: { availability: () => availability } },
        { provide: SalesCapabilities, useValue: capabilities },
        { provide: SalesItemsApi, useValue: api },
        { provide: SalesItemsQueries, useValue: queries },
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

  it.each(['UNKNOWN', 'UNAVAILABLE'] as const)('does not call SALES Catalog when access is %s', async (state) => {
    availability = state;
    const fixture = TestBed.createComponent(SalesItemsPage);
    fixture.detectChanges();
    await settle(fixture);
    expect(list).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(state === 'UNKNOWN' ? 'Checking access to Sales' : 'Catalog unavailable');
  });

  it('shows loading then the empty state without an unsupported search control', async () => {
    let resolveList!: (value: SalesCatalogItemListResponse) => void;
    list.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    const fixture = TestBed.createComponent(SalesItemsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading items and services');
    expect(fixture.nativeElement.querySelector('input[type="search"]')).toBeNull();
    resolveList({ items: [] });
    await settle(fixture);
    expect(fixture.nativeElement.textContent).toContain('No items or services yet');
    expect(fixture.nativeElement.textContent).toContain('New item or service');
  });

  it('shows a recoverable page error when the list request fails', async () => {
    list.mockRejectedValue(new Error('Network unavailable'));
    const fixture = TestBed.createComponent(SalesItemsPage);
    fixture.detectChanges();
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Load failed.');
    expect(fixture.nativeElement.textContent).toContain('Try again');
  });

  it('renders product and service semantics, optional unit, status and responsive cards', async () => {
    list.mockResolvedValue({ items: [item({ itemType: 'PRODUCT', name: 'Laptop', unit: undefined }), item({ id: 'SI-2', name: 'Advisory' })] });
    const fixture = TestBed.createComponent(SalesItemsPage);
    fixture.detectChanges();
    await settle(fixture);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Laptop');
    expect(text).toContain('Article');
    expect(text).toContain('Advisory');
    expect(text).toContain('Service');
    expect(text).toContain('Active');
    expect(text).toContain('—');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="sales-item-mobile-card"]')).toHaveLength(2);
  });

  it('hides every mutation action in read-only mode', async () => {
    canWrite = false;
    list.mockResolvedValue({ items: [item()] });
    const fixture = TestBed.createComponent(SalesItemsPage);
    fixture.detectChanges();
    await settle(fixture);
    expect(fixture.nativeElement.textContent).not.toContain('New item or service');
    expect(fixture.nativeElement.querySelector('button[aria-label="Open row actions"]')).toBeNull();
  });

  it('offers writer actions without delete, price, tax, stock or invoicing placeholders', async () => {
    list.mockResolvedValue({ items: [item()] });
    const fixture = TestBed.createComponent(SalesItemsPage);
    fixture.detectChanges();
    await settle(fixture);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('New item or service');
    for (const deferred of ['Delete', 'Price', 'Tax', 'Stock', 'Invoice']) expect(text).not.toContain(deferred);
  });

  it('uses nextCursor opaquely and returns to the prior page', async () => {
    list.mockImplementation(async (options: { cursor?: string }) => options.cursor
      ? { items: [item({ id: 'SI-2', name: 'Second service' })] }
      : { items: [item()], nextCursor: 'opaque+/=next' });
    const fixture = TestBed.createComponent(SalesItemsPage);
    fixture.detectChanges();
    await settle(fixture);
    fixture.componentInstance['nextPage']();
    await settle(fixture);
    expect(list).toHaveBeenLastCalledWith({ limit: 50, cursor: 'opaque+/=next' });
    fixture.componentInstance['previousPage']();
    await settle(fixture);
    expect(list).toHaveBeenLastCalledWith({ limit: 50, cursor: undefined });
  });

  it('uses the current version for lifecycle mutation and invalidates only the item root', async () => {
    const current = item({ version: 7, isActive: true });
    api.deactivate.mockResolvedValue({ data: item({ version: 8, isActive: false }), message: null });
    list.mockResolvedValue({ items: [current] });
    const fixture = TestBed.createComponent(SalesItemsPage);
    fixture.detectChanges();
    await settle(fixture);
    const invalidate = vi.spyOn(TestBed.inject(QueryClient), 'invalidateQueries');
    await fixture.componentInstance['changeStatus'](current);
    expect(api.deactivate).toHaveBeenCalledWith('SI-1', 7);
    expect(api.activate).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sales', 'org-sales', 'items'] });
  });
});

async function settle(fixture: { detectChanges(): void }): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

function item(overrides: Partial<SalesCatalogItem> = {}): SalesCatalogItem {
  return {
    id: 'SI-1', itemType: 'SERVICE', name: 'Advisory', description: 'Business support', unit: 'Hour',
    isActive: true, version: 7, createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-01T10:00:00.000Z', ...overrides
  };
}

const translations = {
  COMMON: { ACTIONS: { RETRY: 'Try again' }, EMPTY_VALUE: '—', PAGINATION: { NEXT: 'Next', PREVIOUS: 'Previous' }, TABLE: { ACTION_MENU: 'Open row actions' } },
  SALES: { ITEMS: {
    ACCESS: { CHECKING: 'Checking access to Sales…', UNAVAILABLE_DESCRIPTION: 'Sales is unavailable.', UNAVAILABLE_TITLE: 'Catalog unavailable' },
    ACTIONS: { ACTIVATE: 'Reactivate', CREATE: 'New item or service', DEACTIVATE: 'Deactivate', EDIT: 'Edit' },
    EMPTY: { DESCRIPTION: 'Create the first catalog entry.', TITLE: 'No items or services yet' },
    ERRORS: { CONFLICT: 'Item changed.', DETAIL_FAILED: 'Detail failed.', LOAD_FAILED: 'Load failed.', STATUS_FAILED: 'Status failed.' },
    LIFECYCLE: { ACTIVATE_DESCRIPTION: 'Reactivate {{name}}.', ACTIVATE_TITLE: 'Reactivate?', DEACTIVATE_DESCRIPTION: 'Deactivate {{name}}.', DEACTIVATE_TITLE: 'Deactivate?' },
    LIST: { DESCRIPTION: 'Commercial catalog.', TITLE: 'Catalog' }, LOADING: 'Loading items and services…',
    NOTIFICATIONS: { ACTIVATED: 'Reactivated.', DEACTIVATED: 'Deactivated.' },
    PAGE: { EYEBROW: 'Sales', SUBTITLE: 'Manage the catalog.', TITLE: 'Items & services' },
    PAGINATION: { LABEL: 'Catalog pagination', PAGE_SIZE: 'Up to {{count}} entries per page' },
    STATUS: { ACTIVE: 'Active', INACTIVE: 'Inactive' },
    TABLE: { ACTIONS: 'Actions', NAME: 'Name', STATUS: 'Status', TYPE: 'Type', UNIT: 'Unit' },
    TYPES: { PRODUCT: 'Article', SERVICE: 'Service' }
  } }
};
