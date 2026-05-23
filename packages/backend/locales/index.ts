import * as en from "./en.json";
import * as fr from "./fr.json";

const locales = {
  en,
  fr,
};

export type Locale = keyof typeof locales;

export const getLocale = (lang: string): Locale => {
  if (lang.startsWith("fr")) return "fr";
  return "en"; // default
};

export const i18n = {
  t: (key: string, lang: string = "en"): string => {
    const locale = getLocale(lang);
    return (locales[locale] as any)[key] || key; // fallback to key if not found
  },
};
