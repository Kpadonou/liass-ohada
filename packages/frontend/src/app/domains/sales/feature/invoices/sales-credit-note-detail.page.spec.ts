import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import type {
  SalesCreditNote,
  SalesCreditNoteDocument,
  SalesInvoice,
  SalesInvoiceReceivable
} from '@liass-ohada/shared/sales';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, queryOptions, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi, type Mock } from 'vitest';

import { NotificationService } from '../../../../core/notifications/notification.service';
import { ProductAccessState } from '../../../../core/product-access/product-access.state';
import { SalesCapabilities } from '../../data-access/sales-capabilities';
import { SalesCreditNotesApi } from '../../data-access/sales-credit-notes.api';
import { SalesCreditNotesQueries } from '../../data-access/sales-credit-notes.queries';
import { SalesInvoicesQueries } from '../../data-access/sales-invoices.queries';
import { SalesPaymentsQueries } from '../../data-access/sales-payments.queries';
import { SalesCreditNoteDetailPage } from './sales-credit-note-detail.page';

describe('SalesCreditNoteDetailPage document UX', () => {
  let note: SalesCreditNote;
  let salesAvailability: 'AVAILABLE' | 'UNAVAILABLE';
  let canRead: boolean;
  let canWrite: boolean;
  let getCreditNote: Mock<() => Promise<SalesCreditNote>>;
  let getDocument: Mock<() => Promise<SalesCreditNoteDocument>>;
  let generateDocument: Mock<(invoiceId: string, creditNoteId: string) => Promise<{ data: SalesCreditNoteDocument; message?: string }>>;
  let createDocumentDownloadUrl: Mock<(invoiceId: string, creditNoteId: string) => Promise<{ url: string; expiresAt: string }>>;

  const documentKey = ['sales', 'org-sales', 'invoices', 'INV-1', 'credit-notes', 'CN-1', 'document', 'pdf'] as const;
  const creditNoteQueries = {
    rootKey: (invoiceId: string) => ['sales', 'org-sales', 'invoices', invoiceId, 'credit-notes'],
    detailKey: (invoiceId: string, creditNoteId: string) =>
      ['sales', 'org-sales', 'invoices', invoiceId, 'credit-notes', creditNoteId],
    documentKey: () => documentKey,
    detail: (invoiceId: string, creditNoteId: string, enabled = true) => queryOptions({
      queryKey: ['sales', 'org-sales', 'invoices', invoiceId, 'credit-notes', creditNoteId],
      queryFn: () => getCreditNote(), enabled, retry: false
    }),
    document: (invoiceId: string, creditNoteId: string, enabled = true) => queryOptions({
      queryKey: ['sales', 'org-sales', 'invoices', invoiceId, 'credit-notes', creditNoteId, 'document', 'pdf'],
      queryFn: () => getDocument(), enabled, retry: false
    })
  };
  const invoiceQueries = {
    detail: (invoiceId: string, enabled = true) => queryOptions({
      queryKey: ['sales', 'org-sales', 'invoices', invoiceId], queryFn: async () => invoice(), enabled, retry: false
    })
  };
  const paymentQueries = {
    receivableKey: (invoiceId: string) => ['sales', 'org-sales', 'invoices', invoiceId, 'receivable'],
    receivable: (invoiceId: string, enabled = true) => queryOptions({
      queryKey: ['sales', 'org-sales', 'invoices', invoiceId, 'receivable'],
      queryFn: async () => receivable(), enabled, retry: false
    })
  };

  beforeEach(async () => {
    note = draftCreditNote();
    salesAvailability = 'AVAILABLE';
    canRead = true;
    canWrite = true;
    getCreditNote = vi.fn(async () => note);
    getDocument = vi.fn(async () => { throw new HttpErrorResponse({ status: 404 }); });
    generateDocument = vi.fn(async () => ({ data: pdfDocument(), message: 'Ready from server' }));
    createDocumentDownloadUrl = vi.fn(async () => ({
      url: 'https://documents.example.test/opaque', expiresAt: '2026-09-16T11:05:00.000Z'
    }));

    await TestBed.configureTestingModule({
      imports: [
        SalesCreditNoteDetailPage,
        TranslocoTestingModule.forRoot({
          langs: { en: translations }, preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }
        })
      ],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ invoiceId: 'INV-1', creditNoteId: 'CN-1' }) } } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ProductAccessState, useValue: { availability: () => salesAvailability } },
        { provide: SalesCapabilities, useValue: { canRead: () => canRead, canWrite: () => canWrite } },
        { provide: SalesCreditNotesApi, useValue: {
          removeLine: vi.fn(), generateDocument,
          createDocumentDownloadUrl
        } },
        { provide: SalesCreditNotesQueries, useValue: creditNoteQueries },
        { provide: SalesInvoicesQueries, useValue: invoiceQueries },
        { provide: SalesPaymentsQueries, useValue: paymentQueries },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } }))
      ]
    }).compileComponents();
  });

  it('keeps every document query and control out of the Draft UI', async () => {
    const fixture = TestBed.createComponent(SalesCreditNoteDetailPage);
    fixture.detectChanges();
    await settle(fixture);

    expect(getDocument).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain('PDF document');
    expect(documentButtons(fixture.nativeElement)).toEqual([]);
  });

  it('treats a 404 as a normal absent state and lets only a writer generate', async () => {
    note = issuedCreditNote();
    const writer = TestBed.createComponent(SalesCreditNoteDetailPage);
    writer.detectChanges();
    await settle(writer);
    expect(getDocument).toHaveBeenCalledTimes(1);
    expect(writer.nativeElement.textContent).toContain('The credit note PDF has not been generated yet.');
    expect(buttonWithText(writer.nativeElement, 'Generate PDF')).toBeTruthy();
    expect(writer.nativeElement.querySelector('[role="alert"]')).toBeNull();

  });

  it('shows the neutral absent state without a disabled generate action to a read-only user', async () => {
    note = issuedCreditNote();
    canWrite = false;
    const fixture = TestBed.createComponent(SalesCreditNoteDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    expect(fixture.nativeElement.textContent).toContain('The credit note PDF has not been generated yet.');
    expect(buttonWithText(fixture.nativeElement, 'Generate PDF')).toBeUndefined();
  });

  it('shows available metadata and reader actions without exposing hash or storage details', async () => {
    note = issuedCreditNote();
    canWrite = false;
    getDocument.mockResolvedValue(pdfDocument());
    const fixture = TestBed.createComponent(SalesCreditNoteDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('PDF available');
    expect(text).toContain('Generated at');
    expect(buttonWithText(fixture.nativeElement, 'Open PDF in a new tab')).toBeTruthy();
    expect(buttonWithText(fixture.nativeElement, 'Download')).toBeTruthy();
    expect(buttonWithText(fixture.nativeElement, 'Print')).toBeTruthy();
    expect(text).not.toContain('a'.repeat(64));
    expect(text).not.toMatch(/objectKey|bucket|digital signature|certificate/i);
  });

  it('prevents duplicate generation and updates only the credit-note document cache', async () => {
    note = issuedCreditNote();
    let resolveGeneration!: (value: { data: SalesCreditNoteDocument; message: string }) => void;
    generateDocument.mockImplementation(() => new Promise((resolve) => { resolveGeneration = resolve; }));
    const fixture = TestBed.createComponent(SalesCreditNoteDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    const component = fixture.componentInstance as unknown as { queryClient: QueryClient; notification: NotificationService };
    const invalidate = vi.spyOn(component.queryClient, 'invalidateQueries');
    const success = vi.spyOn(component.notification, 'success');
    const generate = buttonWithText(fixture.nativeElement, 'Generate PDF');
    generate?.click();
    generate?.click();
    expect(generateDocument).toHaveBeenCalledTimes(1);
    expect(generateDocument).toHaveBeenCalledWith('INV-1', 'CN-1');
    resolveGeneration({ data: pdfDocument(), message: 'Ready from server' });
    await settle(fixture);
    expect(component.queryClient.getQueryData(documentKey)).toEqual(pdfDocument());
    expect(success).toHaveBeenCalledWith('Ready from server');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('refreshes the authoritative credit note after an ineligible generation response', async () => {
    note = issuedCreditNote();
    generateDocument.mockRejectedValue(apiError(409, 'CREDIT_NOTE_DOCUMENT_REQUIRES_ISSUED', 'No longer eligible'));
    const fixture = TestBed.createComponent(SalesCreditNoteDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    buttonWithText(fixture.nativeElement, 'Generate PDF')?.click();
    await settle(fixture);
    expect(getCreditNote.mock.calls.length).toBeGreaterThan(1);
  });

  it('keeps integrity failures safe and offers canonical regeneration only to writers', async () => {
    note = issuedCreditNote();
    getDocument.mockRejectedValue(apiError(500, 'SALES_CREDIT_NOTE_DOCUMENT_INTEGRITY_ERROR', 'Integrity check failed'));
    const fixture = TestBed.createComponent(SalesCreditNoteDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
    expect(buttonWithText(fixture.nativeElement, 'Try generating again')).toBeTruthy();
    expect(buttonWithText(fixture.nativeElement, 'Open PDF in a new tab')).toBeUndefined();
    expect(createDocumentDownloadUrl).not.toHaveBeenCalled();
  });

  it('opens a blank window synchronously and assigns a fresh backend URL', async () => {
    note = issuedCreditNote();
    getDocument.mockResolvedValue(pdfDocument());
    const popup = { location: { href: '' }, opener: globalThis, close: vi.fn() };
    const windowOpen = vi.spyOn(globalThis.window, 'open').mockReturnValue(popup as unknown as Window);
    const fixture = TestBed.createComponent(SalesCreditNoteDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    buttonWithText(fixture.nativeElement, 'Open PDF in a new tab')?.click();
    expect(windowOpen).toHaveBeenCalledWith('', '_blank');
    await settle(fixture);
    expect(createDocumentDownloadUrl).toHaveBeenCalledWith('INV-1', 'CN-1');
    expect(popup.location.href).toBe('https://documents.example.test/opaque');
    expect(popup.opener).toBeNull();
  });

  it('closes the temporary window when secure-link acquisition fails', async () => {
    note = issuedCreditNote();
    getDocument.mockResolvedValue(pdfDocument());
    createDocumentDownloadUrl.mockRejectedValue(new Error('offline'));
    const popup = { location: { href: '' }, opener: globalThis, close: vi.fn() };
    vi.spyOn(globalThis.window, 'open').mockReturnValue(popup as unknown as Window);
    const fixture = TestBed.createComponent(SalesCreditNoteDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    buttonWithText(fixture.nativeElement, 'Open PDF in a new tab')?.click();
    await settle(fixture);
    expect(popup.close).toHaveBeenCalled();
    expect(popup.location.href).toBe('');
  });

  it('downloads through a fresh URL and leaves the canonical filename to backend Content-Disposition', async () => {
    note = issuedCreditNote({ creditNoteNumber: '00-A/7' });
    getDocument.mockResolvedValue(pdfDocument());
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(SalesCreditNoteDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    buttonWithText(fixture.nativeElement, 'Download')?.click();
    await settle(fixture);
    expect(createDocumentDownloadUrl).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('');
    expect(anchor.href).toBe('https://documents.example.test/opaque');
  });

  it('uses a newly authorized backend PDF for print and never renders the URL in the DOM', async () => {
    note = issuedCreditNote();
    getDocument.mockResolvedValue(pdfDocument());
    const popup = { location: { href: '' }, opener: globalThis, close: vi.fn() };
    vi.spyOn(globalThis.window, 'open').mockReturnValue(popup as unknown as Window);
    const fixture = TestBed.createComponent(SalesCreditNoteDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    buttonWithText(fixture.nativeElement, 'Print')?.click();
    await settle(fixture);
    expect(createDocumentDownloadUrl).toHaveBeenCalledTimes(1);
    expect(popup.location.href).toBe('https://documents.example.test/opaque');
    expect(fixture.nativeElement.textContent).not.toContain('https://documents.example.test/opaque');
  });

  it('does not expose SALES document UX when SALES product access is unavailable', async () => {
    note = issuedCreditNote();
    salesAvailability = 'UNAVAILABLE';
    canRead = false;
    const fixture = TestBed.createComponent(SalesCreditNoteDetailPage);
    fixture.detectChanges();
    await settle(fixture);
    expect(getCreditNote).not.toHaveBeenCalled();
    expect(getDocument).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain('PDF document');
  });
});

function draftCreditNote(
  overrides: Partial<Extract<SalesCreditNote, { status: 'DRAFT' }>> = {}
): Extract<SalesCreditNote, { status: 'DRAFT' }> {
  return {
    id: 'CN-1', originalInvoiceId: 'INV-1', originalInvoiceNumber: '00000042', currency: 'EUR',
    status: 'DRAFT', reason: 'Returned goods', customerSnapshot: { name: 'Snapshot customer' }, lines: [],
    subtotal: '0', taxTotal: '0', total: '0', lineCount: 0, version: 1,
    createdAt: '2026-09-11T10:00:00.000Z', updatedAt: '2026-09-11T10:00:00.000Z', ...overrides
  };
}

function issuedCreditNote(
  overrides: Partial<Extract<SalesCreditNote, { status: 'ISSUED' }>> = {}
): Extract<SalesCreditNote, { status: 'ISSUED' }> {
  return {
    ...draftCreditNote(), status: 'ISSUED', creditNoteNumber: '00000007', issueDate: '2026-09-11',
    issuedAt: '2026-09-11T11:00:00.000Z', version: 2, ...overrides
  } as Extract<SalesCreditNote, { status: 'ISSUED' }>;
}

function invoice(): SalesInvoice {
  return {
    id: 'INV-1', status: 'ISSUED', invoiceNumber: '00000042', issueDate: '2026-09-08',
    issuedAt: '2026-09-08T10:00:00.000Z', currency: 'EUR', lines: [], subtotal: '35.39', taxTotal: '0',
    total: '35.39', lineCount: 0, version: 3, createdAt: '2026-09-08T10:00:00.000Z',
    updatedAt: '2026-09-08T10:00:00.000Z'
  };
}

function receivable(): SalesInvoiceReceivable {
  return {
    invoiceId: 'INV-1', currency: 'EUR', invoiceAmount: '35.39', amountPaid: '0', creditedAmount: '0',
    balanceDue: '35.39', status: 'OPEN', paymentCount: 0, version: 0, updatedAt: '2026-09-08T10:00:00.000Z'
  };
}

function pdfDocument(): SalesCreditNoteDocument {
  return {
    status: 'AVAILABLE', creditNoteId: 'CN-1', documentType: 'CREDIT_NOTE_PDF', renderingVersion: '1',
    contentHash: 'a'.repeat(64), contentType: 'application/pdf', sizeBytes: 2048,
    generatedAt: '2026-09-16T11:00:00.000Z'
  };
}

function apiError(status: number, code: string, message: string): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { message: { code, message } } });
}

function documentButtons(root: HTMLElement): string[] {
  return [...root.querySelectorAll('button')]
    .map((button) => button.textContent?.trim() ?? '')
    .filter((label) => ['Generate PDF', 'Open PDF in a new tab', 'Download', 'Print'].includes(label));
}

function buttonWithText(root: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((button) => button.textContent?.includes(label));
}

async function settle(fixture: { detectChanges(): void }): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }
}

const translations = {
  COMMON: { EMPTY_VALUE: '—', ACTIONS: { RETRY: 'Try again', CANCEL: 'Cancel' }, TABLE: { ACTIONS: 'Actions' } },
  SALES: {
    CREDIT_NOTES: {
      NUMBER: 'Credit note no. {{number}}', SOURCE_NUMBER: 'Original invoice no. {{number}}',
      DRAFT_TITLE: 'Credit note draft', STATUS: { DRAFT: 'Draft', ISSUED: 'Issued' },
      ACTIONS: { BACK_TO_INVOICE: 'Back', EDIT_REASON: 'Edit reason', ADD_LINE: 'Add line', EDIT_LINE: 'Edit line', REMOVE_LINE: 'Remove line', ISSUE: 'Issue credit note' },
      DETAIL: { EYEBROW: 'Sales · Credit note', TITLE: 'Credit note', SUBTITLE: 'Credit note detail', LOADING: 'Loading', DRAFT_NOTICE: 'Editable draft.', ISSUED_NOTICE: 'This credit note has been issued.' },
      SOURCE: { TITLE: 'Original invoice', DESCRIPTION: 'Commercial source' },
      FIELDS: { SOURCE_INVOICE: 'Original invoice', CURRENCY: 'Currency', CUSTOMER: 'Customer', NO_CUSTOMER: 'No customer', ISSUE_DATE: 'Credit note date', DESCRIPTION: 'Description', QUANTITY: 'Quantity', UNIT_PRICE: 'Unit price', TAX: 'Tax', TOTAL: 'Total', SUBTOTAL: 'Subtotal' },
      REASON: { TITLE: 'Reason', EMPTY: 'No reason' },
      LINES: { TITLE: 'Credited lines', DESCRIPTION: 'Authoritative lines', EMPTY_TITLE: 'No lines', EMPTY_DESCRIPTION: 'No credited lines' },
      TOTALS: { TITLE: 'Credit note totals', AUTHORITATIVE: 'Authoritative totals' },
      DOCUMENT: {
        TITLE: 'PDF document', LOADING: 'Checking the PDF document…', NOT_GENERATED_TITLE: 'PDF document not generated',
        NOT_GENERATED_DESCRIPTION: 'The credit note PDF has not been generated yet.', GENERATING: 'Generating PDF…',
        AVAILABLE: 'PDF available', AVAILABLE_DESCRIPTION: 'Issued credit note PDF', GENERATED_AT: 'Generated at {{generatedAt}}',
        ACTIONS: { GENERATE: 'Generate PDF', RETRY_GENERATION: 'Try generating again', OPEN: 'Open PDF in a new tab', DOWNLOAD: 'Download', PRINT: 'Print' },
        NOTIFICATIONS: { READY: 'The credit note PDF is ready.' },
        ERRORS: { UNAVAILABLE: 'Unavailable', GENERATION_FAILED: 'Generation failed', INTEGRITY: 'Integrity failed', SECURE_LINK_FAILED: 'Secure link failed' }
      },
      REMOVE_LINE: { TITLE: 'Remove?', DESCRIPTION: '{{description}}' },
      ERRORS: { DETAIL_FAILED: 'Detail failed', LINE_REMOVE_FAILED: 'Remove failed', VERSION_CONFLICT: 'Conflict' },
      NOTIFICATIONS: { LINE_REMOVED: 'Removed', ISSUED: 'Issued' },
      ISSUE: { ERRORS: { VERSION_CONFLICT: 'Conflict', SETTLEMENT_CONFLICT: 'Settlement changed', EXCEEDS_BALANCE: 'Exceeds balance', ALREADY_SETTLED: 'Settled', IDEMPOTENCY_REUSED: 'Reused' } }
    }
  }
};
