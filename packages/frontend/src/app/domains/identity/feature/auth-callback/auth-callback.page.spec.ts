import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { vi } from 'vitest';

import { WorkspacesApi } from '../../data-access/workspaces.api';
import { AuthCallbackPage } from './auth-callback.page';

type AuthCallbackPageHarness = AuthCallbackPage & {
  errorKey: () => string | null;
  loading: () => boolean;
};

vi.mock('aws-amplify/auth', () => ({
  confirmSignIn: vi.fn(),
  fetchAuthSession: vi.fn(),
  fetchUserAttributes: vi.fn(),
  getCurrentUser: vi.fn(),
  signIn: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn()
}));

const translations = {
  en: {
    IDENTITY: {
      AUTH_CALLBACK: {
        COMPLETING: 'Completing sign-in...',
        ERROR_TITLE: 'Sign-in could not finish',
        RETRY: 'Retry',
        ERRORS: {
          GENERIC: 'Workspace discovery could not complete.',
          TIMEOUT: 'Sign-in is taking longer than expected.'
        }
      }
    }
  }
};

describe('AuthCallbackPage', () => {
  let fixture: ComponentFixture<AuthCallbackPage>;
  let router: Router;
  let workspacesApi: { listWorkspaces: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.mocked(fetchAuthSession).mockReset();
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(fetchAuthSession).mockResolvedValue({});
    workspacesApi = { listWorkspaces: vi.fn().mockResolvedValue([]) };

    await TestBed.configureTestingModule({
      imports: [
        AuthCallbackPage,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: {
            availableLangs: ['en'],
            defaultLang: 'en',
          },
        }),
      ],
      providers: [
        provideRouter([]),
        { provide: WorkspacesApi, useValue: workspacesApi },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  it('shows a minimal loading state while Amplify completes the redirect', () => {
    vi.mocked(fetchAuthSession).mockReturnValue(new Promise<never>(() => undefined));

    fixture = TestBed.createComponent(AuthCallbackPage);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Completing sign-in...');
  });

  it('redirects authenticated users with one workspace to the dashboard', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    workspacesApi.listWorkspaces.mockResolvedValue([{ orgId: 'org-test' }]);

    fixture = TestBed.createComponent(AuthCallbackPage);
    await fixture.componentInstance.ngOnInit();

    expect(workspacesApi.listWorkspaces).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard'], { replaceUrl: true });
  });

  it('redirects authenticated users with no workspaces to onboarding', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    workspacesApi.listWorkspaces.mockResolvedValue([]);

    fixture = TestBed.createComponent(AuthCallbackPage);
    await fixture.componentInstance.ngOnInit();

    expect(workspacesApi.listWorkspaces).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding'], { replaceUrl: true });
  });

  it('redirects authenticated users with multiple workspaces to workspace selection', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    workspacesApi.listWorkspaces.mockResolvedValue([{ orgId: 'org-a' }, { orgId: 'org-b' }]);

    fixture = TestBed.createComponent(AuthCallbackPage);
    await fixture.componentInstance.ngOnInit();

    expect(workspacesApi.listWorkspaces).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/select-workspace'], { replaceUrl: true });
  });

  it('shows a retryable error when workspace discovery fails without an auth error', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    workspacesApi.listWorkspaces.mockRejectedValue(new Error('Network unavailable'));

    fixture = TestBed.createComponent(AuthCallbackPage);
    await fixture.componentInstance.ngOnInit();
    const page = fixture.componentInstance as unknown as AuthCallbackPageHarness;

    expect(router.navigate).not.toHaveBeenCalled();
    expect(page.loading()).toBe(false);
    expect(page.errorKey()).toBe('IDENTITY.AUTH_CALLBACK.ERRORS.GENERIC');
  });

  it('redirects to login when workspace discovery fails with an auth error', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    workspacesApi.listWorkspaces.mockRejectedValue(
      new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' })
    );

    fixture = TestBed.createComponent(AuthCallbackPage);
    await fixture.componentInstance.ngOnInit();

    expect(router.navigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
  });

  it('redirects unauthenticated callback visits to login', async () => {
    vi.mocked(getCurrentUser).mockRejectedValue(new Error('Not authenticated'));

    fixture = TestBed.createComponent(AuthCallbackPage);
    await fixture.componentInstance.ngOnInit();

    expect(workspacesApi.listWorkspaces).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
  });
});
