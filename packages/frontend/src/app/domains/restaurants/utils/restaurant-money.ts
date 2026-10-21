import { formatExactMoney } from '../../../shared/utils/exact-money-display';
export function currencyDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}
export function minorInput(amount: number, currency: string): string {
  const digits = currencyDigits(currency),
    value = BigInt(amount)
      .toString()
      .padStart(digits + 1, '0');
  return digits ? `${value.slice(0, -digits)}.${value.slice(-digits)}` : value;
}
/** Formats a valid amount for human entry without using floating-point money arithmetic. */
export function groupedMinorInput(amount: number, currency: string, locale: string): string {
  const value = minorInput(amount, currency);
  const [whole, fraction] = value.split('.');
  const grouped = new Intl.NumberFormat(locale, {
    useGrouping: true,
    maximumFractionDigits: 0,
  })
    .format(BigInt(whole))
    .replaceAll('\u202f', '\u00a0');
  if (fraction === undefined) return grouped;
  const decimal =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')
      ?.value ?? '.';
  return `${grouped}${decimal}${fraction}`;
}
export function parseMinorInput(input: string, currency: string): number {
  const text = input.trim();
  if (!/^(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,]\d+)?$/.test(text))
    throw new Error('Invalid money input');
  const [whole, fraction = ''] = text
    .replace(/[ \u00a0\u202f]/g, '')
    .replace(',', '.')
    .split('.');
  const digits = currencyDigits(currency);
  if (fraction.length > digits) throw new Error('Invalid currency precision');
  const value = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0');
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Unsafe amount');
  return Number(value);
}
export function restaurantPrice(amount: number, currency: string, locale: string) {
  return formatExactMoney(minorInput(amount, currency), currency, locale);
}
/** Omit repetition only when the surface explicitly identifies this currency. */
export function restaurantOperationalPrice(
  amount: number,
  currency: string,
  locale: string,
  contextCurrency?: string | null,
) {
  // Preserve locale grouping and exact minor-unit conversion, using a legible
  // nonbreaking French group separator rather than the very narrow variant.
  const formatted = restaurantPrice(amount, currency, locale).replaceAll('\u202f', '\u00a0');
  return contextCurrency === currency ? formatted.slice(0, -(currency.length + 1)) : formatted;
}
