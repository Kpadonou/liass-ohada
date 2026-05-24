import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { fetchAuthSession } from 'aws-amplify/auth';
import { firstValueFrom } from 'rxjs';
import { vi } from 'vitest';

import { environment } from '../../environments/environment';
import { authInterceptor } from './auth.interceptor';
import { AuthStore } from './auth.store';

vi.mock('aws-amplify/auth', () => ({
  confirmSignIn: vi.fn(),
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
        provideHttpClientTesting()
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
    expect(request.request.headers.get('x-org-id')).toBe('org-test');
    request.flush({ projects: [] });
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
    expect(request.request.headers.has('x-org-id')).toBe(false);
    request.flush({ workspaces: [] });
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
    expect(request.request.headers.has('x-org-id')).toBe(false);
    expect(fetchAuthSession).not.toHaveBeenCalled();
    request.flush({});
  });
});
