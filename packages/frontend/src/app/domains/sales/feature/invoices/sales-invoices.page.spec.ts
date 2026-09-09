import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import type { SalesInvoice, SalesInvoiceListResponse, SalesInvoiceSummary } from '@liass-ohada/shared/sales';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, queryOptions, QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { ProductAccessState } from '../../../../core/product-access/product-access.state';
import { SalesCapabilities } from '../../data-access/sales-capabilities';
import { SalesInvoicesApi } from '../../data-access/sales-invoices.api';
import { SalesInvoicesQueries } from '../../data-access/sales-invoices.queries';
import { SalesInvoicesPage } from './sales-invoices.page';

describe('SalesInvoicesPage', () => {
  let canWrite = true;
  let availability: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN' = 'AVAILABLE';
  let list = vi.fn(async (_options: { cursor?: string; limit?: number }): Promise<SalesInvoiceListResponse> => ({ items: [] }));
  const api = { create: vi.fn() };
  const router = { navigate: vi.fn(async () => true) };
  const capabilities = { canRead: vi.fn(() => true), canWrite: vi.fn(() => canWrite) };
  const queries = {
    rootKey: () => ['sales', 'org-sales', 'invoices'],
    detailKey: (id: string) => ['sales', 'org-sales', 'invoices', id],
    list: (options: { cursor?: string; limit?: number }, enabled = true) => queryOptions({
      queryKey: ['sales', 'org-sales', 'invoices', 'list', options.cursor ?? null], queryFn: () => list(options), enabled
    })
  };

  beforeEach(async () => {
    canWrite = true;
    availability = 'AVAILABLE';
    list = vi.fn(async (_options: { cursor?: string; limit?: number }): Promise<SalesInvoiceListResponse> => ({ items: [] }));
    vi.clearAllMocks();
    capabilities.canWrite.mockImplementation(() => canWrite);
    await TestBed.configureTestingModule({
      imports: [SalesInvoicesPage, TranslocoTestingModule.forRoot({ langs: { en: translations }, preloadLangs: true, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [
        { provide: ProductAccessState, useValue: { availability: () => availability } },
        { provide: SalesCapabilities, useValue: capabilities },
        { provide: SalesInvoicesApi, useValue: api },
        { provide: SalesInvoicesQueries, useValue: queries },
        { provide: Router, useValue: router },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } }))
      ]
    }).compileComponents();
  });

  it('renders loading, empty and no unsupported search/filter controls', async () => {
    let resolve!: (value: SalesInvoiceListResponse) => void;
    list.mockReturnValue(new Promise((done) => { resolve = done; }));
    const fixture = TestBed.createComponent(SalesInvoicesPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading draft invoices');
    resolve({ items: [] });
    await settle(fixture);
    expect(fixture.nativeElement.textContent).toContain('No draft invoices yet');
    expect(fixture.nativeElement.querySelector('input[type="search"]')).toBeNull();
  });

  it('renders localized DRAFT semantics, customer, line count and exact-string totals without a fake number', async () => {
    list.mockResolvedValue({ items: [summary()] });
    const fixture = TestBed.createComponent(SalesInvoicesPage);
    fixture.detectChanges();
    await settle(fixture);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Draft');
    expect(text).toContain('ABC SARL');
    expect(text).toContain('2');
    expect(text).toContain('59,000 XOF');
    expect(text).not.toMatch(/FACT-\d/);
  });

  it('keeps the next cursor opaque and uses a local previous-page stack', async () => {
    list.mockImplementation(async (options: { cursor?: string }) => options.cursor
      ? { items: [summary({ id: 'INV-2' })] }
      : { items: [summary()], nextCursor: 'opaque+/=' });
    const fixture = TestBed.createComponent(SalesInvoicesPage);
    fixture.detectChanges();
    await settle(fixture);
    const next = [...fixture.nativeElement.querySelectorAll('button')].find((button: HTMLButtonElement) => button.textContent?.includes('Next'));
    next?.click();
    await settle(fixture);
    expect(list).toHaveBeenCalledWith({ limit: 50, cursor: 'opaque+/=' });
  });

  it('hides every mutation control for SALES_READ without SALES_WRITE', async () => {
    canWrite = false;
    list.mockResolvedValue({ items: [summary()] });
    const fixture = TestBed.createComponent(SalesInvoicesPage);
    fixture.detectChanges();
    await settle(fixture);
    expect(fixture.nativeElement.textContent).not.toContain('New invoice');
    expect(fixture.nativeElement.textContent).toContain('Open');
  });

  it('creates an empty draft and navigates to the editor', async () => {
    api.create.mockResolvedValue({ data: invoice(), message: null });
    const fixture = TestBed.createComponent(SalesInvoicesPage);
    fixture.detectChanges();
    await settle(fixture);
    const create = [...fixture.nativeElement.querySelectorAll('button')].find((button: HTMLButtonElement) => button.textContent?.includes('New invoice'));
    create?.click();
    await settle(fixture);
    expect(api.create).toHaveBeenCalledWith({});
    expect(router.navigate).toHaveBeenCalledWith(['/sales/invoices', 'INV-1']);
  });
});

function summary(overrides: Partial<SalesInvoiceSummary> = {}): SalesInvoiceSummary {
  return { id: 'INV-1', status: 'DRAFT', currency: 'XOF', customerId: 'C-1', customerName: 'ABC SARL', lineCount: 2, subtotal: '50000', taxTotal: '9000', total: '59000', version: 3, createdAt: '2026-08-31T10:00:00.000Z', updatedAt: '2026-08-31T10:00:00.000Z', ...overrides };
}
function invoice(): SalesInvoice { return { ...summary({ lineCount: 0, subtotal: '0', taxTotal: '0', total: '0' }), customerSnapshot: { name: 'ABC SARL' }, lines: [] }; }
async function settle(fixture: { detectChanges(): void }): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}
const translations = {
  COMMON: { EMPTY_VALUE: '—', ACTIONS: { RETRY: 'Try again', OPEN: 'Open' }, PAGINATION: { PREVIOUS: 'Previous', NEXT: 'Next' }, TABLE: { ACTIONS: 'Actions' } },
  SALES: { INVOICES: {
    PAGE: { EYEBROW: 'Sales', TITLE: 'Invoices', SUBTITLE: 'Draft invoices' }, LIST: { TITLE: 'Draft invoices', DESCRIPTION: 'Description' }, LOADING: 'Loading draft invoices…',
    ACCESS: { CHECKING: 'Checking', UNAVAILABLE_TITLE: 'Unavailable', UNAVAILABLE_DESCRIPTION: 'Unavailable' }, STATUS: { DRAFT: 'Draft' }, ACTIONS: { CREATE: 'New invoice' },
    TABLE: { DRAFT: 'Draft', INTERNAL_REFERENCE: 'Internal ref.' }, FIELDS: { CUSTOMER: 'Customer', NO_CUSTOMER: 'No customer', LINES: 'Lines', SUBTOTAL: 'Subtotal', TAX: 'Tax', TOTAL: 'Total' },
    EMPTY: { TITLE: 'No draft invoices yet', DESCRIPTION: 'Create a draft.' }, PAGINATION: { LABEL: 'Pagination', PAGE_SIZE: '{{count}} drafts' }, ERRORS: { LOAD_FAILED: 'Failed', CREATE_FAILED: 'Failed' }, NOTIFICATIONS: { CREATED: 'Created' }
  } }
};
