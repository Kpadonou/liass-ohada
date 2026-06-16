import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { fetchAuthSession, fetchUserAttributes, getCurrentUser } from 'aws-amplify/auth';
import { vi } from 'vitest';

import { CabinetDossiersApi } from '../../../domains/identity/data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../../domains/identity/data-access/workspaces.api';
import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { UiStore } from '../../../core/state/ui.store';
import { AppTopbarComponent } from './app-topbar.component';

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

const translations = {
  en: {
    SHELL: {
      SECTIONS: {
        ACCOUNTING: 'Accounting',
        PROJECTS: 'Projects and funds',
        REPORTS: 'OHADA reports',
        TREASURY: 'Treasury'
      },
      PAGES: {
        ACCOUNTING_OVERVIEW: 'Accounting',
        ADMINISTRATION: 'Administration',
        CABINET_DASHBOARD: 'Cabinet dashboard',
        CABINET_DOSSIERS: 'Client dossiers',
        CHART_OF_ACCOUNTS: 'Chart of accounts',
        CLIENT_DOSSIERS: 'Client dossiers',
        DASHBOARD: 'Dashboard',
        ENTRIES: 'Entries',
        FISCAL_YEAR: 'Fiscal year',
        GENERAL_LEDGER: 'General ledger',
        JOURNALS: 'Journals',
        LETTERING: 'Lettering',
        TRIAL_BALANCE: 'Trial balance'
      },
      TOPBAR: {
        CABINET_DASHBOARD: 'Cabinet dashboard',
        CABINET_MENU_LABEL: 'Open cabinet menu',
        CLIENT_DOSSIERS: 'Client dossiers',
        COMMAND_PLACEHOLDER: 'Search workspace or ask AI...',
        CREATE_DOSSIER: 'Create dossier',
        CURRENT_MODULE: 'Current module',
        DARK_MODE: 'Switch to dark mode',
        DOSSIER: 'Active dossier',
        DOSSIER_LOADING: 'Loading dossier...',
        NO_DOSSIER: 'No dossier open',
        NO_WORKSPACE: 'Workspace',
        NEW_CLIENT_DOSSIER: 'New client dossier',
        SELECT_DOSSIER: 'Select a dossier',
        SIGN_OUT: 'Sign out',
        TOGGLE_NAVIGATION: 'Toggle navigation',
        USER: 'User',
        USER_MENU: 'Open user menu',
        WORKSPACE: 'Active workspace',
        WORKSPACE_LOADING: 'Loading workspace...'
      },
      WORKSPACE_TYPES: {
        ACCOUNTING_FIRM: 'Accounting firm',
        COMPANY: 'Company'
      }
    }
  }
};

describe('AppTopbarComponent', () => {
  let fixture: ComponentFixture<AppTopbarComponent>;
  let authStore: InstanceType<typeof AuthStore>;
  let uiStore: InstanceType<typeof UiStore>;
  let cabinetDossiersApi: { listDossiers: ReturnType<typeof vi.fn> };
  let router: Router;
  let workspacesApi: { listWorkspaces: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(fetchAuthSession).mockReset();
    vi.mocked(fetchUserAttributes).mockReset();
    vi.mocked(fetchAuthSession).mockResolvedValue({} as never);
    vi.mocked(fetchUserAttributes).mockResolvedValue({});
    cabinetDossiersApi = { listDossiers: vi.fn() };
    workspacesApi = { listWorkspaces: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [
        AppTopbarComponent,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: {
            availableLangs: ['en'],
            defaultLang: 'en'
          }
        })
      ],
      providers: [
        provideRouter([]),
        { provide: CabinetDossiersApi, useValue: cabinetDossiersApi },
        { provide: WorkspacesApi, useValue: workspacesApi }
      ]
    }).compileComponents();

    authStore = TestBed.inject(AuthStore);
    uiStore = TestBed.inject(UiStore);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  function renderText(): string {
    fixture = TestBed.createComponent(AppTopbarComponent);
    fixture.detectChanges();

    return fixture.nativeElement.textContent;
  }

  function activeWorkspaceText(): string {
    return fixture.nativeElement.querySelector('[data-testid="active-workspace"]').textContent;
  }

  function activeDossierText(): string {
    return fixture.nativeElement.querySelector('[data-testid="active-dossier"]').textContent;
  }

  function userMenuTriggerText(): string {
    return fixture.nativeElement.querySelector('[data-testid="user-menu-trigger"]').textContent;
  }

  it('displays a company workspace name instead of the raw organization id', () => {
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-company-123',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company-123'
    );

    renderText();
    const text = activeWorkspaceText();

    expect(text).toContain('Demo SARL');
    expect(text).toContain('Company');
    expect(text).not.toContain('org-company-123');
    expect(text).not.toContain('Workspace');
  });

  it('displays the dashboard page title separately from the active workspace', () => {
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-company-123',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company-123'
    );

    const text = renderText();

    expect(text).toContain('Current module');
    expect(text).toContain('Dashboard');
    expect(activeWorkspaceText()).toContain('Demo SARL');
  });

  it('displays the general-ledger page title separately from the active workspace', () => {
    uiStore.setCurrentPage('accounting.generalLedger');
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-company-123',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company-123'
    );

    const text = renderText();

    expect(text).toContain('General ledger');
    expect(activeWorkspaceText()).toContain('Demo SARL');
  });

  it('displays the accounting overview page title separately from the active workspace', () => {
    uiStore.setCurrentPage('accounting.overview');
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-company-123',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company-123'
    );

    const text = renderText();

    expect(text).toContain('Accounting');
    expect(activeWorkspaceText()).toContain('Demo SARL');
  });

  it('displays the fiscal-year page title separately from the active workspace', () => {
    uiStore.setCurrentPage('accounting.fiscalYear');
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-company-123',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company-123'
    );

    const text = renderText();

    expect(text).toContain('Fiscal year');
    expect(activeWorkspaceText()).toContain('Demo SARL');
  });

  it('displays the lettering page title separately from the active workspace', () => {
    uiStore.setCurrentPage('accounting.lettering');
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-company-123',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company-123'
    );

    const text = renderText();

    expect(text).toContain('Lettering');
    expect(activeWorkspaceText()).toContain('Demo SARL');
  });

  it('displays the full client dossiers page title without truncation styling', () => {
    uiStore.setCurrentPage('cabinet.dossiers');
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-firm-123',
        displayName: 'Cabinet KPADONOU Conseil',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-firm-123'
    );

    renderText();
    const heading = fixture.nativeElement.querySelector('h2') as HTMLHeadingElement;

    expect(heading.textContent).toContain('Client dossiers');
    expect(heading.className).not.toContain('truncate');
  });

  it('displays an accounting-firm workspace name and type label', () => {
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-firm-123',
        cabinetId: 'cabinet-001',
        displayName: 'Cabinet KPADONOU Conseil',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-firm-123'
    );

    renderText();
    const text = activeWorkspaceText();

    expect(text).toContain('Cabinet KPADONOU Conseil');
    expect(text).toContain('Accounting firm');
    expect(text).not.toContain('org-firm-123');
    expect(text).not.toContain('Workspace');
  });

  it('opens a compact cabinet context menu for accounting-firm workspaces', () => {
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-firm-123',
        cabinetId: 'cabinet-001',
        displayName: 'Cabinet KPADONOU Conseil',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-firm-123'
    );

    renderText();
    const trigger = fixture.nativeElement.querySelector(
      '[data-testid="active-workspace"]'
    ) as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;

    expect(trigger.getAttribute('aria-label')).toBe('Open cabinet menu');
    expect(text).toContain('Cabinet dashboard');
    expect(text).toContain('Client dossiers');
    expect(text).toContain('New client dossier');
    expect(text).not.toContain('org-firm-123');
  });

  it('routes cabinet menu items without replacing workspace or dossier context', () => {
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-firm-123',
        cabinetId: 'cabinet-001',
        displayName: 'Cabinet KPADONOU Conseil',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-firm-123'
    );
    authStore.setCreatedDossier(
      {
        orgId: 'org-client-123',
        displayName: 'Client ABC SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      },
      'org-client-123'
    );

    renderText();
    const trigger = fixture.nativeElement.querySelector(
      '[data-testid="active-workspace"]'
    ) as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector(
      '[data-testid="cabinet-new-dossier-menu-item"]'
    ) as HTMLButtonElement).click();

    expect(router.navigate).toHaveBeenCalledWith(['/cabinet/dossiers'], {
      queryParams: { createDossier: '1' }
    });
    expect(authStore.activeWorkspaceOrgId()).toBe('org-firm-123');
    expect(authStore.activeDossierOrgId()).toBe('org-client-123');
  });

  it('does not render the cabinet context menu for company workspaces', () => {
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-company-123',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company-123'
    );

    renderText();

    expect(
      fixture.nativeElement.querySelector('[data-testid="cabinet-new-dossier-menu-item"]')
    ).toBeNull();
    expect(activeWorkspaceText()).toContain('Demo SARL');
  });

  it('displays the selected client dossier separately from the accounting-firm workspace', () => {
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-firm-123',
        cabinetId: 'cabinet-001',
        displayName: 'Cabinet KPADONOU Conseil',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-firm-123'
    );
    authStore.setCreatedDossier(
      {
        orgId: 'org-client-123',
        displayName: 'Client ABC SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      },
      'org-client-123'
    );

    renderText();
    const workspaceText = activeWorkspaceText();
    const dossierText = activeDossierText();

    expect(workspaceText).toContain('Cabinet KPADONOU Conseil');
    expect(workspaceText).toContain('Accounting firm');
    expect(workspaceText).not.toContain('Client ABC SARL');
    expect(dossierText).toContain('Active dossier');
    expect(dossierText).toContain('Client ABC SARL');
    expect(dossierText).not.toContain('org-client-123');
  });

  it('displays a separate no-dossier action for accounting-firm workspaces without a selected client', () => {
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-firm-123',
        cabinetId: 'cabinet-001',
        displayName: 'Cabinet KPADONOU Conseil',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-firm-123'
    );

    renderText();
    const dossierText = activeDossierText();

    expect(dossierText).toContain('No dossier open');
    expect(dossierText).toContain('Select a dossier');
  });

  it('updates the workspace label immediately after onboarding stores the created workspace', () => {
    renderText();
    expect(activeWorkspaceText()).toContain('Workspace');

    authStore.setCreatedWorkspace(
      {
        orgId: 'org-created',
        displayName: 'Created SARL',
        workspaceType: 'COMPANY'
      },
      'org-created'
    );
    fixture.detectChanges();

    expect(activeWorkspaceText()).toContain('Created SARL');
    expect(activeWorkspaceText()).not.toContain('Workspace');
  });

  it('shows a loading workspace label while persisted tenant workspaces are being loaded', async () => {
    localStorage.setItem('liass-ohada.activeOrgId', 'org-reloaded');
    let resolveWorkspaces: (workspaces: unknown[]) => void = () => undefined;
    workspacesApi.listWorkspaces.mockReturnValue(
      new Promise((resolve) => {
        resolveWorkspaces = resolve;
      })
    );
    await authStore.hydrate();
    const loadingPromise = authStore.loadWorkspaces();

    renderText();

    expect(activeWorkspaceText()).toContain('Loading workspace...');

    resolveWorkspaces([
      {
        orgId: 'org-reloaded',
        displayName: 'Reloaded SARL',
        workspaceType: 'COMPANY'
      }
    ]);
    await loadingPromise;
    fixture.detectChanges();

    expect(activeWorkspaceText()).toContain('Reloaded SARL');
    expect(activeWorkspaceText()).not.toContain('Workspace');
  });

  it('displays the Cognito user full name instead of a provider username', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'Google_123456789',
      userId: 'user-123',
      signInDetails: undefined
    });
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: {
        idToken: {
          payload: {
            email: 'chrys.kpadonou@example.com',
            name: 'Chrys Kpadonou'
          }
        }
      }
    } as never);
    await authStore.hydrate();

    renderText();
    const trigger = fixture.nativeElement.querySelector(
      'button[aria-label="Open user menu"]'
    ) as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Chrys Kpadonou');
    expect(text).toContain('chrys.kpadonou@example.com');
    expect(text).not.toContain('Google_123456789');
    expect(fetchUserAttributes).not.toHaveBeenCalled();
    expect(userMenuTriggerText()).not.toContain('User');
  });

  it('uses translated fallback labels when workspace and user names are missing', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'Google_123456789',
      userId: 'user-123',
      signInDetails: undefined
    });
    vi.mocked(fetchUserAttributes).mockResolvedValue({});
    await authStore.hydrate();

    const text = renderText();

    expect(text).toContain('User');
    expect(text).toContain('Workspace');
    expect(text).not.toContain('Google_123456789');
  });
});
