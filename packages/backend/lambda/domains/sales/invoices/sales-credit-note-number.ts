const MINIMUM_WIDTH = 8;

export const nextSalesCreditNoteSequence = (current: string): string =>
  (BigInt(current) + 1n).toString();

export const formatSalesCreditNoteNumber = (value: string): string =>
  value.padStart(MINIMUM_WIDTH, "0");
