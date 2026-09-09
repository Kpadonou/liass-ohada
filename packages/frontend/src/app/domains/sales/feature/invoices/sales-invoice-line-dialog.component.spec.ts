import { describe, expect, it } from 'vitest';

import { invoiceLineUnitPatch } from './sales-invoice-line-dialog.component';

describe('invoiceLineUnitPatch', () => {
  it('omits an untouched unit', () => {
    expect(invoiceLineUnitPatch('hour', false)).toEqual({});
  });

  it('uses null to explicitly clear a modified unit', () => {
    expect(invoiceLineUnitPatch('   ', true)).toEqual({ unit: null });
  });

  it('sends a trimmed replacement unit', () => {
    expect(invoiceLineUnitPatch(' day ', true)).toEqual({ unit: 'day' });
  });
});
