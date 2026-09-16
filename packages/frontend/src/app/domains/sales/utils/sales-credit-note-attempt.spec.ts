import { HttpErrorResponse } from '@angular/common/http';
import { vi } from 'vitest';

import { createSalesCreditNoteRequestId, freezeSalesCreditNoteIssue, isAmbiguousSalesCreditNoteFailure } from './sales-credit-note-attempt';

describe('sales credit note attempt helpers', () => {
  it('uses crypto.randomUUID for issuance identity', () => {
    const random = vi.spyOn(Math, 'random');
    expect(createSalesCreditNoteRequestId()).toMatch(/^[0-9a-f-]{36}$/i);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('freezes both versions, local issue date and one stable request id', () => {
    const request = freezeSalesCreditNoteIssue({
      expectedCreditNoteVersion: 4,
      expectedReceivableVersion: 2,
      issueDate: '2026-09-11'
    });
    expect(request).toMatchObject({ expectedCreditNoteVersion: 4, expectedReceivableVersion: 2, issueDate: '2026-09-11' });
    expect(request.clientRequestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(Object.isFrozen(request)).toBe(true);
  });

  it('treats only network and server failures as ambiguous', () => {
    expect(isAmbiguousSalesCreditNoteFailure(new HttpErrorResponse({ status: 0 }))).toBe(true);
    expect(isAmbiguousSalesCreditNoteFailure(new HttpErrorResponse({ status: 503 }))).toBe(true);
    expect(isAmbiguousSalesCreditNoteFailure(new HttpErrorResponse({ status: 409 }))).toBe(false);
  });
});
