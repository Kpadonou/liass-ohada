import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import type { SalesDraftInvoice, SalesInvoice } from '@liass-ohada/shared/sales';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { vi } from 'vitest';

import { SalesInvoicesApi } from '../../data-access/sales-invoices.api';
import { SalesInvoiceIssueDialogComponent } from './sales-invoice-issue-dialog.component';

describe('SalesInvoiceIssueDialogComponent', () => {
  const issue = vi.fn();
  const get = vi.fn(async (): Promise<SalesInvoice> => draft());
  const close = vi.fn();
  const requestId = '00000000-0000-4000-8000-000000000001';

  beforeEach(async () => {
    vi.clearAllMocks();
    get.mockResolvedValue(draft());
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId);
    await TestBed.configureTestingModule({
      imports: [
        SalesInvoiceIssueDialogComponent,
        TranslocoTestingModule.forRoot({
          langs: { en: translations },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }
        })
      ],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: draft() },
        { provide: MatDialogRef, useValue: { close } },
        { provide: SalesInvoicesApi, useValue: { issueInvoice: issue, get } }
      ]
    }).compileComponents();
  });

  it('reviews authoritative customer, currency and exact totals with editable local date', () => {
    const fixture = TestBed.createComponent(SalesInvoiceIssueDialogComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('ABC SARL');
    expect(text).toContain('EUR');
    expect(text).toContain('35.39 EUR');
    expect(text).toContain('can no longer be changed');
    expect(fixture.nativeElement.querySelector('input[type="date"]')).not.toBeNull();
    expect(text).not.toMatch(/000000\d{2}/);
    expect(text).not.toMatch(/certif|fiscal|DGI|e-MECeF/i);
  });

  it('submits the current version and server-owned-safe payload, then returns issued data', async () => {
    issue.mockResolvedValue({ data: issued(), message: 'Issued by server' });
    const fixture = TestBed.createComponent(SalesInvoiceIssueDialogComponent);
    fixture.detectChanges();
    const date = fixture.nativeElement.querySelector('input[type="date"]') as HTMLInputElement;
    date.value = '2026-09-08';
    date.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    issueButton(fixture.nativeElement).click();
    await settle(fixture);
    expect(issue).toHaveBeenCalledWith('INV-1', {
      expectedVersion: 7,
      clientRequestId: requestId,
      issueDate: '2026-09-08'
    });
    expect(close).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'issued',
      invoice: expect.objectContaining({ invoiceNumber: '00000042' })
    }));
  });

  it('prevents duplicate pending submits', async () => {
    let resolve!: (value: { data: SalesInvoice; message: null }) => void;
    issue.mockReturnValue(new Promise((done) => { resolve = done; }));
    const fixture = TestBed.createComponent(SalesInvoiceIssueDialogComponent);
    fixture.detectChanges();
    const button = issueButton(fixture.nativeElement);
    button.click();
    button.click();
    expect(issue).toHaveBeenCalledOnce();
    resolve({ data: issued(), message: null });
    await settle(fixture);
  });

  it('reuses the same request ID when an ambiguous network result is retried', async () => {
    issue
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') }))
      .mockResolvedValueOnce({ data: issued(), message: null });
    const fixture = TestBed.createComponent(SalesInvoiceIssueDialogComponent);
    fixture.detectChanges();
    issueButton(fixture.nativeElement).click();
    await settle(fixture);
    expect(fixture.nativeElement.textContent).toContain('same issuance request');
    issueButton(fixture.nativeElement).click();
    await settle(fixture);
    expect(issue.mock.calls[0][1].clientRequestId).toBe(requestId);
    expect(issue.mock.calls[1][1].clientRequestId).toBe(requestId);
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it('treats an authoritative ISSUED refetch after an ambiguous response as success', async () => {
    issue.mockRejectedValue(new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') }));
    get.mockResolvedValue(issued());
    const fixture = TestBed.createComponent(SalesInvoiceIssueDialogComponent);
    fixture.detectChanges();
    issueButton(fixture.nativeElement).click();
    await settle(fixture);
    expect(get).toHaveBeenCalledWith('INV-1');
    expect(close).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'issued',
      invoice: expect.objectContaining({ invoiceNumber: '00000042' })
    }));
  });

  it.each([
    ['SALES_INVOICE_VERSION_CONFLICT', 'version-conflict'],
    ['SALES_INVOICE_ALREADY_ISSUED', 'already-issued'],
    ['SALES_INVOICE_IDEMPOTENCY_KEY_REUSED', 'idempotency-reused'],
    ['SALES_INVOICE_HAS_NO_LINES', 'no-lines']
  ])('returns a refresh outcome for %s without silently retrying', async (code, reason) => {
    issue.mockRejectedValue(new HttpErrorResponse({ status: 409, error: { message: { code, message: 'Safe' } } }));
    const fixture = TestBed.createComponent(SalesInvoiceIssueDialogComponent);
    fixture.detectChanges();
    issueButton(fixture.nativeElement).click();
    await settle(fixture);
    expect(issue).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith({ kind: 'refresh', reason });
  });
});

function issueButton(root: HTMLElement): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find((candidate) =>
    /Issue invoice|Try again/.test(candidate.textContent ?? '')
  );
  if (!button) throw new Error('Issue button not found');
  return button;
}

function draft(): SalesDraftInvoice {
  return {
    id: 'INV-1', status: 'DRAFT', currency: 'EUR', customerId: 'C-1',
    customerSnapshot: { name: 'ABC SARL' },
    lines: [line()], lineCount: 1, subtotal: '29.99', taxTotal: '5.40', total: '35.39', version: 7,
    createdAt: '2026-09-08T08:00:00.000Z', updatedAt: '2026-09-08T09:00:00.000Z'
  };
}

function issued(): SalesInvoice {
  return {
    ...draft(), status: 'ISSUED', invoiceNumber: '00000042', issueDate: '2026-09-08',
    issuedAt: '2026-09-08T10:00:00.000Z', version: 8
  };
}

function line() {
  return {
    id: 'L-1', position: 1, catalogItemId: 'ITEM-1', description: 'Advisory', unit: 'hour',
    quantity: '1.5', unitPrice: '19.99', taxRate: '18', subtotal: '29.99', taxAmount: '5.40', total: '35.39',
    createdAt: '2026-09-08T08:00:00.000Z', updatedAt: '2026-09-08T08:00:00.000Z'
  };
}

async function settle(fixture: { detectChanges(): void }): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

const translations = {
  SALES: { INVOICES: {
    ACTIONS: { ISSUE: 'Issue invoice' },
    FIELDS: { CUSTOMER: 'Customer', NO_CUSTOMER: 'No customer', CURRENCY: 'Currency', LINES: 'Lines', SUBTOTAL: 'Subtotal', TAX: 'Tax', TOTAL: 'Total', ISSUE_DATE: 'Invoice date' },
    ISSUE: {
      TITLE: 'Issue this invoice?', REVIEW_INTRO: 'Review the information below.',
      IRREVERSIBLE_TITLE: 'Irreversible', IRREVERSIBLE_DESCRIPTION: 'Commercial information can no longer be changed.',
      DATE_HINT: 'Past or future', BACK_TO_EDIT: 'Return to editing', RETRY: 'Try again',
      RETRY_SAME_ATTEMPT: 'Try again to complete this same issuance request.',
      ERRORS: { INVALID_DATE: 'Invalid date', AMBIGUOUS: 'Unknown result', FAILED: 'Failed' }
    }
  } }
};
