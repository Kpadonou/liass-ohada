const unsignedDecimalPattern = /^(?:0|[1-9]\d*)$/;

export const parseSalesInvoiceSequence = (value: string): bigint => {
  if (!unsignedDecimalPattern.test(value)) {
    throw new Error("Invalid SALES Invoice sequence value");
  }
  return BigInt(value);
};

export const nextSalesInvoiceSequence = (lastValue: string): string =>
  (parseSalesInvoiceSequence(lastValue) + 1n).toString();

/** SALES commercial numbering only; this is not a fiscal certification number. */
export const formatSalesInvoiceNumber = (sequenceValue: string): string => {
  const value = parseSalesInvoiceSequence(sequenceValue);
  if (value < 1n) throw new Error("SALES Invoice sequence must be positive");
  return value.toString().padStart(8, "0");
};
