import { HttpErrorResponse } from '@angular/common/http';

export function createSalesPaymentRequestId(): string {
  return crypto.randomUUID();
}

export function hasPositiveExactAmount(value: string): boolean {
  return /[1-9]/.test(value.replace('.', ''));
}

export function isAmbiguousSalesPaymentFailure(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500);
}
