import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { fetchAuthSession } from 'aws-amplify/auth';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { environment } from '../../environments/environment';
import { AuthStore } from './auth.store';

const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(apiBaseUrl)) {
    return next(request);
  }

  const authStore = inject(AuthStore);
  const activeOrgId = authStore.activeOrgId();

  if (!activeOrgId) {
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

      return next(
        request.clone({
          setHeaders: {
            Authorization: `Bearer ${token}`,
            'x-org-id': activeOrgId
          }
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
