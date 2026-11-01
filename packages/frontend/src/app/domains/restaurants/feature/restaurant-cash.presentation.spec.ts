import { describe, expect, it } from 'vitest';
import { RestaurantCashPage } from './restaurant-cash.page';
import type { RestaurantCashSession } from '@liass-ohada/shared/restaurants';

describe('Cash presentation', () => {
  const page = Object.create(RestaurantCashPage.prototype) as RestaurantCashPage;
  Object.assign(page, {
    context: () => ({ user: 'private-user-id' }),
    activeDay: () => ({ operationalTimezone: 'Africa/Porto-Novo' }),
    i18n: { getActiveLang: () => 'fr', translate: (key: string) => key.split('.').pop() },
  });
  it('uses a trimmed display name before first-person fallback', () => {
    expect(
      page.identity({
        cashierDisplayName: ' Alice ',
        cashierUserId: 'private-user-id',
      } as RestaurantCashSession),
    ).toBe('Alice');
  });
  it('never exposes internal identity for unnamed cashiers', () => {
    expect(
      page.identity({
        cashierDisplayName: null,
        cashierUserId: 'private-user-id',
      } as RestaurantCashSession),
    ).toBe('YOU');
    expect(
      page.identity({
        cashierDisplayName: ' ',
        cashierUserId: 'other-private-id',
      } as RestaurantCashSession),
    ).toBe('IDENTITY_UNAVAILABLE');
  });
  it('preserves business date independently from the opening timestamp', () => {
    expect(page.businessDate('2026-10-28')).toContain('28 oct. 2026');
    expect(page.timestamp('2026-10-29T14:12:00Z')).toContain('29 oct. 2026');
    expect(page.timestamp('2026-10-29T14:12:00Z')).toContain('15:12');
  });
  it('localizes English dates', () => {
    Object.assign(page, { i18n: { getActiveLang: () => 'en' } });
    expect(page.businessDate('2026-10-28')).toContain('Oct 28, 2026');
  });
});

describe('Cash contextual action targeting', () => {
  it('uses the selected row for CashIn, CashOut, and close', async () => {
    const { vi } = await import('vitest');
    const requests: string[] = [];
    const cash = {
      command: vi.fn(async (_context: unknown, path: string) => {
        requests.push(path);
        return { data: {} };
      }),
      confirmedMovement: vi.fn(async () => {}),
      confirmedSession: vi.fn(async () => {}),
    };
    const selected = { set: vi.fn() };
    const page = Object.create(RestaurantCashPage.prototype) as RestaurantCashPage;
    Object.assign(page, {
      context: () => ({ user: 'manager' }),
      cash,
      selected,
      command: async (
        _label: string,
        execute: (amount: number, reason: string) => Promise<void>,
      ) => {
        await execute(100, 'reason');
      },
    });
    const other = {
      cashSessionId: 'selected-cashier-session',
      cashierUserId: 'other-cashier',
      cashierDisplayName: 'Alice',
      version: 3,
    } as RestaurantCashSession;
    page.move(other, 'CASH_IN');
    page.move(other, 'CASH_OUT');
    page.close(other);
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    expect(requests).toEqual([
      'cash-sessions/selected-cashier-session/movements',
      'cash-sessions/selected-cashier-session/movements',
      'cash-sessions/selected-cashier-session/close',
    ]);
    expect(requests.join(' ')).not.toContain('manager');
  });
  it('does not present counted or variance as authoritative on an open session', () => {
    const page = Object.create(RestaurantCashPage.prototype) as RestaurantCashPage;
    const session = {
      status: 'OPEN',
      openingCashAmountMinor: 100,
      cashInMinor: 20,
      cashOutMinor: 5,
      expectedCashAmountMinor: 115,
      countedCashAmountMinor: 0,
      paidByMethodMinor: { CASH: 0, CARD: 0, MOBILE_MONEY: 0 },
    } as RestaurantCashSession;
    expect(
      page.reconciliation(session).find((entry) => entry.key === 'COUNTED')?.amount,
    ).toBeUndefined();
    expect(page.signed(undefined)).toBe('—');
  });
});

describe('Cash drawer values', () => {
  it('shows closed-session counted cash and signed variance', () => {
    const page = Object.create(RestaurantCashPage.prototype) as RestaurantCashPage;
    const session = {
      status: 'CLOSED',
      openingCashAmountMinor: 100,
      cashInMinor: 20,
      cashOutMinor: 5,
      expectedCashAmountMinor: 115,
      countedCashAmountMinor: 110,
      varianceAmountMinor: -5,
      paidByMethodMinor: { CASH: 0, CARD: 50, MOBILE_MONEY: 40 },
    } as RestaurantCashSession;
    expect(page.reconciliation(session).find((entry) => entry.key === 'EXPECTED')?.amount).toBe(
      115,
    );
    expect(page.reconciliation(session).find((entry) => entry.key === 'COUNTED')?.amount).toBe(110);
    Object.assign(page, { i18n: { getActiveLang: () => 'fr' } });
    expect(page.signed(session.varianceAmountMinor)).toBe('-5');
    expect(page.otherCollections(session)).toEqual([
      { key: 'MOBILE_MONEY', amount: 40 },
      { key: 'CARD', amount: 50 },
    ]);
  });
});

it('formats Cash amounts using the active language without monetary counts', () => {
  const page = Object.create(RestaurantCashPage.prototype) as RestaurantCashPage;
  Object.assign(page, { i18n: { getActiveLang: () => 'fr' } });
  expect(page.formatNumber(1401946)).toMatch(/^1[\u00a0\u202f ]401[\u00a0\u202f ]946$/);
  expect(page.formatNumber(1401946)).not.toContain(',');
  expect(page.formatNumber(471600)).toMatch(/^471[\u00a0\u202f ]600$/);
  expect(page.formatNumber(58000)).toMatch(/^58[\u00a0\u202f ]000$/);
  Object.assign(page, { i18n: { getActiveLang: () => 'en' } });
  expect(page.formatNumber(1401946)).toBe('1,401,946');
  expect(page.formatNumber(471600)).toBe('471,600');
  expect(page.formatNumber(3)).toBe('3');
});

it('formats activity amounts with canonical locale-aware currency output', () => {
  const page = Object.create(RestaurantCashPage.prototype) as RestaurantCashPage;
  Object.assign(page, { i18n: { getActiveLang: () => 'fr' } });
  for (const [amount, grouped] of [
    [471600, '471 600'],
    [6000, '6 000'],
    [50000, '50 000'],
    [200000, '200 000'],
    [1401946, '1 401 946'],
  ] as [number, string][]) {
    const visible = page.formatCashAmount(amount, 'XOF');
    expect(visible.replace(/[\u00a0\u202f]/g, ' ')).toBe(`${grouped} XOF`);
    expect(visible).not.toContain(',');
    expect(visible).not.toBe(`${amount} XOF`);
  }
  Object.assign(page, { i18n: { getActiveLang: () => 'en' } });
  expect(page.formatCashAmount(471600, 'XOF')).toBe('471,600 XOF');
  expect(page.formatCashAmount(1401946, 'XOF')).toBe('1,401,946 XOF');
});
