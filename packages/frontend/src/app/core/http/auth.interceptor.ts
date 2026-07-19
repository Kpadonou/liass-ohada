import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TranslocoService } from '@ngneat/transloco';
import { fetchAuthSession } from 'aws-amplify/auth';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { AuthStore } from '../../domains/identity/data-access/auth.store';
import { environment } from '../../../environments/environment';
import { TENANT_REQUEST_SCOPE } from './tenant-request-context';

const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');
const workspacesDiscoveryUrl = `${apiBaseUrl}/me/workspaces`;
function tenantOrgIdForRequest(
  authStore: InstanceType<typeof AuthStore>,
  request: Parameters<HttpInterceptorFn>[0]
): string | null {
  return request.context.get(TENANT_REQUEST_SCOPE) === 'CABINET'
    ? authStore.activeWorkspaceOrgId()
    : authStore.effectiveAccountingOrgId();
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
  const tenantOrgId = tenantOrgIdForRequest(authStore, request);

  if (!isWorkspaceDiscoveryRequest && !tenantOrgId) {
    return throwError(
      () =>
        new HttpErrorResponse({
          status: 401,
          statusText: 'Missing active organization',
          url: request.url,
          error: { message: 'Select a workspace before continuing.' }
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
          error: { message: 'Sign in before continuing.' }
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
