import { minorInput, parseMinorInput, restaurantPrice } from './restaurant-money';
describe('Canonical restaurant minor-unit money', () => {
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
