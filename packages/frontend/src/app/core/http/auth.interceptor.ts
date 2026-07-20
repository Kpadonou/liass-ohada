import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoService } from '@ngneat/transloco';
import { fetchAuthSession } from 'aws-amplify/auth';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { AuthStore } from '../../domains/identity/data-access/auth.store';
import { environment } from '../../../environments/environment';
import { NotificationService } from '../notifications/notification.service';
import {
  ACCOUNTING_REQUEST_PERMISSION,
  TENANT_REQUEST_SCOPE
} from './tenant-request-context';

const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');
const workspacesDiscoveryUrl = `${apiBaseUrl}/me/workspaces`;
const cabinetInvitationAcceptanceUrl = `${apiBaseUrl}/me/cabinet-invitations/accept`;
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
  const notification = inject(NotificationService, { optional: true });
  const router = inject(Router, { optional: true });
  const translocoService = inject(TranslocoService);
  const activeLanguage = translocoService.getActiveLang() || 'fr';
  const isCabinetInvitationAcceptanceRequest =
    request.url === cabinetInvitationAcceptanceUrl && request.method === 'POST';
  const isPreTenantRequest =
    (request.url === workspacesDiscoveryUrl &&
      (request.method === 'GET' || request.method === 'POST')) ||
    isCabinetInvitationAcceptanceRequest;
  const tenantOrgId = tenantOrgIdForRequest(authStore, request);
  const requestScope = request.context.get(TENANT_REQUEST_SCOPE);
  const accountingPermission = request.context.get(ACCOUNTING_REQUEST_PERMISSION);

  if (
    !isPreTenantRequest &&
    requestScope === 'ACCOUNTING' &&
    accountingPermission === 'ACCOUNTING_WRITE' &&
    !authStore.canWriteAccounting()
  ) {
    return throwError(
      () =>
        new HttpErrorResponse({
          status: 403,
          statusText: 'Accounting access is read-only',
          url: request.url,
          error: {
            message: {
              code: 'CABINET_DOSSIER_READ_ONLY',
              message: translate(
                translocoService,
                'ACCOUNTING.ACCESS.READ_ONLY_ACTION'
              )
            }
          }
        })
    );
  }

  if (!isPreTenantRequest && !tenantOrgId) {
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
      const token = isCabinetInvitationAcceptanceRequest
        ? session.tokens?.idToken?.toString()
        : session.tokens?.accessToken?.toString();

      if (!token) {
        throw new HttpErrorResponse({
          status: 401,
          statusText: 'Missing auth token',
          url: request.url,
          error: { message: 'Sign in before continuing.' }
        });
      }

      const setHeaders: Record<string, string> = isPreTenantRequest
        ? {
            Authorization: `Bearer ${token}`,
            'Accept-Language': activeLanguage
          }
        : {
            Authorization: `Bearer ${token}`,
            'Accept-Language': activeLanguage,
            'x-org-id': tenantOrgId as string,
            ...(requestScope === 'ACCOUNTING' &&
            authStore.activeWorkspaceOrgId() &&
            authStore.activeWorkspaceOrgId() !== tenantOrgId
              ? { 'x-workspace-org-id': authStore.activeWorkspaceOrgId() as string }
              : {})
          };

      return next(
        request.clone({
          setHeaders
        })
      );
    }),
    catchError((error) => {
      const httpError =
        error instanceof HttpErrorResponse
          ? error
          : new HttpErrorResponse({
              status: 401,
              statusText: 'Authentication required',
              url: request.url,
              error
            });
      if (requestScope === 'ACCOUNTING' && httpError.status === 403) {
        const code = errorCode(httpError);
        authStore.handleAccountingAuthorizationFailure(code);
        if (code === 'CABINET_DOSSIER_READ_ONLY') {
          notification?.error(translate(translocoService, 'ACCOUNTING.ACCESS.READ_ONLY_ACTION'));
        } else if (authStore.activeWorkspaceType() === 'ACCOUNTING_FIRM') {
          notification?.error(translate(translocoService, 'ACCOUNTING.ACCESS.REVOKED'));
          void router?.navigate(['/cabinet/dossiers'], {
            queryParams: { contextRecovery: '1' },
            replaceUrl: true
          });
        }
      }
      return throwError(() => httpError);
    })
  );
};

function errorCode(error: HttpErrorResponse): string | null {
  const body = error.error as
    | { message?: string | { code?: string }; error?: { code?: string } }
    | undefined;
  return (
    (typeof body?.message === 'object' ? body.message.code : undefined) ??
    body?.error?.code ??
    null
  );
}

function translate(service: TranslocoService, key: string): string {
  return typeof service.translate === 'function' ? service.translate(key) : key;
}
