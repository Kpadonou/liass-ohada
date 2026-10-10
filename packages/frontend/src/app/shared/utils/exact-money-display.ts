const CANONICAL_MONEY = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;

/** Presentation only: groups the integer string and preserves the authoritative fraction verbatim. */
export function formatExactMoney(value: string, currency: string, locale = 'fr'): string {
  const match = CANONICAL_MONEY.exec(value);
  if (!match) return `${value} ${currency}`;

  const [integer, fraction] = value.split('.');
  const grouped = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(BigInt(integer));
  const decimalSeparator =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')
      ?.value ?? '.';

  return `${grouped}${fraction === undefined ? '' : `${decimalSeparator}${fraction}`} ${currency}`;
}
