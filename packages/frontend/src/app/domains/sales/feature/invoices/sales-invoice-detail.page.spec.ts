import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import type { SalesInvoice } from '@liass-ohada/shared/sales';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, queryOptions, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ProductAccessState } from '../../../../core/product-access/product-access.state';
import { SalesCapabilities } from '../../data-access/sales-capabilities';
import { SalesInvoicesApi } from '../../data-access/sales-invoices.api';
import { SalesInvoicesQueries } from '../../data-access/sales-invoices.queries';
import { SalesInvoiceDetailPage } from './sales-invoice-detail.page';

describe('SalesInvoiceDetailPage', () => {
  let canWrite = true;
  let get = vi.fn(async () => invoice());
  const capabilities = { canRead: () => true, canWrite: vi.fn(() => canWrite) };
  const queries = {
    rootKey: () => ['sales', 'org-sales', 'invoices'],
    detailKey: (id: string) => ['sales', 'org-sales', 'invoices', id],
    detail: (id: string, enabled = true) => queryOptions({ queryKey: ['sales', 'org-sales', 'invoices', id], queryFn: () => get(), enabled })
  };

  beforeEach(async () => {
    canWrite = true;
    get = vi.fn(async () => invoice());
    capabilities.canWrite.mockImplementation(() => canWrite);
    await TestBed.configureTestingModule({
      imports: [SalesInvoiceDetailPage, TranslocoTestingModule.forRoot({ langs: { en: translations }, preloadLangs: true, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ invoiceId: 'INV-1' }) } } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
        { provide: SalesCapabilities, useValue: capabilities },
        { provide: SalesInvoicesApi, useValue: { removeLine: vi.fn() } },
        { provide: SalesInvoicesQueries, useValue: queries },
        { provide: MatDialog, useValue: { open: vi.fn(() => ({ afterClosed: () => of(null) })) } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } }))
      ]
    }).compileComponents();
  });

  it('loads the canonical detail and presents the stored customer snapshot and backend totals', async () => {
    const fixture = TestBed.createComponent(SalesInvoiceDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    expect(get).toHaveBeenCalled();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('ABC SARL (snapshot)');
    expect(text).toContain('29.99 EUR');
    expect(text).toContain('5.40 EUR');
    expect(text).toContain('35.39 EUR');
    expect(text).not.toContain('Latest live customer');
    expect(text).not.toContain('invoice number');
  });

  it('shows currency editing only while there are no lines', async () => {
    get.mockResolvedValue(invoice({ lineCount: 0, lines: [], subtotal: '0', taxTotal: '0', total: '0' }));
    const fixture = TestBed.createComponent(SalesInvoiceDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    expect(fixture.nativeElement.textContent).toContain('Change currency');
  });

  it('omits all mutation controls for read-only users while preserving draft detail', async () => {
    canWrite = false;
    const fixture = TestBed.createComponent(SalesInvoiceDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('ABC SARL (snapshot)');
    expect(text).not.toContain('Add line');
    expect(text).not.toContain('Edit line');
    expect(text).not.toContain('Remove line');
    expect(text).not.toContain('Delete invoice');
  });
});

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: 'INV-1', status: 'DRAFT', currency: 'EUR', customerId: 'C-1', customerSnapshot: { name: 'ABC SARL (snapshot)', taxIdentifier: 'IFU-1' },
    lines: [{ id: 'L-1', position: 1, catalogItemId: 'I-1', description: 'Advisory', unit: 'hour', quantity: '1.5', unitPrice: '19.99', taxRate: '18', subtotal: '29.99', taxAmount: '5.40', total: '35.39', createdAt: '2026-08-31T10:00:00.000Z', updatedAt: '2026-08-31T10:00:00.000Z' }],
    lineCount: 1, subtotal: '29.99', taxTotal: '5.40', total: '35.39', version: 2, createdAt: '2026-08-31T10:00:00.000Z', updatedAt: '2026-08-31T10:00:00.000Z', ...overrides
  };
}
async function settle(fixture: { detectChanges(): void }): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}
const translations = {
  COMMON: { EMPTY_VALUE: '—', ACTIONS: { RETRY: 'Try again', CANCEL: 'Cancel' }, TABLE: { ACTIONS: 'Actions' } },
  SALES: { INVOICES: {
    STATUS: { DRAFT: 'Draft' }, DETAIL: { EYEBROW: 'Sales · Draft', TITLE: 'Draft invoice', SUBTITLE: 'Prepare the draft', LOADING: 'Loading', DRAFT_NOTICE: 'Editable draft.', NO_CUSTOMER_DESCRIPTION: 'No customer.' },
    ACCESS: { UNAVAILABLE_DESCRIPTION: 'Unavailable' }, ACTIONS: { ADD_LINE: 'Add line', BACK_TO_LIST: 'Back', CHANGE_CURRENCY: 'Change currency', CHANGE_CUSTOMER: 'Change customer', SELECT_CUSTOMER: 'Select customer', EDIT_LINE: 'Edit line', REMOVE_LINE: 'Remove line' },
    TABLE: { INTERNAL_REFERENCE: 'Internal ref.' }, FIELDS: { CUSTOMER: 'Customer', CURRENCY: 'Currency', TAX_IDENTIFIER: 'Tax identifier', LINES: 'Lines', DESCRIPTION: 'Description', QUANTITY: 'Quantity', UNIT: 'Unit', UNIT_PRICE: 'Unit price', TAX_RATE: 'Tax rate', TAX: 'Tax', TOTAL: 'Total', SUBTOTAL: 'Subtotal' },
    LINES: { DESCRIPTION: 'Authoritative amounts', EMPTY_TITLE: 'No lines', EMPTY_DESCRIPTION: 'Add line', CATALOG_SNAPSHOT: 'Catalog snapshot' }, TOTALS: { TITLE: 'Draft totals', AUTHORITATIVE: 'Calculated by Sales.' }, ERRORS: { DETAIL_FAILED: 'Failed' }, REMOVE_LINE: { TITLE: 'Remove?', DESCRIPTION: '{{description}}' }
  } }
};
