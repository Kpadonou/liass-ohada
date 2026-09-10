import { SalesInvoiceIssueDateSchema } from '@liass-ohada/shared/sales';

export function localCalendarDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Formats a date-only value without allowing a timezone to change its calendar day. */
export function formatInvoiceDate(value: string, locale: string): string {
  const parsed = SalesInvoiceIssueDateSchema.safeParse(value);
  if (!parsed.success) return value;
  const [year, month, day] = parsed.data.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatInvoiceTimestamp(value: string, locale: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(timestamp);
}

export function createInvoiceIssueRequestId(): string {
  return crypto.randomUUID();
}
