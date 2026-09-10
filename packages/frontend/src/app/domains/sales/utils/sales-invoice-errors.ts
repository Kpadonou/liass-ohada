import { HttpErrorResponse } from '@angular/common/http';

export function salesInvoiceErrorCode(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  const body = error.error;
  if (!isRecord(body)) return null;
  const message = body['message'];
  if (isRecord(message) && typeof message['code'] === 'string') return message['code'];
  if (typeof body['code'] === 'string') return body['code'];
  return null;
}

export function isSalesInvoiceVersionConflict(error: unknown): boolean {
  return salesInvoiceErrorCode(error) === 'SALES_INVOICE_VERSION_CONFLICT';
}

export function isAmbiguousSalesInvoiceIssueFailure(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
