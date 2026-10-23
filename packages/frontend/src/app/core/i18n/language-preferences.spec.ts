import { afterEach, describe, expect, it, vi } from 'vitest';

import { LANGUAGE_STORAGE_KEY, resolveInitialLanguage } from './language-preferences';

describe('resolveInitialLanguage', () => {
  const storage = new Map<string, string>();

  const stubLocalStorage = () =>
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });

  afterEach(() => {
    storage.clear();
    vi.unstubAllGlobals();
  });

  it.each(['en', 'fr'] as const)('restores the persisted %s preference', (language) => {
    stubLocalStorage();
    globalThis.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    vi.stubGlobal('navigator', { language: 'de-DE', languages: ['de-DE'] });

    expect(resolveInitialLanguage()).toBe(language);
  });

  it.each([
    ['en-GB', 'en'],
    ['fr-FR', 'fr'],
    ['de-DE', 'fr'],
  ] as const)(
    'resolves browser locale %s to %s without a persisted preference',
    (browserLanguage, expected) => {
      stubLocalStorage();
      vi.stubGlobal('navigator', {
        language: browserLanguage,
        languages: [browserLanguage],
      });

      expect(resolveInitialLanguage()).toBe(expected);
    },
  );
});
