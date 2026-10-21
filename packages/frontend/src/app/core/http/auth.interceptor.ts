import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoService } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { fetchAuthSession } from 'aws-amplify/auth';
import { catchError, from, switchMap, throwError, map } from 'rxjs';

import { AuthStore } from '../../domains/identity/data-access/auth.store';
import { environment } from '../../../environments/environment';
import { NotificationService } from '../notifications/notification.service';
import { ACCOUNTING_REQUEST_PERMISSION, TENANT_REQUEST_SCOPE } from './tenant-request-context';
import { GUEST_CAPABILITY_REQUEST } from './guest-request-context';

const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');
const workspacesDiscoveryUrl = `${apiBaseUrl}/me/workspaces`;
const cabinetInvitationAcceptanceUrl = `${apiBaseUrl}/me/cabinet-invitations/accept`;
function tenantOrgIdForRequest(
  authStore: InstanceType<typeof AuthStore>,
  request: Parameters<HttpInterceptorFn>[0],
): string | null {
  return request.context.get(TENANT_REQUEST_SCOPE) === 'CABINET'
    ? authStore.activeWorkspaceOrgId()
    : authStore.effectiveOrgId();
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(apiBaseUrl)) {
    return next(request);
  }

  if (
    request.method === 'POST' &&
    ['resolve', 'renew'].some(
      (operation) => request.url === `${apiBaseUrl}/public/restaurants/guest/${operation}`,
    )
  ) {
    let headers = request.headers.delete('x-org-id').delete('x-workspace-org-id');
    const authorization = headers.get('Authorization');
    if (
      !request.context.get(GUEST_CAPABILITY_REQUEST) ||
      request.url.endsWith('/resolve') ||
      !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
        authorization ?? '',
      )
    )
      headers = headers.delete('Authorization');
    return next(request.clone({ headers, withCredentials: false }));
  }

  const authStore = inject(AuthStore);
  const notification = inject(NotificationService, { optional: true });
  const router = inject(Router, { optional: true });
  const queryClient = inject(QueryClient, { optional: true });
  const translocoService = inject(TranslocoService);
  const activeLanguage = translocoService.getActiveLang() || 'fr';
  const isCabinetInvitationAcceptanceRequest =
    (request.url === cabinetInvitationAcceptanceUrl ||
      request.url === `${apiBaseUrl}/me/organization/invitations/accept`) &&
    request.method === 'POST';
  const requiresIdentityClaims =
    request.url === workspacesDiscoveryUrl || isCabinetInvitationAcceptanceRequest;
  const isPreTenantRequest =
    (request.url === workspacesDiscoveryUrl &&
      (request.method === 'GET' || request.method === 'POST')) ||
    isCabinetInvitationAcceptanceRequest;
  const tenantOrgId = tenantOrgIdForRequest(authStore, request);
  const userId = authStore.currentUserId();
  const revision = authStore.contextRevision();
  const workspaceOrgId = authStore.activeWorkspaceOrgId();
  const storedOrgId = localStorage.getItem('liass-ohada.activeOrgId');
  const storedDossierId = localStorage.getItem('liass-ohada.activeDossierOrgId');
  const isCurrent = () =>
    authStore.contextRevision() === revision &&
    authStore.currentUserId() === userId &&
    (isPreTenantRequest ||
      (tenantOrgIdForRequest(authStore, request) === tenantOrgId &&
        localStorage.getItem('liass-ohada.activeOrgId') === storedOrgId &&
        localStorage.getItem('liass-ohada.activeDossierOrgId') === storedDossierId &&
        storedOrgId === workspaceOrgId));
  const assertCurrent = () => {
    if (!isCurrent())
      throw new HttpErrorResponse({
        status: 409,
        url: request.url,
        error: { error: { code: 'WORKSPACE_CHANGED' } },
      });
  };
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
              message: translate(translocoService, 'ACCOUNTING.ACCESS.READ_ONLY_ACTION'),
            },
          },
        }),
    );
  }

  if (!isPreTenantRequest && !tenantOrgId) {
    return throwError(
      () =>
        new HttpErrorResponse({
          status: 401,
          statusText: 'Missing active organization',
          url: request.url,
          error: { message: 'Select a workspace before continuing.' },
        }),
    );
  }

  try {
    assertCurrent();
  } catch (error) {
    return throwError(() => error);
  }

  return from(fetchAuthSession()).pipe(
    switchMap((session) => {
      assertCurrent();
      const subject = session.tokens?.accessToken?.payload?.sub;
      if (userId && typeof subject === 'string' && subject !== userId) {
        authStore.invalidateSessionContext();
        throw new HttpErrorResponse({ status: 401, url: request.url });
      }
      const token = requiresIdentityClaims
        ? session.tokens?.idToken?.toString()
        : session.tokens?.accessToken?.toString();

      if (!token) {
        throw new HttpErrorResponse({
          status: 401,
          statusText: 'Missing auth token',
          url: request.url,
          error: { message: 'Sign in before continuing.' },
        });
      }

      const setHeaders: Record<string, string> = isPreTenantRequest
        ? {
            Authorization: `Bearer ${token}`,
            'Accept-Language': activeLanguage,
          }
        : {
            Authorization: `Bearer ${token}`,
            'Accept-Language': activeLanguage,
            'x-org-id': tenantOrgId as string,
            ...(requestScope === 'ACCOUNTING' && workspaceOrgId && workspaceOrgId !== tenantOrgId
              ? { 'x-workspace-org-id': workspaceOrgId as string }
              : {}),
          };

      return next(
        request.clone({
          setHeaders,
        }),
      );
    }),
    map((event) => {
      assertCurrent();
      return event;
    }),
    catchError((error) => {
      // An old request must not revoke or redirect the newly selected workspace.
      if (!isCurrent())
        return throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              url: request.url,
              error: { error: { code: 'WORKSPACE_CHANGED' } },
            }),
        );
      const httpError =
        error instanceof HttpErrorResponse
          ? error
          : new HttpErrorResponse({
              status: 401,
              statusText: 'Authentication required',
              url: request.url,
              error,
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
            replaceUrl: true,
          });
        }
      }
      if (
        requestScope === 'CABINET' &&
        httpError.status === 403 &&
        (errorCode(httpError) === 'CABINET_MEMBER_NOT_ACTIVE' ||
          errorCode(httpError) === 'CABINET_WORKSPACE_REQUIRED')
      ) {
        const cabinetOrgId = authStore.activeWorkspaceOrgId();
        if (queryClient && cabinetOrgId) {
          void queryClient.cancelQueries({ queryKey: ['cabinet-dashboard', cabinetOrgId] });
          queryClient.removeQueries({ queryKey: ['cabinet-dashboard', cabinetOrgId] });
          void queryClient.cancelQueries({ queryKey: ['cabinet-team', cabinetOrgId] });
          queryClient.removeQueries({ queryKey: ['cabinet-team', cabinetOrgId] });
        }
        notification?.error(
          translate(translocoService, 'IDENTITY.CABINET_TEAM.ERRORS.ACCESS_REVOKED'),
        );
        void authStore
          .loadWorkspaces(true)
          .catch(() => undefined)
          .finally(() => {
            void router?.navigate(['/dashboard'], { replaceUrl: true });
          });
      }
      return throwError(() => httpError);
    }),
  );
};

function errorCode(error: HttpErrorResponse): string | null {
  const body = error.error as
    | { message?: string | { code?: string }; error?: { code?: string } }
    | undefined;
  return (
    (typeof body?.message === 'object' ? body.message.code : undefined) ?? body?.error?.code ?? null
  );
}

function translate(service: TranslocoService, key: string): string {
  return typeof service.translate === 'function' ? service.translate(key) : key;
}
