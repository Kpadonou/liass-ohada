export type SupportedLanguage = 'fr' | 'en';

export const LANGUAGE_STORAGE_KEY = 'liass-ohada.language';

const supportedLanguages: readonly SupportedLanguage[] = ['fr', 'en'];

export function isSupportedLanguage(
  language: string | null | undefined,
): language is SupportedLanguage {
  return supportedLanguages.includes(language as SupportedLanguage);
}

export function readSavedLanguage(): SupportedLanguage | null {
  try {
    const savedLanguage = globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY);
    return isSupportedLanguage(savedLanguage) ? savedLanguage : null;
  } catch {
    return null;
  }
}

export function saveLanguagePreference(language: SupportedLanguage): void {
  try {
    globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    return;
  }
}

export function resolveInitialLanguage(): SupportedLanguage {
  const savedLanguage = readSavedLanguage();

  if (savedLanguage) {
    return savedLanguage;
  }

  const browserLanguage =
    globalThis.navigator?.languages?.[0] ?? globalThis.navigator?.language ?? '';
  const normalizedLanguage = browserLanguage.toLowerCase().split('-')[0];

  return isSupportedLanguage(normalizedLanguage) ? normalizedLanguage : 'fr';
}
