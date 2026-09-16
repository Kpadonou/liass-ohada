import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import type {
  SalesDraftInvoice,
  SalesInvoice,
  SalesInvoiceDocument,
  SalesInvoiceReceivable,
  SalesPaymentListResponse,
  SalesCreditNoteListResponse
} from '@liass-ohada/shared/sales';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, queryOptions, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ProductAccessState } from '../../../../core/product-access/product-access.state';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { SalesCapabilities } from '../../data-access/sales-capabilities';
import { SalesInvoicesApi } from '../../data-access/sales-invoices.api';
import { SalesInvoicesQueries } from '../../data-access/sales-invoices.queries';
import { SalesCreditNotesApi } from '../../data-access/sales-credit-notes.api';
import { SalesCreditNotesQueries } from '../../data-access/sales-credit-notes.queries';
import { SalesPaymentsQueries } from '../../data-access/sales-payments.queries';
import { SalesInvoiceDetailPage } from './sales-invoice-detail.page';

describe('SalesInvoiceDetailPage', () => {
  let canWrite = true;
  let get = vi.fn(async (): Promise<SalesInvoice> => invoice());
  let getDocument = vi.fn<() => Promise<SalesInvoiceDocument>>(async () => { throw new HttpErrorResponse({ status: 404 }); });
  let getReceivable = vi.fn(async (): Promise<SalesInvoiceReceivable> => receivable());
  let listPayments = vi.fn(async (): Promise<SalesPaymentListResponse> => ({ items: [] }));
  let listCreditNotes = vi.fn(async (): Promise<SalesCreditNoteListResponse> => ({ items: [] }));
  const open = vi.fn(() => ({ afterClosed: () => of(null) }));
  const capabilities = { canRead: () => true, canWrite: vi.fn(() => canWrite) };
  const queries = {
    rootKey: () => ['sales', 'org-sales', 'invoices'],
    listRootKey: () => ['sales', 'org-sales', 'invoices', 'list'],
    detailKey: (id: string) => ['sales', 'org-sales', 'invoices', id],
    documentKey: (id: string) => ['sales', 'org-sales', 'invoices', id, 'document', 'pdf'],
    detail: (id: string, enabled = true) => queryOptions({ queryKey: ['sales', 'org-sales', 'invoices', id], queryFn: () => get(), enabled }),
    document: (id: string) => queryOptions({
      queryKey: ['sales', 'org-sales', 'invoices', id, 'document', 'pdf'],
      queryFn: () => getDocument(),
      enabled: true,
      retry: false
    })
  };
  const paymentQueries = {
    receivableKey: (id: string) => ['sales', 'org-sales', 'invoices', id, 'receivable'],
    paymentsRootKey: (id: string) => ['sales', 'org-sales', 'invoices', id, 'payments'],
    receivable: (id: string, enabled = true) => queryOptions({
      queryKey: ['sales', 'org-sales', 'invoices', id, 'receivable'],
      queryFn: () => getReceivable(), enabled, retry: false
    }),
    payments: (id: string, options: { cursor?: string; limit?: number }, enabled = true) => queryOptions({
      queryKey: ['sales', 'org-sales', 'invoices', id, 'payments', options],
      queryFn: () => listPayments(), enabled, retry: false
    })
  };
  const creditNoteQueries = {
    rootKey: (id: string) => ['sales', 'org-sales', 'invoices', id, 'credit-notes'],
    detailKey: (invoiceId: string, creditNoteId: string) => ['sales', 'org-sales', 'invoices', invoiceId, 'credit-notes', creditNoteId],
    list: (id: string, options: { cursor?: string; limit?: number }, enabled = true) => queryOptions({
      queryKey: ['sales', 'org-sales', 'invoices', id, 'credit-notes', options],
      queryFn: () => listCreditNotes(), enabled, retry: false
    })
  };

  beforeEach(async () => {
    canWrite = true;
    get = vi.fn(async (): Promise<SalesInvoice> => invoice());
    getDocument = vi.fn<() => Promise<SalesInvoiceDocument>>(async () => { throw new HttpErrorResponse({ status: 404 }); });
    getReceivable = vi.fn(async (): Promise<SalesInvoiceReceivable> => receivable());
    listPayments = vi.fn(async (): Promise<SalesPaymentListResponse> => ({ items: [] }));
    listCreditNotes = vi.fn(async (): Promise<SalesCreditNoteListResponse> => ({ items: [] }));
    capabilities.canWrite.mockImplementation(() => canWrite);
    await TestBed.configureTestingModule({
      imports: [SalesInvoiceDetailPage, TranslocoTestingModule.forRoot({ langs: { en: translations }, preloadLangs: true, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ invoiceId: 'INV-1' }) } } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
        { provide: SalesCapabilities, useValue: capabilities },
        { provide: SalesInvoicesApi, useValue: { removeLine: vi.fn(), issueInvoice: vi.fn(), generateDocument: vi.fn(), createDocumentDownloadUrl: vi.fn() } },
        { provide: SalesInvoicesQueries, useValue: queries },
        { provide: SalesPaymentsQueries, useValue: paymentQueries },
        { provide: SalesCreditNotesQueries, useValue: creditNoteQueries },
        { provide: SalesCreditNotesApi, useValue: { create: vi.fn() } },
        { provide: MatDialog, useValue: { open } },
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

  it('keeps settlement entirely absent and unfetched for a draft', async () => {
    const fixture = TestBed.createComponent(SalesInvoiceDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    expect(getReceivable).not.toHaveBeenCalled();
    expect(listPayments).not.toHaveBeenCalled();
    expect(listCreditNotes).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain('Settlement');
    expect(fixture.nativeElement.textContent).not.toContain('Payment history');
  });

  it('shows authoritative credited amount and the invoice-scoped empty credit-note state for an issued invoice', async () => {
    get.mockResolvedValue(issuedInvoice());
    getReceivable.mockResolvedValue(receivable({ amountPaid: '5', creditedAmount: '10', balanceDue: '20.39', status: 'PARTIALLY_SETTLED' }));
    const fixture = TestBed.createComponent(SalesInvoiceDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    const text = fixture.nativeElement.textContent;
    expect(listCreditNotes).toHaveBeenCalled();
    expect(text).toContain('Credited amount');
    expect(text).toContain('10 EUR');
    expect(text).toContain('No credit notes');
    expect(buttonWithText(fixture.nativeElement, 'Create credit note')).toBeTruthy();
  });

  it('lets readers view credit notes but hides creation', async () => {
    canWrite = false;
    get.mockResolvedValue(issuedInvoice());
    listCreditNotes.mockResolvedValue({ items: [{
      id: 'CN-1', originalInvoiceId: 'INV-1', originalInvoiceNumber: '42', currency: 'EUR', status: 'ISSUED',
      reason: 'Reduction', subtotal: '10', taxTotal: '0', total: '10', lineCount: 1, version: 2,
      createdAt: '2026-09-10T10:00:00.000Z', updatedAt: '2026-09-11T10:00:00.000Z',
      creditNoteNumber: '7', issueDate: '2026-09-11', issuedAt: '2026-09-11T10:00:00.000Z'
    }] });
    const readerFixture = TestBed.createComponent(SalesInvoiceDetailPage);
    readerFixture.detectChanges();
    await settle(readerFixture);
    expect(readerFixture.nativeElement.textContent).toContain('Credit note no. 7');
    expect(buttonWithText(readerFixture.nativeElement, 'Create credit note')).toBeUndefined();
  });

  it('hides credit-note creation for a settled invoice', async () => {
    get.mockResolvedValue(issuedInvoice());
    getReceivable.mockResolvedValue(receivable({ balanceDue: '0', status: 'SETTLED' }));
    const settledFixture = TestBed.createComponent(SalesInvoiceDetailPage);
    settledFixture.detectChanges();
    await settle(settledFixture);
    expect(buttonWithText(settledFixture.nativeElement, 'Create credit note')).toBeUndefined();
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

  it('shows issuance for a writable draft with lines and opens a focused review dialog', async () => {
    const fixture = TestBed.createComponent(SalesInvoiceDetailPage);
    const componentDialog = (fixture.componentInstance as unknown as { dialog: MatDialog }).dialog;
    const dialogOpen = vi.spyOn(componentDialog, 'open').mockReturnValue({
      afterClosed: () => of(null)
    } as never);
    fixture.detectChanges();
    await settle(fixture);
    const issue = buttonWithText(fixture.nativeElement, 'Issue invoice');
    expect(issue?.disabled).toBe(false);
    issue?.click();
    expect(dialogOpen).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      data: expect.objectContaining({ id: 'INV-1', version: 2 }),
      disableClose: true
    }));
  });

  it('prevents a zero-line draft but allows customerless and zero-total issuance', async () => {
    get.mockResolvedValue(invoice({
      customerId: undefined,
      customerSnapshot: undefined,
      lines: [],
      lineCount: 0,
      subtotal: '0',
      taxTotal: '0',
      total: '0'
    }));
    const emptyFixture = TestBed.createComponent(SalesInvoiceDetailPage);
    emptyFixture.detectChanges();
    await settle(emptyFixture);
    expect(buttonWithText(emptyFixture.nativeElement, 'Issue invoice')?.disabled).toBe(true);
    expect(emptyFixture.nativeElement.textContent).toContain('Add at least one line');

    get.mockResolvedValue(invoice({
      customerId: undefined,
      customerSnapshot: undefined,
      subtotal: '0',
      taxTotal: '0',
      total: '0'
    }));
    const eligibleFixture = TestBed.createComponent(SalesInvoiceDetailPage);
    eligibleFixture.detectChanges();
    await settle(eligibleFixture);
    expect(buttonWithText(eligibleFixture.nativeElement, 'Issue invoice')?.disabled).toBe(false);
  });

  it('renders issued facts and removes all mutation controls even for a writer', async () => {
    get.mockResolvedValue(issuedInvoice());
    const fixture = TestBed.createComponent(SalesInvoiceDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Issued');
    expect(text).toContain('Invoice no. 00000042');
    expect(text).toContain('09/08/2026');
    expect(text).toContain('ABC SARL (snapshot)');
    expect(text).toContain('35.39 EUR');
    expect(text).not.toContain('Issue invoice');
    expect(text).not.toContain('Change customer');
    expect(text).not.toContain('Change currency');
    expect(text).not.toContain('Add line');
    expect(text).not.toContain('Edit line');
    expect(text).not.toContain('Remove line');
    expect(text).not.toMatch(/certif|fiscal|DGI|e-MECeF/i);
  });

  it('renders an issued invoice and its version-zero settlement as separate state machines', async () => {
    get.mockResolvedValue(issuedInvoice());
    getReceivable.mockResolvedValue(receivable());
    listPayments.mockResolvedValue({ items: [{
      id: 'PAY-1', invoiceId: 'INV-1', amount: '10.50', currency: 'EUR',
      paymentDate: '2026-09-09', method: 'BANK_TRANSFER', reference: 'BANK-42',
      createdAt: '2026-09-09T10:00:00.000Z'
    }] });
    const fixture = TestBed.createComponent(SalesInvoiceDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    const text = fixture.nativeElement.textContent;
    expect(getReceivable).toHaveBeenCalled();
    expect(listPayments).toHaveBeenCalled();
    expect(text).toContain('Issued');
    expect(text).toContain('Settlement');
    expect(text).toContain('Open');
    expect(text).toContain('35.39 EUR');
    expect(text).toContain('0 EUR');
    expect(text).toContain('Bank transfer');
    expect(text).toContain('BANK-42');
    expect(text).toContain('10.50 EUR');
    expect(buttonWithText(fixture.nativeElement, 'Record payment')).toBeTruthy();
  });

  it('lets a reader inspect settlement history without showing a disabled payment action', async () => {
    canWrite = false;
    get.mockResolvedValue(issuedInvoice());
    const fixture = TestBed.createComponent(SalesInvoiceDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    expect(fixture.nativeElement.textContent).toContain('Settlement');
    expect(fixture.nativeElement.textContent).toContain('No payments recorded');
    expect(buttonWithText(fixture.nativeElement, 'Record payment')).toBeUndefined();
  });

  it('renders a zero-total settled state without a payment action', async () => {
    get.mockResolvedValue(issuedInvoice({ total: '0', subtotal: '0', taxTotal: '0' }));
    getReceivable.mockResolvedValue(receivable({
      invoiceAmount: '0', amountPaid: '0', creditedAmount: '0', balanceDue: '0', status: 'SETTLED'
    }));
    const fixture = TestBed.createComponent(SalesInvoiceDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    expect(fixture.nativeElement.textContent).toContain('Settled');
    expect(buttonWithText(fixture.nativeElement, 'Record payment')).toBeUndefined();
  });

  it('keeps settlement query failures local to the issued invoice detail', async () => {
    get.mockResolvedValue(issuedInvoice());
    getReceivable.mockRejectedValue(new Error('offline'));
    const fixture = TestBed.createComponent(SalesInvoiceDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    expect(fixture.nativeElement.textContent).toContain('Invoice no. 00000042');
    expect(fixture.nativeElement.textContent).toContain('The payment status could not be loaded');
    expect(fixture.nativeElement.textContent).toContain('No payments recorded');
  });

  it('accepts the authoritative Payment response without mutating Invoice or PDF state', async () => {
    get.mockResolvedValue(issuedInvoice());
    const fixture = TestBed.createComponent(SalesInvoiceDetailPage);
    const component = fixture.componentInstance as unknown as {
      dialog: MatDialog;
      queryClient: QueryClient;
      notification: NotificationService;
      paymentQueries: typeof paymentQueries;
    };
    const authoritative = receivable({
      amountPaid: '10.50', creditedAmount: '0', balanceDue: '24.89', status: 'PARTIALLY_SETTLED', paymentCount: 1, version: 1
    });
    vi.spyOn(component.dialog, 'open').mockReturnValue({ afterClosed: () => of({
      data: {
        payment: { id: 'PAY-1', invoiceId: 'INV-1', amount: '10.50', currency: 'EUR', paymentDate: '2026-09-10', method: 'CASH', createdAt: '2026-09-10T10:00:00.000Z' },
        receivable: authoritative
      },
      message: 'Recorded by server'
    }) } as never);
    const invalidate = vi.spyOn(component.queryClient, 'invalidateQueries');
    const success = vi.spyOn(component.notification, 'success');
    fixture.detectChanges();
    await settle(fixture);
    buttonWithText(fixture.nativeElement, 'Record payment')?.click();
    await settle(fixture);
    expect(component.queryClient.getQueryData(paymentQueries.receivableKey('INV-1'))).toEqual(authoritative);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: paymentQueries.paymentsRootKey('INV-1') });
    expect(success).toHaveBeenCalledWith('Recorded by server');
    expect(component.queryClient.getQueryData(queries.detailKey('INV-1'))).toMatchObject({ status: 'ISSUED', version: 3 });
    expect((TestBed.inject(SalesInvoicesApi) as unknown as { generateDocument: ReturnType<typeof vi.fn> }).generateDocument).not.toHaveBeenCalled();
  });

  it('shows a writer the generate action only for an issued invoice whose document is absent', async () => {
    get.mockResolvedValue(issuedInvoice());
    const fixture = TestBed.createComponent(SalesInvoiceDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    expect(fixture.nativeElement.textContent).toContain('PDF document not generated');
    expect(buttonWithText(fixture.nativeElement, 'Generate PDF')).toBeTruthy();
  });

  it('shows read-only users the available document actions without its integrity hash', async () => {
    canWrite = false;
    get.mockResolvedValue(issuedInvoice());
    getDocument.mockResolvedValue({
      status: 'AVAILABLE', invoiceId: 'INV-1', documentType: 'INVOICE_PDF', renderingVersion: '1',
      contentHash: 'a'.repeat(64), contentType: 'application/pdf', sizeBytes: 2048,
      generatedAt: '2026-09-08T10:00:00.000Z'
    } satisfies SalesInvoiceDocument);
    const fixture = TestBed.createComponent(SalesInvoiceDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('PDF available');
    expect(buttonWithText(fixture.nativeElement, 'Open PDF')).toBeTruthy();
    expect(buttonWithText(fixture.nativeElement, 'Download')).toBeTruthy();
    expect(buttonWithText(fixture.nativeElement, 'Print')).toBeTruthy();
    expect(text).not.toContain('Generate PDF');
    expect(text).not.toContain('a'.repeat(64));
    expect(text).not.toMatch(/digital signature|certificate/i);
  });

  it('accepts the server-issued aggregate and refreshes the existing invoice list cache', async () => {
    const fixture = TestBed.createComponent(SalesInvoiceDetailPage);
    const component = fixture.componentInstance as unknown as {
      dialog: MatDialog;
      queryClient: QueryClient;
      notification: NotificationService;
    };
    vi.spyOn(component.dialog, 'open').mockReturnValue({
      afterClosed: () => of({ kind: 'issued', invoice: issuedInvoice(), message: 'Issued by server' })
    } as never);
    const invalidate = vi.spyOn(component.queryClient, 'invalidateQueries');
    const success = vi.spyOn(component.notification, 'success');
    fixture.detectChanges();
    await settle(fixture);
    buttonWithText(fixture.nativeElement, 'Issue invoice')?.click();
    await settle(fixture);
    expect(component.queryClient.getQueryData(queries.detailKey('INV-1'))).toMatchObject({
      status: 'ISSUED',
      invoiceNumber: '00000042'
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queries.listRootKey() });
    expect(success).toHaveBeenCalledWith('Issued by server');
  });

  it('refetches authoritative detail/list and requires re-review after a version conflict', async () => {
    const fixture = TestBed.createComponent(SalesInvoiceDetailPage);
    const component = fixture.componentInstance as unknown as {
      dialog: MatDialog;
      queryClient: QueryClient;
      notification: NotificationService;
    };
    vi.spyOn(component.dialog, 'open').mockReturnValue({
      afterClosed: () => of({ kind: 'refresh', reason: 'version-conflict' })
    } as never);
    const invalidate = vi.spyOn(component.queryClient, 'invalidateQueries');
    const warn = vi.spyOn(component.notification, 'warn');
    fixture.detectChanges();
    await settle(fixture);
    buttonWithText(fixture.nativeElement, 'Issue invoice')?.click();
    await settle(fixture);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queries.detailKey('INV-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queries.rootKey() });
    expect(warn).toHaveBeenCalled();
  });
});

function invoice(overrides: Partial<SalesDraftInvoice> = {}): SalesDraftInvoice {
  return {
    id: 'INV-1', status: 'DRAFT', currency: 'EUR', customerId: 'C-1', customerSnapshot: { name: 'ABC SARL (snapshot)', taxIdentifier: 'IFU-1' },
    lines: [{ id: 'L-1', position: 1, catalogItemId: 'I-1', description: 'Advisory', unit: 'hour', quantity: '1.5', unitPrice: '19.99', taxRate: '18', subtotal: '29.99', taxAmount: '5.40', total: '35.39', createdAt: '2026-08-31T10:00:00.000Z', updatedAt: '2026-08-31T10:00:00.000Z' }],
    lineCount: 1, subtotal: '29.99', taxTotal: '5.40', total: '35.39', version: 2, createdAt: '2026-08-31T10:00:00.000Z', updatedAt: '2026-08-31T10:00:00.000Z', ...overrides
  };
}
function issuedInvoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    ...invoice(),
    status: 'ISSUED',
    invoiceNumber: '00000042',
    issueDate: '2026-09-08',
    issuedAt: '2026-09-08T10:30:00.000Z',
    version: 3,
    ...overrides
  };
}
function receivable(overrides: Partial<SalesInvoiceReceivable> = {}): SalesInvoiceReceivable {
  return {
    invoiceId: 'INV-1', currency: 'EUR', invoiceAmount: '35.39', amountPaid: '0',
    creditedAmount: '0', balanceDue: '35.39', status: 'OPEN', paymentCount: 0, version: 0,
    updatedAt: '2026-09-08T10:30:00.000Z', ...overrides
  };
}
function buttonWithText(root: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((button) => button.textContent?.includes(label));
}
async function settle(fixture: { detectChanges(): void }): Promise<void> {
  for (let index = 0; index < 7; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }
}
const translations = {
  COMMON: { EMPTY_VALUE: '—', ACTIONS: { RETRY: 'Try again', CANCEL: 'Cancel' }, TABLE: { ACTIONS: 'Actions' } },
  SALES: { INVOICES: {
    STATUS: { DRAFT: 'Draft', ISSUED: 'Issued' }, DETAIL: { EYEBROW: 'Sales · Draft', TITLE: 'Draft invoice', SUBTITLE: 'Prepare the draft', LOADING: 'Loading', DRAFT_NOTICE: 'Editable draft.', NO_CUSTOMER_DESCRIPTION: 'No customer.', ISSUED_EYEBROW: 'Sales · Issued', ISSUED_TITLE: 'Issued invoice', ISSUED_SUBTITLE: 'Read only', ISSUED_NOTICE: 'This invoice has been issued and can no longer be edited.', INVOICE_NUMBER: 'Invoice no. {{invoiceNumber}}' },
    ACCESS: { UNAVAILABLE_DESCRIPTION: 'Unavailable' }, ACTIONS: { ADD_LINE: 'Add line', ISSUE: 'Issue invoice', BACK_TO_LIST: 'Back', CHANGE_CURRENCY: 'Change currency', CHANGE_CUSTOMER: 'Change customer', SELECT_CUSTOMER: 'Select customer', EDIT_LINE: 'Edit line', REMOVE_LINE: 'Remove line' },
    TABLE: { INTERNAL_REFERENCE: 'Internal ref.' }, FIELDS: { CUSTOMER: 'Customer', CURRENCY: 'Currency', TAX_IDENTIFIER: 'Tax identifier', LINES: 'Lines', DESCRIPTION: 'Description', QUANTITY: 'Quantity', UNIT: 'Unit', UNIT_PRICE: 'Unit price', TAX_RATE: 'Tax rate', TAX: 'Tax', TOTAL: 'Total', SUBTOTAL: 'Subtotal', ISSUE_DATE: 'Invoice date', ISSUED_AT: 'Issued at' },
    LINES: { DESCRIPTION: 'Authoritative amounts', EMPTY_TITLE: 'No lines', EMPTY_DESCRIPTION: 'Add line', CATALOG_SNAPSHOT: 'Catalog snapshot' }, TOTALS: { TITLE: 'Invoice totals', AUTHORITATIVE: 'Authoritative.' }, ISSUE: { NO_LINES_HINT: 'Add at least one line' }, ERRORS: { DETAIL_FAILED: 'Failed' }, REMOVE_LINE: { TITLE: 'Remove?', DESCRIPTION: '{{description}}' },
    DOCUMENT: { TITLE: 'PDF document', LOADING: 'Checking', NOT_GENERATED_TITLE: 'PDF document not generated', NOT_GENERATED_DESCRIPTION: 'Not generated', GENERATING: 'Generating PDF', AVAILABLE: 'PDF available', AVAILABLE_DESCRIPTION: 'PDF representation', GENERATED_AT: 'Generated at {{generatedAt}}', ACTIONS: { GENERATE: 'Generate PDF', OPEN: 'Open PDF', DOWNLOAD: 'Download', PRINT: 'Print' }, NOTIFICATIONS: { READY: 'Ready' }, ERRORS: { UNAVAILABLE: 'Unavailable', GENERATION_FAILED: 'Generation failed', SECURE_LINK_FAILED: 'Link failed' } },
    SETTLEMENT: {
      TITLE: 'Settlement', DESCRIPTION: 'Separate settlement', LOADING: 'Loading settlement', PAYMENT_STATUS: 'Payment status', INVOICE_AMOUNT: 'Invoice amount', AMOUNT_PAID: 'Amount paid', CREDITED_AMOUNT: 'Credited amount', BALANCE_DUE: 'Balance due', PAYMENT_COUNT: 'Payment count',
      STATUS: { OPEN: 'Open', PARTIALLY_SETTLED: 'Partially settled', SETTLED: 'Settled' }, METHODS: { CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', CARD: 'Card', MOBILE_MONEY: 'Mobile Money', CHEQUE: 'Cheque', OTHER: 'Other' }, ACTIONS: { RECORD: 'Record payment' }, FORM: { PAYMENT_DATE: 'Payment date', METHOD: 'Payment method', REFERENCE: 'Reference', AMOUNT: 'Amount' }, HISTORY: { TITLE: 'Payment history', DESCRIPTION: 'Immutable', LOADING: 'Loading payments', EMPTY: 'No payments recorded', ERROR: 'History failed', PAGINATION: 'Payment history pagination', PAGE_SIZE: '{{count}} payments' }, NOTIFICATIONS: { RECORDED: 'Payment recorded' }, ERRORS: { LOAD_FAILED: 'The payment status could not be loaded' }
    }
  }, CREDIT_NOTES: { NUMBER: 'Credit note no. {{number}}', DRAFT_TITLE: 'Credit note draft', STATUS: { DRAFT: 'Draft', ISSUED: 'Issued' }, ACTIONS: { CREATE: 'Create credit note' }, LIST: { TITLE: 'Credit notes', DESCRIPTION: 'Invoice credit notes', LOADING: 'Loading credit notes', EMPTY_TITLE: 'No credit notes', EMPTY_DESCRIPTION: 'No credit notes', PAGINATION: 'Credit note pagination', PAGE_SIZE: '{{count}} credit notes' }, TABLE: { CREDIT_NOTE: 'Credit note' }, FIELDS: { STATUS: 'Status', DATE: 'Date', REASON: 'Reason', LINE_COUNT: 'Lines', TOTAL: 'Total' }, ERRORS: { LOAD_FAILED: 'Credit notes could not be loaded' } } }
};
