import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { StockUnit } from '@liass-ohada/shared/restaurants';

export const discreteStockUnit = (unit: StockUnit) =>
  ['UNIT', 'BOTTLE', 'CAN', 'PACK'].includes(unit);
/** Exact display from the integer representation; no division in floating point. */
export function stockQuantity(milli: number, signed = false): string {
  const value = BigInt(milli);
  const magnitude = value < 0n ? -value : value;
  const fraction = (magnitude % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return `${value < 0n ? '−' : signed && value > 0n ? '+' : ''}${magnitude / 1000n}${fraction ? '.' + fraction : ''}`;
}
/** Positive decimal text, with a comma accepted for French keyboards. */
export function positiveStockQuantity(raw: string, unit: StockUnit): string | null {
  const normalized = raw.trim().replace(',', '.');
  if (!/^\d{1,13}(?:\.\d{1,3})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  const milli = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (
    milli <= 0n ||
    milli > BigInt(Number.MAX_SAFE_INTEGER) ||
    (discreteStockUnit(unit) && milli % 1000n !== 0n)
  )
    return null;
  return `${BigInt(whole)}${fraction ? '.' + fraction : ''}`;
}
export function stockQuantityValidator(unit: StockUnit): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null =>
    positiveStockQuantity(String(control.value ?? ''), unit) ? null : { stockQuantity: true };
}
