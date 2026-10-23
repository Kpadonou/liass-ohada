import { Provider } from '@angular/core';
import { provideTransloco, translocoConfig } from '@ngneat/transloco';

import { environment } from '../../../environments/environment';
import { TranslocoHttpLoader } from './transloco-loader';
import type { SupportedLanguage } from './language-preferences';

export const createI18nProviders = (defaultLang: SupportedLanguage): Provider[] => [
  provideTransloco({
    config: translocoConfig({
      availableLangs: ['fr', 'en'],
      defaultLang,
      fallbackLang: 'fr',
      reRenderOnLangChange: true,
      prodMode: environment.production,
    }),
    loader: TranslocoHttpLoader,
  }),
];

export const i18nProviders = createI18nProviders('fr');
