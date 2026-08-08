import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@ngneat/transloco';
import { fetchAuthSession } from 'aws-amplify/auth';
import { firstValueFrom } from 'rxjs';
import { vi } from 'vitest';

import { AuthStore } from '../../domains/identity/data-access/auth.store';
import { environment } from '../../../environments/environment';
import { authInterceptor } from './auth.interceptor';
import { accountingWriteContext, TENANT_REQUEST_SCOPE } from './tenant-request-context';

vi.mock('aws-amplify/auth', () => {
  const globalScope = globalThis as unknown as {
    __liassAmplifyAuthMock?: Record<string, ReturnType<typeof vi.fn>>;
  };
  globalScope.__liassAmplifyAuthMock ??= {
    confirmSignIn: vi.fn(),
    fetchAuthSession: vi.fn(),
    fetchUserAttributes: vi.fn(),
    getCurrentUser: vi.fn(),
    signIn: vi.fn(),
    signInWithRedirect: vi.fn(),
    signOut: vi.fn()
  };

  return globalScope.__liassAmplifyAuthMock;
});

describe('authInterceptor', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        {
          provide: TranslocoService,
          useValue: {
            getActiveLang: () => 'fr'
          }
        }
      ]
    });
    httpMock = TestBed.inject(HttpTestingController);
    localStorage.clear();
    vi.mocked(fetchAuthSession).mockReset();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('adds bearer token and active organization headers for backend API calls', async () => {
    const authStore = TestBed.inject(AuthStore);
    authStore.setCreatedWorkspace(
      { orgId: 'org-test', displayName: 'Demo SARL', workspaceType: 'COMPANY' },
      'org-test'
    );
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: {
        accessToken: { toString: () => 'jwt-token' }
      }
    } as never);

    const http = TestBed.inject(HttpClient);
    const response = firstValueFrom(http.get(`${environment.apiBaseUrl}/projects`));
    await Promise.resolve();

    const request = httpMock.expectOne(`${environment.apiBaseUrl}/projects`);
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-token');
    expect(request.request.headers.get('Accept-Language')).toBe('fr');
    expect(request.request.headers.get('x-org-id')).toBe('org-test');
    request.flush({ projects: [] });
    await response;
  });

  it('uses the effective active organization for ProductAccess observation', async () => {
    const authStore = TestBed.inject(AuthStore);
    authStore.setCreatedWorkspace(
      { orgId: 'org-test', displayName: 'Demo SARL', workspaceType: 'COMPANY' },
      'org-test'
    );
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: { accessToken: { toString: () => 'jwt-token' } }
    } as never);

    const response = firstValueFrom(
      TestBed.inject(HttpClient).get(`${environment.apiBaseUrl}/me/product-access`)
    );
    await Promise.resolve();

    const request = httpMock.expectOne(`${environment.apiBaseUrl}/me/product-access`);
    expect(request.request.headers.get('x-org-id')).toBe('org-test');
    request.flush({ productAccess: [] });
    await response;
  });

  it('uses the active client dossier for tenant API calls in accounting-firm workspaces', async () => {
    const authStore = TestBed.inject(AuthStore);
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-cabinet',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM',
        cabinetId: 'cab-123'
      },
      'org-cabinet'
    );
    authStore.setCreatedDossier(
      {
        orgId: 'org-client',
        displayName: 'Client SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      },
      'org-client'
    );
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: {
        accessToken: { toString: () => 'jwt-token' }
      }
    } as never);

    const http = TestBed.inject(HttpClient);
    const response = firstValueFrom(http.get(`${environment.apiBaseUrl}/accounts`));
    await Promise.resolve();

    const request = httpMock.expectOne(`${environment.apiBaseUrl}/accounts`);
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-token');
    expect(request.request.headers.get('x-org-id')).toBe('org-client');
    expect(request.request.headers.get('x-workspace-org-id')).toBe('org-cabinet');
    request.flush({ accounts: [] });
    await response;
  });

  it('blocks a Reader accounting mutation locally without sending a request', async () => {
    const authStore = TestBed.inject(AuthStore);
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-cabinet',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM',
        cabinetId: 'cab-123'
      },
      'org-cabinet'
    );
    authStore.setCreatedDossier(
      {
        orgId: 'org-client',
        displayName: 'Client SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        accessMode: 'READ_ONLY',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      },
      'org-client'
    );

    const http = TestBed.inject(HttpClient);
    await expect(
      firstValueFrom(
        http.post(`${environment.apiBaseUrl}/entries`, {}, { context: accountingWriteContext() })
      )
    ).rejects.toMatchObject({ status: 403 });
    httpMock.expectNone(`${environment.apiBaseUrl}/entries`);
    expect(authStore.activeDossierOrgId()).toBe('org-client');
    expect(fetchAuthSession).not.toHaveBeenCalled();
  });

  it('blocks accounting requests when an accounting firm has no open dossier', async () => {
    const authStore = TestBed.inject(AuthStore);
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-cabinet',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM',
        cabinetId: 'cab-123'
      },
      'org-cabinet'
    );

    const http = TestBed.inject(HttpClient);
    await expect(
      firstValueFrom(http.get(`${environment.apiBaseUrl}/accounts`))
    ).rejects.toMatchObject({ status: 401, statusText: 'Missing active organization' });
    httpMock.expectNone(`${environment.apiBaseUrl}/accounts`);
    expect(fetchAuthSession).not.toHaveBeenCalled();
  });

  it('uses the cabinet workspace for cabinet dossier API calls', async () => {
    const authStore = TestBed.inject(AuthStore);
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-cabinet',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM',
        cabinetId: 'cab-123'
      },
      'org-cabinet'
    );
    authStore.setCreatedDossier(
      {
        orgId: 'org-client',
        displayName: 'Client SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      },
      'org-client'
    );
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: {
        accessToken: { toString: () => 'jwt-token' }
      }
    } as never);

    const http = TestBed.inject(HttpClient);
    const response = firstValueFrom(
      http.get(`${environment.apiBaseUrl}/cabinet/dossiers`, {
        context: new HttpContext().set(TENANT_REQUEST_SCOPE, 'CABINET')
      })
    );
    await Promise.resolve();

    const request = httpMock.expectOne(`${environment.apiBaseUrl}/cabinet/dossiers`);
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-token');
    expect(request.request.headers.get('x-org-id')).toBe('org-cabinet');
    request.flush({ dossiers: [] });
    await response;
  });

  it('uses the cabinet workspace for cabinet dossier creation calls', async () => {
    const authStore = TestBed.inject(AuthStore);
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-cabinet',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM',
        cabinetId: 'cab-123'
      },
      'org-cabinet'
    );
    authStore.setCreatedDossier(
      {
        orgId: 'org-client',
        displayName: 'Client SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      },
      'org-client'
    );
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: {
        accessToken: { toString: () => 'jwt-token' }
      }
    } as never);

    const payload = {
      companyName: 'New Client SARL',
      country: 'BJ',
      accountingFramework: 'SYSCOHADA_REVISED'
    };
    const http = TestBed.inject(HttpClient);
    const response = firstValueFrom(
      http.post(`${environment.apiBaseUrl}/cabinet/dossiers`, payload, {
        context: new HttpContext().set(TENANT_REQUEST_SCOPE, 'CABINET')
      })
    );
    await Promise.resolve();

    const request = httpMock.expectOne(`${environment.apiBaseUrl}/cabinet/dossiers`);
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-token');
    expect(request.request.headers.get('x-org-id')).toBe('org-cabinet');
    expect(request.request.body).toEqual(payload);
    request.flush({
      dossier: {
        orgId: 'org-new-client',
        displayName: 'New Client SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      },
      activeDossierOrgId: 'org-new-client'
    });
    await response;
  });

  it('uses the ID token without a tenant header for workspace discovery', async () => {
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: {
        accessToken: { toString: () => 'access-token' },
        idToken: { toString: () => 'id-token-with-verified-email' }
      }
    } as never);

    const http = TestBed.inject(HttpClient);
    const response = firstValueFrom(http.get(`${environment.apiBaseUrl}/me/workspaces`));
    await Promise.resolve();

    const request = httpMock.expectOne(`${environment.apiBaseUrl}/me/workspaces`);
    expect(request.request.headers.get('Authorization')).toBe(
      'Bearer id-token-with-verified-email'
    );
    expect(request.request.headers.get('Accept-Language')).toBe('fr');
    expect(request.request.headers.has('x-org-id')).toBe(false);
    request.flush({ workspaces: [] });
    await response;
  });

  it('uses the ID token without a tenant header for initial workspace creation', async () => {
    const authStore = TestBed.inject(AuthStore);
    authStore.setTenant('org-test');
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: {
        accessToken: { toString: () => 'access-token' },
        idToken: { toString: () => 'id-token-with-verified-email' }
      }
    } as never);

    const http = TestBed.inject(HttpClient);
    const response = firstValueFrom(
      http.post(`${environment.apiBaseUrl}/me/workspaces`, {
        workspaceType: 'COMPANY',
        organizationName: 'Demo SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED'
      })
    );
    await Promise.resolve();

    const request = httpMock.expectOne(`${environment.apiBaseUrl}/me/workspaces`);
    expect(request.request.headers.get('Authorization')).toBe(
      'Bearer id-token-with-verified-email'
    );
    expect(request.request.headers.get('Accept-Language')).toBe('fr');
    expect(request.request.headers.has('x-org-id')).toBe(false);
    request.flush({
      organization: {
        orgId: 'org-created',
        name: 'Demo SARL',
        workspaceType: 'COMPANY',
        status: 'ACTIVE',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      },
      cabinet: null,
      workspace: {
        orgId: 'org-created',
        role: 'OWNER',
        accessSource: 'DIRECT',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY',
        status: 'ACTIVE',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED'
      },
      activeOrgId: 'org-created'
    });
    await response;
  });

  it('uses the ID token and no tenant header for invitation acceptance', async () => {
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: {
        accessToken: { toString: () => 'access-token' },
        idToken: { toString: () => 'id-token-with-verified-email' }
      }
    } as never);

    const http = TestBed.inject(HttpClient);
    const response = firstValueFrom(
      http.post(`${environment.apiBaseUrl}/me/cabinet-invitations/accept`, {
        token: 'invitation-token'
      })
    );
    await Promise.resolve();

    const request = httpMock.expectOne(
      `${environment.apiBaseUrl}/me/cabinet-invitations/accept`
    );
    expect(request.request.headers.get('Authorization')).toBe(
      'Bearer id-token-with-verified-email'
    );
    expect(request.request.headers.get('Accept-Language')).toBe('fr');
    expect(request.request.headers.has('x-org-id')).toBe(false);
    request.flush({ member: {}, assignments: [] });
    await response;
  });

  it('does not add auth headers for non-backend requests', () => {
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: {
        accessToken: { toString: () => 'jwt-token' }
      }
    } as never);

    const http = TestBed.inject(HttpClient);
    http.get('/assets/config.json').subscribe();

    const request = httpMock.expectOne('/assets/config.json');
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(request.request.headers.has('Accept-Language')).toBe(false);
    expect(request.request.headers.has('x-org-id')).toBe(false);
    expect(fetchAuthSession).not.toHaveBeenCalled();
    request.flush({});
  });
});
