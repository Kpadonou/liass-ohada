import { describe, expect, it, vi } from 'vitest';

import {
  createInvoiceIssueRequestId,
  formatInvoiceDate,
  localCalendarDate
} from './sales-invoice-dates';

describe('sales invoice date and request helpers', () => {
  it('derives the local calendar date without a UTC conversion', () => {
    const nearMidnight = new Date(2026, 8, 8, 23, 59, 59);
    expect(localCalendarDate(nearMidnight)).toBe('2026-09-08');
  });

  it('formats a date-only value without shifting its calendar day', () => {
    expect(formatInvoiceDate('2026-09-08', 'fr')).toBe('08/09/2026');
  });

  it('uses the runtime cryptographic UUID generator', () => {
    const randomUUID = vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
    expect(createInvoiceIssueRequestId()).toBe('00000000-0000-4000-8000-000000000001');
    expect(randomUUID).toHaveBeenCalledOnce();
  });
});
