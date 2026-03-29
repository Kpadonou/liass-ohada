import { i18n, getLocale } from "@/locales";

export class I18nResolver {
  private lang: string;

  constructor(acceptLanguage?: string) {
    this.lang = getLocale(acceptLanguage || "en");
  }

  t(key: string): string {
    return i18n.t(key, this.lang);
  }

  getMessage(
    code: string,
    params?: Record<string, any>,
  ): { code: string; message: string } {
    let message = this.t(code);

    if (!params || Object.keys(params).length === 0) {
      return { code, message };
    }

    const interpolate = (text: string): string =>
      text.replace(/\{(\w+)\}/g, (_match, key) => {
        if (!(key in params) || params[key] === undefined || params[key] === null) {
          return `{${key}}`;
        }

        const value = params[key];

        if (typeof value === "number") {
          return value.toLocaleString("fr-FR", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          });
        }

        return String(value);
      });

    message = interpolate(message);

    return {
      code,
      message,
    };
  }
}
