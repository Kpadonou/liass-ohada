import { HttpErrorResponse } from '@angular/common/http';
/** Only known domain codes influence copy; raw persistence/transport text is never rendered. */
export function correctionError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return 'RESTAURANTS_CORRECTIONS.RETRY';
  const code = error.error?.error?.code ?? error.error?.code ?? error.error?.message?.code;
  if (error.status === 403 || /_(ROLE)$/.test(code ?? '')) return 'RESTAURANTS_CORRECTIONS.DENIED';
  if (/_(SESSION_REQUIRED|DAY_REQUIRED|CONTEXT)$/.test(code ?? ''))
    return 'RESTAURANTS_CORRECTIONS.SESSION_REQUIRED';
  if (/_(IDEMPOTENCY|CONFLICT|EXCEEDED|QUANTITY_EXCEEDED|VALUE_EXCEEDED|CEILING)$/.test(code ?? ''))
    return 'RESTAURANTS_CORRECTIONS.AVAILABILITY_CHANGED';
  if (/RESTAURANTS_CREDIT_(SOURCE|NOT_FINAL|LINE|INELIGIBLE|CURRENCY)/.test(code ?? ''))
    return 'RESTAURANTS_CORRECTIONS.SOURCE_UNAVAILABLE';
  return 'RESTAURANTS_CORRECTIONS.RETRY';
}
