import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { fetchAuthSession } from 'aws-amplify/auth';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { AuthStore } from '../../domains/identity/data-access/auth.store';
import { environment } from '../../../environments/environment';

const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');
const workspacesDiscoveryUrl = `${apiBaseUrl}/me/workspaces`;

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(apiBaseUrl)) {
    return next(request);
  }

  const authStore = inject(AuthStore);
  const isWorkspaceDiscoveryRequest = request.url === workspacesDiscoveryUrl;
  const activeOrgId = authStore.activeOrgId();

  if (!isWorkspaceDiscoveryRequest && !activeOrgId) {
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
        ? { Authorization: `Bearer ${token}` }
        : {
            Authorization: `Bearer ${token}`,
            'x-org-id': activeOrgId as string
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
