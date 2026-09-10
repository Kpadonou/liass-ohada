import { HttpErrorResponse } from '@angular/common/http';
import { vi } from 'vitest';

import {
  createSalesPaymentRequestId,
  hasPositiveExactAmount,
  isAmbiguousSalesPaymentFailure
} from './sales-payment-attempt';

describe('sales payment attempt helpers', () => {
  it('uses crypto.randomUUID and never Math.random for request identity', () => {
    const random = vi.spyOn(Math, 'random');
    const id = createSalesPaymentRequestId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('checks positive canonical amounts without converting them to Number', () => {
    expect(hasPositiveExactAmount('0')).toBe(false);
    expect(hasPositiveExactAmount('0.00')).toBe(false);
    expect(hasPositiveExactAmount('0.0001')).toBe(true);
    expect(hasPositiveExactAmount('900719925474099312345')).toBe(true);
  });

  it('limits ambiguous retries to network and server failures', () => {
    expect(isAmbiguousSalesPaymentFailure(new HttpErrorResponse({ status: 0 }))).toBe(true);
    expect(isAmbiguousSalesPaymentFailure(new HttpErrorResponse({ status: 503 }))).toBe(true);
    expect(isAmbiguousSalesPaymentFailure(new HttpErrorResponse({ status: 409 }))).toBe(false);
  });
});
