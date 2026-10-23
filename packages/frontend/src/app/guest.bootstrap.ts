import { Component, provideBrowserGlobalErrorListeners } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { RouterOutlet, provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { i18nProviders } from './core/i18n/i18n.providers';
import { guestRoutes } from './core/routing/guest.routes';
import { guestInterceptor } from './core/http/guest.interceptor';
@Component({ selector: 'liass-root', imports: [RouterOutlet], template: '<router-outlet />' })
class GuestRoot {}
/** Same application and origin, minimal providers for direct permanent-QR entry. */
export const bootstrapGuest = () =>
  bootstrapApplication(GuestRoot, {
    providers: [
      provideBrowserGlobalErrorListeners(),
      provideRouter(guestRoutes),
      ...i18nProviders,
      provideHttpClient(withInterceptors([guestInterceptor])),
      provideTanStackQuery(new QueryClient()),
    ],
  });
