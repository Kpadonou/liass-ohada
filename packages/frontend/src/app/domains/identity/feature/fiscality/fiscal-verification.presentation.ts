/** Verification timestamps are operational instants displayed in the Beninese jurisdiction timezone. */
export function fiscalVerificationDate(value: string | undefined, language: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'fr-BJ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Porto-Novo',
  }).format(new Date(value));
}
