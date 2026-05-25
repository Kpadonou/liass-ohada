import { Provider } from '@angular/core';
import { provideTransloco, translocoConfig } from '@ngneat/transloco';

import { environment } from '../../../environments/environment';
import { TranslocoHttpLoader } from './transloco-loader';

export const i18nProviders: Provider[] = [
  provideTransloco({
    config: translocoConfig({
      availableLangs: ['fr', 'en'],
      defaultLang: 'fr',
      fallbackLang: 'fr',
      reRenderOnLangChange: true,
      prodMode: environment.production
    }),
    loader: TranslocoHttpLoader
  })
];
