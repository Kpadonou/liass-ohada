import { FormControl } from '@angular/forms';
import { StockUnitSchema, ManualStockMovementRequestSchema } from '@liass-ohada/shared/restaurants';
import { positiveStockQuantity, stockQuantity, stockQuantityValidator } from './inventory-quantity';
import fr from '../../../../../public/assets/i18n/fr.json';
import en from '../../../../../public/assets/i18n/en.json';
describe('Inventory quantities and bilingual contracts', () => {
  it.each([
    [12000, '12'],
    [1251, '1.251'],
    [-2500, '−2.5'],
    [0, '0'],
    [1, '0.001'],
    [Number.MAX_SAFE_INTEGER, '9007199254740.991'],
  ])('formats %s exactly', (input, expected) =>
    expect(stockQuantity(Number(input))).toBe(expected),
  );
  it('formats movement directions without floating point', () => {
    expect(stockQuantity(1500, true)).toBe('+1.5');
    expect(stockQuantity(-500, true)).toBe('−0.5');
  });
  it.each(['UNIT', 'BOTTLE', 'CAN', 'PACK'] as const)('enforces whole %s quantities', (unit) => {
    expect(positiveStockQuantity('1.5', unit)).toBeNull();
    expect(positiveStockQuantity('12.000', unit)).toBe('12.000');
    expect(new FormControl('1.5', stockQuantityValidator(unit)).invalid).toBe(true);
  });
  it.each(['KG', 'G', 'L', 'ML'] as const)(
    'accepts milli precision for %s without conversion',
    (unit) => {
      expect(positiveStockQuantity('1,251', unit)).toBe('1.251');
    },
  );
  it.each(['0', '-1', '+1', '1.0001', '1e3', 'Infinity', '9007199254741.000'])(
    'rejects %s',
    (value) => expect(positiveStockQuantity(value, 'KG')).toBeNull(),
  );
  it('provides all unit, system movement and error labels in both languages', () => {
    const flatten = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([key, v]) => flatten(v, prefix + '.' + key))
        : [prefix];
    expect(flatten(fr.RESTAURANTS_INVENTORY).sort()).toEqual(
      flatten(en.RESTAURANTS_INVENTORY).sort(),
    );
    for (const lang of [fr, en]) {
      for (const unit of StockUnitSchema.options)
        expect(lang.RESTAURANTS_INVENTORY.UNITS[unit]).toBeTruthy();
      for (const type of ['SALE', 'SALE_REVERSAL'] as const)
        expect(lang.RESTAURANTS_INVENTORY.MOVEMENTS[type]).toBeTruthy();
    }
    expect(
      ManualStockMovementRequestSchema.safeParse({
        type: 'SALE',
        quantity: '1',
        clientRequestId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
  });
});
