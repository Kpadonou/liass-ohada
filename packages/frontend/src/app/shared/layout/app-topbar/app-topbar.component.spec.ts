import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { fetchAuthSession, fetchUserAttributes, getCurrentUser } from 'aws-amplify/auth';
import { vi } from 'vitest';

import { CabinetDossiersApi } from '../../../domains/identity/data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../../domains/identity/data-access/workspaces.api';
import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { UiStore } from '../../../core/state/ui.store';
import { AppTopbarComponent } from './app-topbar.component';

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
    SHELL: {
      SECTIONS: {
        ACCOUNTING: 'Accounting',
        PROJECTS: 'Projects and funds',
        REPORTS: 'OHADA reports',
        TREASURY: 'Treasury'
      },
      PAGES: {
        ADMINISTRATION: 'Administration',
        CHART_OF_ACCOUNTS: 'Chart of accounts',
        DASHBOARD: 'Dashboard',
        ENTRIES: 'Entries',
        GENERAL_LEDGER: 'General ledger',
        JOURNALS: 'Journals',
        TRIAL_BALANCE: 'Trial balance'
      },
      TOPBAR: {
        COMMAND_PLACEHOLDER: 'Search workspace or ask AI...',
        CREATE_DOSSIER: 'Create dossier',
        CURRENT_MODULE: 'Current module',
        DARK_MODE: 'Switch to dark mode',
        DOSSIER: 'Active dossier',
        DOSSIER_LOADING: 'Loading dossier...',
        NO_DOSSIER: 'No client dossier',
        NO_WORKSPACE: 'Workspace',
        SELECT_DOSSIER: 'Select dossier',
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

    expect(dossierText).toContain('No client dossier');
    expect(dossierText).toContain('Create dossier');
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
    vi.mocked(fetchUserAttributes).mockResolvedValue({
      email: 'chrys.kpadonou@example.com',
      name: 'Chrys Kpadonou'
    });
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
