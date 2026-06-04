import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@ngneat/transloco';
import { fetchAuthSession } from 'aws-amplify/auth';
import { firstValueFrom } from 'rxjs';
import { vi } from 'vitest';

import { AuthStore } from '../../domains/identity/data-access/auth.store';
import { environment } from '../../../environments/environment';
import { authInterceptor } from './auth.interceptor';

vi.mock('aws-amplify/auth', () => ({
  confirmSignIn: vi.fn(),
  fetchUserAttributes: vi.fn(),
  fetchAuthSession: vi.fn(),
  getCurrentUser: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn()
}));

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
    authStore.setTenant('org-test');
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
    request.flush({ accounts: [] });
    await response;
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
    const response = firstValueFrom(http.get(`${environment.apiBaseUrl}/cabinet/dossiers`));
    await Promise.resolve();

    const request = httpMock.expectOne(`${environment.apiBaseUrl}/cabinet/dossiers`);
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-token');
    expect(request.request.headers.get('x-org-id')).toBe('org-cabinet');
    request.flush({ dossiers: [] });
    await response;
  });

  it('adds only bearer token for workspace discovery calls', async () => {
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: {
        accessToken: { toString: () => 'jwt-token' }
      }
    } as never);

    const http = TestBed.inject(HttpClient);
    const response = firstValueFrom(http.get(`${environment.apiBaseUrl}/me/workspaces`));
    await Promise.resolve();

    const request = httpMock.expectOne(`${environment.apiBaseUrl}/me/workspaces`);
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-token');
    expect(request.request.headers.get('Accept-Language')).toBe('fr');
    expect(request.request.headers.has('x-org-id')).toBe(false);
    request.flush({ workspaces: [] });
    await response;
  });

  it('omits active organization header for initial workspace creation', async () => {
    const authStore = TestBed.inject(AuthStore);
    authStore.setTenant('org-test');
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: {
        accessToken: { toString: () => 'jwt-token' }
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
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-token');
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
