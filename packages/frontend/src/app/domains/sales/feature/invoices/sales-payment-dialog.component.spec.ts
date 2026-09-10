import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import type { RecordSalesPaymentRequest, SalesInvoiceReceivable } from '@liass-ohada/shared/sales';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { SalesPaymentsApi } from '../../data-access/sales-payments.api';
import { SalesPaymentsQueries } from '../../data-access/sales-payments.queries';
import { localCalendarDate } from '../../utils/sales-invoice-dates';
import { SalesPaymentDialogComponent } from './sales-payment-dialog.component';

describe('SalesPaymentDialogComponent', () => {
  const close = vi.fn();
  const recordPayment = vi.fn();
  const getReceivable = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queries = {
    receivableKey: (id: string) => ['sales', 'org-sales', 'invoices', id, 'receivable'],
    paymentsRootKey: (id: string) => ['sales', 'org-sales', 'invoices', id, 'payments']
  };

  beforeEach(async () => {
    close.mockReset();
    recordPayment.mockReset();
    getReceivable.mockReset();
    recordPayment.mockResolvedValue(successResult());
    getReceivable.mockResolvedValue(receivable());
    queryClient.clear();
    await TestBed.configureTestingModule({
      imports: [
        SalesPaymentDialogComponent,
        TranslocoTestingModule.forRoot({
          langs: { en: translations }, preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }
        })
      ],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { invoiceId: 'INV-1', invoiceNumber: '00000042', receivable: receivable() } },
        { provide: MatDialogRef, useValue: { close } },
        { provide: SalesPaymentsApi, useValue: { recordPayment, getReceivable } },
        { provide: SalesPaymentsQueries, useValue: queries },
        provideTanStackQuery(queryClient)
      ]
    }).compileComponents();
  });

  it('shows fixed invoice/currency/balance context and a local date with no currency selector', () => {
    const fixture = TestBed.createComponent(SalesPaymentDialogComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as DialogHarness;
    expect(fixture.nativeElement.textContent).toContain('00000042');
    expect(fixture.nativeElement.textContent).toContain('35.39 EUR');
    expect(component.form.getRawValue().paymentDate).toBe(localCalendarDate());
    expect(Object.keys(component.form.controls)).toEqual(['amount', 'paymentDate', 'method', 'reference']);
    expect(component.methods).toEqual(['CASH', 'BANK_TRANSFER', 'CARD', 'MOBILE_MONEY', 'CHEQUE', 'OTHER']);
  });

  it('submits string money with Receivable version zero and no tenant, currency, actor, or Invoice version', async () => {
    const fixture = TestBed.createComponent(SalesPaymentDialogComponent);
    const component = fixture.componentInstance as unknown as DialogHarness;
    component.form.patchValue({ amount: '10.50', paymentDate: '2026-09-10', method: 'BANK_TRANSFER', reference: 'BANK-42' });
    await component.submit();
    const payload = recordPayment.mock.calls[0][1] as RecordSalesPaymentRequest;
    expect(recordPayment).toHaveBeenCalledWith('INV-1', expect.objectContaining({
      expectedVersion: 0, amount: '10.50', paymentDate: '2026-09-10', method: 'BANK_TRANSFER', reference: 'BANK-42'
    }));
    expect(payload.clientRequestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(payload).not.toHaveProperty('orgId');
    expect(payload).not.toHaveProperty('currency');
    expect(payload).not.toHaveProperty('recordedByUserId');
    expect(payload.expectedVersion).not.toBe(3);
    expect(close).toHaveBeenCalledWith(successResult());
  });

  it('prevents duplicate submit and reuses the exact frozen request after an ambiguous failure', async () => {
    let rejectFirst!: (reason: unknown) => void;
    recordPayment.mockReturnValueOnce(new Promise((_, reject) => { rejectFirst = reject; }));
    const fixture = TestBed.createComponent(SalesPaymentDialogComponent);
    const component = fixture.componentInstance as unknown as DialogHarness;
    component.form.patchValue({ amount: '10.50', paymentDate: '2026-09-10', method: 'CASH' });
    const first = component.submit();
    void component.submit();
    expect(recordPayment).toHaveBeenCalledTimes(1);
    rejectFirst(new HttpErrorResponse({ status: 0 }));
    await first;
    expect(component.ambiguous()).toBe(true);
    const frozen = structuredClone(recordPayment.mock.calls[0][1]);

    recordPayment.mockResolvedValueOnce(successResult());
    await component.submit();
    expect(recordPayment).toHaveBeenCalledTimes(2);
    expect(recordPayment.mock.calls[1][1]).toEqual(frozen);
  });

  it('refreshes after a version conflict and creates a new reviewed attempt from the new Receivable version', async () => {
    recordPayment.mockRejectedValueOnce(domainError('SALES_RECEIVABLE_VERSION_CONFLICT', 'Changed'));
    getReceivable.mockResolvedValueOnce(receivable({
      amountPaid: '5', balanceDue: '30.39', status: 'PARTIALLY_PAID', paymentCount: 1, version: 1
    }));
    const fixture = TestBed.createComponent(SalesPaymentDialogComponent);
    const component = fixture.componentInstance as unknown as DialogHarness;
    component.form.patchValue({ amount: '10', paymentDate: '2026-09-10', method: 'CASH' });
    await component.submit();
    const firstId = (recordPayment.mock.calls[0][1] as RecordSalesPaymentRequest).clientRequestId;
    expect(getReceivable).toHaveBeenCalledWith('INV-1');
    expect(component.form.enabled).toBe(true);
    expect(component.receivable().version).toBe(1);

    recordPayment.mockResolvedValueOnce(successResult());
    await component.submit();
    const second = recordPayment.mock.calls[1][1] as RecordSalesPaymentRequest;
    expect(second.expectedVersion).toBe(1);
    expect(second.clientRequestId).not.toBe(firstId);
  });

  it('does not silently resubmit overpayment, precision, settled, or idempotency failures', async () => {
    for (const code of [
      'SALES_PAYMENT_EXCEEDS_BALANCE',
      'SALES_PAYMENT_PRECISION_INVALID',
      'SALES_INVOICE_ALREADY_SETTLED',
      'SALES_PAYMENT_IDEMPOTENCY_KEY_REUSED'
    ]) {
      recordPayment.mockRejectedValueOnce(domainError(code, 'Safe payment message'));
      const fixture = TestBed.createComponent(SalesPaymentDialogComponent);
      const component = fixture.componentInstance as unknown as DialogHarness;
      component.form.patchValue({ amount: '10', paymentDate: '2026-09-10', method: 'CASH' });
      await component.submit();
      expect(component.errorMessage()).toBe('Safe payment message');
    }
    expect(recordPayment).toHaveBeenCalledTimes(4);
  });
});

interface DialogHarness {
  ambiguous(): boolean;
  errorMessage(): string | null;
  methods: readonly string[];
  receivable(): SalesInvoiceReceivable;
  form: {
    controls: Record<string, unknown>;
    enabled: boolean;
    getRawValue(): { paymentDate: string };
    patchValue(value: { amount?: string; paymentDate?: string; method?: string; reference?: string }): void;
  };
  submit(): Promise<void>;
}

function receivable(overrides: Partial<SalesInvoiceReceivable> = {}): SalesInvoiceReceivable {
  return {
    invoiceId: 'INV-1', currency: 'EUR', invoiceAmount: '35.39', amountPaid: '0',
    balanceDue: '35.39', status: 'UNPAID', paymentCount: 0, version: 0,
    updatedAt: '2026-09-10T10:00:00.000Z', ...overrides
  };
}

function successResult() {
  const current = receivable({ amountPaid: '10.50', balanceDue: '24.89', status: 'PARTIALLY_PAID', paymentCount: 1, version: 1 });
  return { data: { payment: { id: 'PAY-1', invoiceId: 'INV-1', amount: '10.50', currency: 'EUR', paymentDate: '2026-09-10', method: 'CASH' as const, createdAt: '2026-09-10T10:00:00.000Z' }, receivable: current }, message: 'Recorded' };
}

function domainError(code: string, message: string): HttpErrorResponse {
  return new HttpErrorResponse({ status: 409, error: { message: { code, message } } });
}

const translations = {
  COMMON: { ACTIONS: { CANCEL: 'Cancel', CLOSE: 'Close', RETRY: 'Retry' } },
  SALES: { INVOICES: { FIELDS: { CURRENCY: 'Currency' }, SETTLEMENT: {
    TITLE: 'Settlement', BALANCE_DUE: 'Balance due', ACTIONS: { RECORD: 'Record payment', PAY_REMAINING: 'Pay remaining', REVIEW: 'Review details' },
    DIALOG: { TITLE: 'Record payment', SUBTITLE: 'Review', INVOICE: 'Invoice' },
    FORM: { AMOUNT: 'Amount', PAYMENT_DATE: 'Payment date', METHOD: 'Payment method', REFERENCE: 'Reference', REFERENCE_HINT: 'Optional reference' },
    VALIDATION: { AMOUNT: 'Invalid amount', DATE: 'Invalid date', METHOD: 'Required method', REFERENCE: 'Too long' },
    METHODS: { CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', CARD: 'Card', MOBILE_MONEY: 'Mobile Money', CHEQUE: 'Cheque', OTHER: 'Other' },
    ERRORS: { ALREADY_SETTLED: 'Already settled', AMBIGUOUS: 'Ambiguous result', RETRY_SAME_ATTEMPT: 'Retry same request', RECORD_FAILED: 'Failed', VERSION_CONFLICT: 'Changed', EXCEEDS_BALANCE: 'Too much', PRECISION: 'Precision', IDEMPOTENCY_REUSED: 'Reused' }
  } } }
};
