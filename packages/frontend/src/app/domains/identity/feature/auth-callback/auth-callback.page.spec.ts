import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { getCurrentUser } from 'aws-amplify/auth';
import { vi } from 'vitest';

import { WorkspacesApi } from '../../data-access/workspaces.api';
import { AuthCallbackPage } from './auth-callback.page';

vi.mock('aws-amplify/auth', () => ({
  confirmSignIn: vi.fn(),
  getCurrentUser: vi.fn(),
  signIn: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn()
}));

const translations = {
  en: {
    IDENTITY: {
      AUTH_CALLBACK: {
        COMPLETING: 'Completing sign-in...'
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
    vi.mocked(getCurrentUser).mockReset();
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
    vi.mocked(getCurrentUser).mockReturnValue(new Promise<never>(() => undefined));

    fixture = TestBed.createComponent(AuthCallbackPage);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Completing sign-in...');
  });

  it('discovers workspaces and redirects authenticated users to their destination', async () => {
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

  it('redirects unauthenticated callback visits to login', async () => {
    vi.mocked(getCurrentUser).mockRejectedValue(new Error('Not authenticated'));

    fixture = TestBed.createComponent(AuthCallbackPage);
    await fixture.componentInstance.ngOnInit();

    expect(workspacesApi.listWorkspaces).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
  });
});
