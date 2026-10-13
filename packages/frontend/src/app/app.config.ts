import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  importProvidersFrom,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { withDevtools } from '@tanstack/angular-query-experimental/devtools';

import { authInterceptor } from './core/http/auth.interceptor';
import { i18nProviders } from './core/i18n/i18n.providers';
import { routes } from './core/routing/app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline' } },
    provideRouter(routes),
    ...i18nProviders,
    importProvidersFrom(MatSnackBarModule),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideTanStackQuery(new QueryClient(), withDevtools()),
  ],
};
