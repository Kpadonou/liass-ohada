import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { describe, it, expect, vi } from 'vitest';
import { RestaurantCashCommandDialog } from './restaurant-cash.page';
import type { RestaurantCashSession } from '@liass-ohada/shared/restaurants';
const session = {
  openingCashAmountMinor: 100,
  paidByMethodMinor: { CASH: 200, CARD: 900, MOBILE_MONEY: 800 },
  cashInMinor: 50,
  cashOutMinor: 20,
  expectedCashAmountMinor: 330,
  currency: 'XOF',
} as RestaurantCashSession;
function setup(reason = false, label = 'CLOSE_CASH') {
  const execute = vi.fn(async () => {}),
    close = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      FormBuilder,
      {
        provide: MAT_DIALOG_DATA,
        useValue: {
          label,
          amount: ['OPEN_DAY', 'CLOSE_DAY'].includes(label)
            ? undefined
            : label === 'OPEN_CASH'
              ? 'FLOAT'
              : 'COUNTED',
          session,
          reason,
          currency: 'XOF',
          context: 'Outlet',
          execute,
        },
      },
      { provide: MatDialogRef, useValue: { close, disableClose: false } },
    ],
  });
  const dialog = TestBed.runInInjectionContext(() => new RestaurantCashCommandDialog());
  return { dialog, execute, close };
}
describe('Cash reconciliation confirmation', () => {
  it('requires an explicit counted amount', () => {
    const { dialog } = setup();
    expect(dialog.form.invalid).toBe(true);
    dialog.form.controls.amount.setValue(0);
    expect(dialog.form.valid).toBe(true);
  });
  it.each([
    [330, '0'],
    [350, '+20'],
    [300, '-30'],
  ])('previews counted %s without changing canonical values', (counted, preview) => {
    const { dialog } = setup();
    dialog.form.controls.amount.setValue(counted);
    expect(dialog.preview()).toBe(preview);
    expect(session.expectedCashAmountMinor).toBe(330);
  });
  it('shows only physical cash in the drawer equation', () => {
    const { dialog } = setup();
    expect(dialog.drawer(session).map((x) => x.key)).toEqual([
      'FLOAT',
      'CASH',
      'CASH_IN',
      'CASH_OUT',
      'EXPECTED',
    ]);
  });
  it('waits for confirmation before closing', async () => {
    const { dialog, execute, close } = setup();
    let resolve!: () => void;
    execute.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
    dialog.form.controls.amount.setValue(330);
    const task = dialog.submit();
    expect(dialog.busy()).toBe(true);
    expect(close).not.toHaveBeenCalled();
    resolve();
    await task;
    expect(close).toHaveBeenCalledWith(true);
  });
  it('preserves counted input on failure', async () => {
    const { dialog, execute, close } = setup();
    execute.mockRejectedValue(new Error('Rejected'));
    dialog.form.controls.amount.setValue(350);
    await dialog.submit();
    expect(close).not.toHaveBeenCalled();
    expect(dialog.error()).toBe(true);
    expect(dialog.form.controls.amount.value).toBe(350);
  });
  it('requires a nonblank movement reason and positive amount', () => {
    const { dialog } = setup(true);
    dialog.form.controls.amount.setValue(1);
    dialog.form.controls.reason.setValue(' ');
    expect(dialog.form.invalid).toBe(true);
    dialog.form.controls.reason.setValue('Float');
    expect(dialog.form.valid).toBe(true);
    dialog.form.controls.amount.setValue(0);
    expect(dialog.form.invalid).toBe(true);
  });
  it.each(['OPEN_DAY', 'OPEN_CASH', 'CASH_IN', 'CLOSE_CASH', 'CLOSE_DAY'])(
    '%s waits for canonical confirmation',
    async (label) => {
      const { dialog, execute, close } = setup(false, label);
      let resolve!: () => void;
      execute.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
      if (dialog.data.amount) dialog.form.controls.amount.setValue(100);
      const pending = dialog.submit();
      expect(dialog.busy()).toBe(true);
      expect(close).not.toHaveBeenCalled();
      resolve();
      await pending;
      expect(close).toHaveBeenCalledWith(true);
    },
  );
  it('opening float requires an explicit nonnegative integer', () => {
    const { dialog } = setup(false, 'OPEN_CASH');
    expect(dialog.form.invalid).toBe(true);
    for (const invalid of [-1, 1.5]) {
      dialog.form.controls.amount.setValue(invalid);
      expect(dialog.form.invalid).toBe(true);
    }
    dialog.form.controls.amount.setValue(0);
    expect(dialog.form.valid).toBe(true);
  });
});
