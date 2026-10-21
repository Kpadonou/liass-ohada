import {
  groupedMinorInput,
  minorInput,
  parseMinorInput,
  restaurantPrice,
  restaurantOperationalPrice,
} from './restaurant-money';
describe('Canonical restaurant minor-unit money', () => {
  it.each([
    [300000, 'XOF', '300\u00a0000'],
    [2100000, 'XOF', '2\u00a0100\u00a0000'],
    [123456, 'EUR', '1\u00a0234,56'],
  ])('groups exact %s %s entry as %s', (amount, currency, expected) => {
    const text = groupedMinorInput(amount, currency, 'fr');
    expect(text).toBe(expected);
    expect(parseMinorInput(text, currency)).toBe(amount);
  });
  it('omits a suffix only in matching declared operational context, preserving exact minor units', () => {
    expect(restaurantOperationalPrice(150000, 'XOF', 'fr', 'XOF')).toMatch(/^150\s000$/);
    expect(restaurantOperationalPrice(1025, 'EUR', 'en', 'EUR')).toBe('10.25');
    expect(restaurantOperationalPrice(1025, 'EUR', 'en', 'XOF')).toBe('10.25 EUR');
    expect(restaurantOperationalPrice(150000, 'XOF', 'en')).toBe('150,000 XOF');
    expect(restaurantPrice(150000, 'XOF', 'en')).toBe('150,000 XOF');
  });
  it.each([
    ['5 000', 'XOF', 5000],
    ['5\u202f000', 'XOF', 5000],
    ['10,25', 'EUR', 1025],
    ['10.250', 'BHD', 10250],
    ['0', 'XOF', 0],
  ])('converts %s in %s exactly', (text, currency, result) =>
    expect(parseMinorInput(text, currency)).toBe(result),
  );
  it.each(['-1', '1.5', '1e4', 'NaN', '9007199254740992', '1 2', ''])(
    'rejects unsafe/invalid XOF entry %s',
    (text) => expect(() => parseMinorInput(text, 'XOF')).toThrow(),
  );
  it('preserves precision and reuses existing money formatter', () => {
    expect(minorInput(1025, 'EUR')).toBe('10.25');
    expect(restaurantPrice(5000, 'XOF', 'en')).toBe('5,000 XOF');
    expect(parseMinorInput('9007199254740991', 'XOF')).toBe(Number.MAX_SAFE_INTEGER);
  });
});
it.each([150000, 300000, 1050000])(
  'renders %s with legible French locale grouping in operational context',
  (amount) => {
    const display = restaurantOperationalPrice(amount, 'XOF', 'fr', 'XOF');
    expect(display).toBe(
      new Intl.NumberFormat('fr', { maximumFractionDigits: 0, useGrouping: true })
        .format(amount)
        .replaceAll('\u202f', '\u00a0'),
    );
    expect(display).toContain('\u00a0');
    expect(display).not.toContain('XOF');
    expect(restaurantPrice(amount, 'XOF', 'fr')).toContain('XOF');
  },
);
