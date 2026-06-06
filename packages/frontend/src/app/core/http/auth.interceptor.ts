import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TranslocoService } from '@ngneat/transloco';
import { fetchAuthSession } from 'aws-amplify/auth';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { AuthStore } from '../../domains/identity/data-access/auth.store';
import { environment } from '../../../environments/environment';

const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');
const workspacesDiscoveryUrl = `${apiBaseUrl}/me/workspaces`;
const cabinetDossiersUrl = `${apiBaseUrl}/cabinet/dossiers`;

function tenantOrgIdForRequest(authStore: InstanceType<typeof AuthStore>, url: string): string | null {
  const activeWorkspaceOrgId = authStore.activeWorkspaceOrgId();
  const urlWithoutQuery = url.split('?')[0];

  if (!activeWorkspaceOrgId) {
    return null;
  }

  if (urlWithoutQuery === cabinetDossiersUrl) {
    return activeWorkspaceOrgId;
  }

  if (authStore.activeWorkspaceType() === 'ACCOUNTING_FIRM') {
    return authStore.activeDossierOrgId() || activeWorkspaceOrgId;
  }

  return activeWorkspaceOrgId;
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(apiBaseUrl)) {
    return next(request);
  }

  const authStore = inject(AuthStore);
  const translocoService = inject(TranslocoService);
  const activeLanguage = translocoService.getActiveLang() || 'fr';
  const isWorkspaceDiscoveryRequest =
    request.url === workspacesDiscoveryUrl &&
    (request.method === 'GET' || request.method === 'POST');
  const tenantOrgId = tenantOrgIdForRequest(authStore, request.url);

  if (!isWorkspaceDiscoveryRequest && !tenantOrgId) {
    return throwError(
      () =>
        new HttpErrorResponse({
          status: 401,
          statusText: 'Missing active organization',
          url: request.url,
          error: { message: 'Select a workspace before calling the API.' }
        })
    );
  }

  return from(fetchAuthSession()).pipe(
    switchMap((session) => {
      const token = session.tokens?.accessToken?.toString();

      if (!token) {
        throw new HttpErrorResponse({
          status: 401,
          statusText: 'Missing auth token',
          url: request.url,
          error: { message: 'Sign in before calling the API.' }
        });
      }

      const setHeaders: Record<string, string> = isWorkspaceDiscoveryRequest
        ? {
            Authorization: `Bearer ${token}`,
            'Accept-Language': activeLanguage
          }
        : {
            Authorization: `Bearer ${token}`,
            'Accept-Language': activeLanguage,
            'x-org-id': tenantOrgId as string
          };

      return next(
        request.clone({
          setHeaders
        })
      );
    }),
    catchError((error) =>
      throwError(() =>
        error instanceof HttpErrorResponse
          ? error
          : new HttpErrorResponse({
              status: 401,
              statusText: 'Authentication required',
              url: request.url,
              error
            })
      )
    )
  );
};
