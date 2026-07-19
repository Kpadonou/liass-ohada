import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { fetchAuthSession, fetchUserAttributes, getCurrentUser } from 'aws-amplify/auth';
import { vi } from 'vitest';

import { CabinetDossiersApi } from '../../../domains/identity/data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../../domains/identity/data-access/workspaces.api';
import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { AccountingFiscalYearContextService } from '../../../domains/accounting/data-access/accounting-fiscal-year-context.service';
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
        FISCAL_YEAR: 'Fiscal years',
        GENERAL_LEDGER: 'General ledger',
        JOURNALS: 'Journals',
        LETTERING: 'Lettering',
        TRIAL_BALANCE: 'Trial balance'
      },
      SIDEBAR: {
        COLLAPSE: 'Collapse sidebar',
        EXPAND: 'Expand sidebar'
      },
      TOPBAR: {
        CABINET_DASHBOARD: 'Cabinet dashboard',
        CABINET_MENU_LABEL: 'Open cabinet menu',
        CLIENT_DOSSIERS: 'Client dossiers',
        COMMAND_PLACEHOLDER: 'Search workspace or ask AI...',
        COMMAND_SHORTCUT: '⌘ K',
        CREATE_DOSSIER: 'Create dossier',
        CURRENT_MODULE: 'Current module',
        DARK_MODE: 'Switch to dark mode',
        DOSSIER: 'Active dossier',
        DOSSIER_LOADING: 'Loading dossier...',
        ACTIVE_FISCAL_YEAR: 'Active fiscal year',
        FISCAL_YEAR_SELECTOR_LABEL: 'Select active fiscal year',
        HELP: 'Help',
        LIGHT_MODE: 'Switch to light mode',
        NO_DOSSIER: 'No dossier open',
        OPEN_DOSSIER: 'Open a dossier',
        NO_WORKSPACE: 'Workspace',
        NEW_CLIENT_DOSSIER: 'New client dossier',
        PAGE_ACTIONS: 'Page actions',
        SELECT_DOSSIER: 'Select a dossier',
        SELECT_FISCAL_YEAR: 'Select fiscal year',
        SIGN_OUT: 'Sign out',
        TOGGLE_NAVIGATION: 'Toggle navigation',
        USER: 'User',
        USER_MENU: 'Open user menu',
        WORKSPACE: 'Active workspace',
        WORKSPACE_MENU_LABEL: 'Open active workspace menu',
        WORKSPACE_LOADING: 'Loading workspace...'
      },
      WORKSPACE_TYPES: {
        ACCOUNTING_FIRM: 'Accounting firm',
        COMPANY: 'Company'
      }
    },
    ACCOUNTING: {
      FISCAL_YEAR: {
        STATUS: {
          OPEN: 'Open',
          LOCKED: 'Locked',
          CLOSED: 'Closed',
          DRAFT: 'Draft'
        }
      },
      FISCAL_YEAR_CONTEXT: {
        GO_TO_FISCAL_YEARS: 'Manage fiscal years',
        NO_FISCAL_YEAR: 'No fiscal year known for this dossier.'
      }
    }
  }
};

describe('AppTopbarComponent', () => {
  let fixture: ComponentFixture<AppTopbarComponent>;
  let authStore: InstanceType<typeof AuthStore>;
  let fiscalYearContext: AccountingFiscalYearContextService;
  let uiStore: InstanceType<typeof UiStore>;
  let cabinetDossiersApi: { listDossiers: ReturnType<typeof vi.fn> };
  let router: Router;
  let workspacesApi: { listWorkspaces: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();
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
    fiscalYearContext = TestBed.inject(AccountingFiscalYearContextService);
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

  function activeWorkspaceElement(): HTMLElement {
    return fixture.nativeElement.querySelector('[data-testid="active-workspace"]');
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
    expect(text).not.toContain('Company');
    expect(text).not.toContain('org-company-123');
    expect(text).not.toContain('Workspace');
  });

  it('renders the inline workspace identity while the command search is hidden', () => {
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-company-123',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company-123'
    );

    renderText();
    const workspace = activeWorkspaceElement();
    const commandSearch = fixture.nativeElement.querySelector('[data-testid="command-search"]');

    expect(workspace).not.toBeNull();
    expect(commandSearch).toBeNull();
    expect(activeWorkspaceText()).toContain('Demo SARL');
  });

  it('renders the direct company identity without the old card styling', () => {
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-company-123',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company-123'
    );

    renderText();
    const identity = activeWorkspaceElement();

    expect(identity.textContent).toContain('Demo SARL');
    expect(identity.textContent).toContain('expand_more');
    expect(identity.className).not.toContain('border-orange');
    expect(identity.className).not.toContain('bg-slate-950');
    expect(identity.className).not.toContain('shadow-[');
    expect(identity.className).not.toContain('rounded-app-panel');
    expect(identity.querySelector('span')?.className).not.toContain('bg-orange');
    expect(identity.querySelector('span')?.className).not.toContain('text-orange');
    expect(identity.querySelector('span')?.className).toContain('text-white/90');
    expect(identity.querySelector('mat-icon')?.textContent?.trim()).toBe('corporate_fare');
  });

  it('does not render old module or mode wording in the global header', () => {
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-company-123',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company-123'
    );

    const text = renderText();

    expect(text).not.toContain('Current module');
    expect(text).not.toContain('Mode Cabinet');
    expect(text).not.toContain('Mode Entreprise');
    expect(text).not.toContain('Dashboard');
    expect(text).not.toContain('General ledger');
  });

  it('renders a visible sidebar toggle in the header', () => {
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-company-123',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company-123'
    );

    renderText();
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="sidebar-toggle"]'
    ) as HTMLButtonElement | null;

    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-label')).toBe('Collapse sidebar');
  });

  it('renders the active fiscal year selector on accounting pages', () => {
    uiStore.setCurrentPage('accounting.entries');
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-company-123',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company-123'
    );
    fiscalYearContext.selectFiscalYear({
      accountingFramework: 'SYSCOHADA_REVISED',
      endDate: '2026-12-31',
      fiscalYearId: 'FY#2026',
      startDate: '2026-01-01',
      status: 'OPEN',
      year: 2026
    });

    renderText();
    const selector = fixture.nativeElement.querySelector(
      '[data-testid="active-fiscal-year"]'
    ) as HTMLButtonElement;

    expect(selector).not.toBeNull();
    expect(selector.textContent).toContain('Active fiscal year');
    expect(selector.textContent).toContain('2026');
    expect(selector.getAttribute('aria-label')).toBe('Select active fiscal year');
  });

  it('does not render the active fiscal year selector outside accounting pages', () => {
    uiStore.setCurrentPage('dashboard');
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-company-123',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company-123'
    );

    renderText();

    expect(fixture.nativeElement.querySelector('[data-testid="active-fiscal-year"]')).toBeNull();
  });

  it('chooses an existing fiscal year from the accounting selector', () => {
    uiStore.setCurrentPage('accounting.entries');
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-company-123',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company-123'
    );
    fiscalYearContext.rememberFiscalYear({
      accountingFramework: 'SYSCOHADA_REVISED',
      endDate: '2026-12-31',
      fiscalYearId: 'FY#2026',
      startDate: '2026-01-01',
      status: 'OPEN',
      year: 2026
    });
    fiscalYearContext.rememberFiscalYear({
      accountingFramework: 'SYSCOHADA_REVISED',
      endDate: '2025-12-31',
      fiscalYearId: 'FY#2025',
      startDate: '2025-01-01',
      status: 'CLOSED',
      year: 2025
    });

    renderText();
    const selector = fixture.nativeElement.querySelector(
      '[data-testid="active-fiscal-year"]'
    ) as HTMLButtonElement;
    selector.click();
    fixture.detectChanges();
    const fiscalYearButtons = Array.from(
      fixture.nativeElement.querySelectorAll('button[role="menuitem"]')
    ) as HTMLButtonElement[];

    fiscalYearButtons.find((button) => button.textContent?.includes('2025'))?.click();
    fixture.detectChanges();

    expect(fiscalYearContext.activeYear()).toBe(2025);
  });

  it('shows only the fiscal year context card for direct company accounting pages', () => {
    uiStore.setCurrentPage('accounting.fiscalYear');
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-company-123',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company-123'
    );
    fiscalYearContext.selectFiscalYear({
      accountingFramework: 'SYSCOHADA_REVISED',
      endDate: '2026-12-31',
      fiscalYearId: 'FY#2026',
      startDate: '2026-01-01',
      status: 'OPEN',
      year: 2026
    });

    renderText();

    expect(activeWorkspaceText()).toContain('Demo SARL');
    expect(fixture.nativeElement.querySelector('[data-testid="active-fiscal-year"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="active-dossier"]')).toBeNull();
  });

  it('keeps cabinet route header global instead of rendering a module title', () => {
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

    expect(activeWorkspaceText()).toContain('Cabinet KPADONOU Conseil');
    expect(fixture.nativeElement.textContent).not.toContain('Current module');
  });

  it('displays an accounting-firm workspace name without a mode/type label', () => {
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
    expect(text).not.toContain('Accounting firm');
    expect(text).not.toContain('org-firm-123');
    expect(text).not.toContain('Workspace');
  });

  it('shows one cabinet inline identity and no standalone header quick-create button', () => {
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
    const workspaceIdentities = fixture.nativeElement.querySelectorAll('[data-testid="active-workspace"]');
    const headerButtons = Array.from(
      fixture.nativeElement.querySelectorAll('header > div > button')
    ) as HTMLButtonElement[];

    expect(workspaceIdentities).toHaveLength(1);
    expect(fixture.nativeElement.textContent).not.toContain('Mode Cabinet');
    expect(headerButtons.some((button) => button.textContent?.trim() === '+')).toBe(false);
  });

  it('renders the cabinet identity as a lightweight accessible dropdown trigger', () => {
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
    const trigger = activeWorkspaceElement() as HTMLButtonElement;

    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.textContent).toContain('Cabinet KPADONOU Conseil');
    expect(trigger.textContent).toContain('expand_more');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.className).toContain('liass-focus-ring');
    expect(trigger.className).not.toContain('border-orange');
    expect(trigger.className).not.toContain('bg-slate-950');
    expect(trigger.className).not.toContain('shadow-[');
    expect(trigger.className).not.toContain('rounded-app-panel');
    expect(trigger.querySelector('span')?.className).not.toContain('bg-orange');
    expect(trigger.querySelector('span')?.className).not.toContain('text-orange');
    expect(trigger.querySelector('span')?.className).toContain('text-white/90');
    expect(trigger.querySelector('mat-icon')?.textContent?.trim()).toBe('corporate_fare');
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

    expect(trigger.getAttribute('aria-label')).toBe('Open active workspace menu');
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
    expect(workspaceText).not.toContain('Accounting firm');
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

    expect(dossierText).toContain('Open a dossier');
    expect(dossierText).not.toContain('Select a dossier');
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
