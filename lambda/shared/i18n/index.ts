import { i18n, getLocale } from "@/locales";

export class I18nResolver {
  private lang: string;

  constructor(acceptLanguage?: string) {
    this.lang = getLocale(acceptLanguage || "en");
  }

  t(key: string): string {
    return i18n.t(key, this.lang);
  }

  getMessage(code: string): { code: string; message: string } {
    return {
      code,
      message: this.t(code),
    };
  }
}
