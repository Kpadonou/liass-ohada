import { describe, expect, it } from 'vitest';

import { formatExactMoney } from './exact-money-display';

describe('formatExactMoney', () => {
  it.each([
    ['59000', 'XOF', 'fr', '59 000 XOF'],
    ['59000', 'XAF', 'fr', '59 000 XAF'],
    ['29.99', 'EUR', 'en', '29.99 EUR'],
    ['0', 'USD', 'en', '0 USD'],
    ['123456789012345678', 'XOF', 'en', '123,456,789,012,345,678 XOF'],
    ['0.3000', 'EUR', 'en', '0.3000 EUR']
  ])('formats %s %s without converting the canonical value to Number', (value, currency, locale, expected) => {
    expect(formatExactMoney(value, currency, locale)).toBe(expected);
  });

  it('never introduces an IEEE-754 artifact', () => {
    expect(formatExactMoney('0.3', 'USD', 'en')).toBe('0.3 USD');
    expect(formatExactMoney('0.3', 'USD', 'en')).not.toContain('0.30000000000000004');
  });
});
