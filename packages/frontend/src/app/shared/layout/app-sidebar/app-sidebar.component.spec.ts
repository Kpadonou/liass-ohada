import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { vi } from 'vitest';

import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { CabinetDossiersApi } from '../../../domains/identity/data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../../domains/identity/data-access/workspaces.api';
import { UiStore } from '../../../core/state/ui.store';
import { AppSidebarComponent } from './app-sidebar.component';

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
  fr: {
    SHELL: {
      AI_PANEL: {
        EYEBROW: 'IA native',
        TEXT: 'Les suggestions comptables restent limitées.'
      },
      BRAND_TAGLINE: 'Poste ERP',
      LOGO_ALT: 'logo liass-ohada',
      SIDEBAR: {
        COLLAPSE: 'Réduire la barre latérale',
        EXPAND: 'Déployer la barre latérale',
        NAVIGATION_LABEL: 'Navigation principale'
      },
      NAV: {
        ACCOUNTING: 'Comptabilité',
        ACCOUNTING_OVERVIEW: 'Vue d’ensemble',
        ADMINISTRATION: 'Administration',
        CABINET_DASHBOARD: 'Tableau de bord cabinet',
        CABINET_SETTINGS: 'Paramètres du cabinet',
        CHART_OF_ACCOUNTS: 'Plan comptable',
        CLIENT_DOSSIERS: 'Dossiers clients',
        COLLABORATORS: 'Collaborateurs',
        DASHBOARD: 'Tableau de bord',
        DEADLINES: 'Échéances',
        ENTRIES: 'Écritures',
        FISCAL_YEAR: 'Exercices',
        GENERAL_LEDGER: 'Grand livre',
        AUXILIARY_LEDGER: 'Grand livre auxiliaire',
        AUXILIARY_BALANCE: 'Balance auxiliaire',
        JOURNALS: 'Journaux',
        LETTERING: 'Lettrage',
        MISSIONS: 'Missions',
        PROJECTS: 'Projets et fonds',
        REPORTS: 'États OHADA',
        SECTION_LABEL: 'Espace',
        SYCEBNL_BADGE: 'SYCEBNL',
        THIRD_PARTIES: 'Tiers',
        TREASURY: 'Trésorerie',
        TEAM: 'Équipe',
        TRIAL_BALANCE: 'Balance'
      }
    }
  }
};

describe('AppSidebarComponent', () => {
  let fixture: ComponentFixture<AppSidebarComponent>;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [
        AppSidebarComponent,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: {
            availableLangs: ['fr'],
            defaultLang: 'fr'
          }
        })
      ],
      providers: [
        provideRouter([]),
        { provide: WorkspacesApi, useValue: { listWorkspaces: () => Promise.resolve([]) } },
        { provide: CabinetDossiersApi, useValue: { listDossiers: () => Promise.resolve([]) } }
      ]
    }).compileComponents();
  });

  it('renders the requested French navigation structure', () => {
    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-company',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company'
    );
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Tableau de bord');
    expect(text).toContain('Comptabilité');
    expect(text).toContain('Vue d’ensemble');
    expect(text).toContain('Exercices');
    expect(text).toContain('Grand livre');
    expect(text).toContain('Grand livre auxiliaire');
    expect(text).toContain('Balance auxiliaire');
    expect(text).toContain('Journaux');
    expect(text).toContain('Tiers');
    expect(text).toContain('Écritures');
    expect(text).toContain('Lettrage');
    expect(text).toContain('Balance');
    expect(text).not.toContain('Reporting simplifié');
    expect(text).toContain('Plan comptable');
    expect(text).toContain('Projets et fonds');
    expect(text).toContain('Trésorerie');
    expect(text).toContain('États OHADA');
    expect(text).toContain('Administration');
    expect(text).not.toContain('POSTE ERP');
    expect(text).not.toContain('Poste ERP');
    expect(text).not.toContain('ESPACE');
  });

  it('collapses the desktop sidebar into an accessible icon rail', () => {
    const uiStore = TestBed.inject(UiStore);
    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-company',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company'
    );
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();

    uiStore.setSidebarCollapsed(true);
    fixture.detectChanges();

    const sidebar = fixture.nativeElement.querySelector('aside') as HTMLElement;
    const dashboardButton = fixture.nativeElement.querySelector(
      'liass-sidebar-nav-item button[aria-label="Tableau de bord"]'
    ) as HTMLButtonElement | null;
    const dashboardLabel = dashboardButton?.querySelector('span:nth-child(2)') as HTMLElement | null;
    const aiPanel = fixture.nativeElement.querySelector(
      '[data-testid="sidebar-ai-panel"]'
    ) as HTMLElement | null;

    expect(uiStore.sidebarCollapsed()).toBe(true);
    expect(localStorage.getItem('liass-ohada.sidebarCollapsed')).toBe('true');
    expect(sidebar.className).toContain('lg:w-[var(--spacing-shell-sidebar-collapsed)]');
    expect(dashboardButton).not.toBeNull();
    expect(dashboardLabel?.className).toContain('lg:sr-only');
    expect(aiPanel?.className).toContain('lg:hidden');
  });

  it('shows cabinet navigation and hides standard accounting navigation without an active dossier', () => {
    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM',
        cabinetRole: 'CABINET_ADMIN',
        status: 'ACTIVE'
      },
      'org-firm'
    );
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Tableau de bord cabinet');
    expect(text).toContain('Dossiers clients');
    expect(text).toContain('Équipe');
    expect(text).toContain('Missions');
    expect(text).toContain('Échéances');
    expect(text).toContain('Paramètres du cabinet');
    expect(text).not.toContain('Grand livre');
    expect(text).not.toContain('Balance auxiliaire');
    expect(text).not.toContain('Vue d’ensemble');
    expect(text).not.toContain('Exercices');
    expect(text).not.toContain('Journaux');
    expect(text).not.toContain('Tiers');
    expect(text).not.toContain('Écritures');
    expect(text).not.toContain('Lettrage');
    expect(text).not.toContain('Balance');
    expect(text).not.toContain('Reporting simplifié');
    expect(text).not.toContain('Plan comptable');
    expect(text).not.toContain('Trésorerie');
    expect(text).not.toContain('États OHADA');
    expect(text).not.toContain('Projets et fonds');
  });

  it('hides Team navigation from Collaborators in Cabinet context', () => {
    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM',
        cabinetRole: 'COLLABORATOR',
        status: 'ACTIVE'
      },
      'org-firm'
    );
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Équipe');
    expect(fixture.nativeElement.textContent).not.toContain('Paramètres du cabinet');
  });

  it.each(['SUPERVISOR', 'READER'] as const)(
    'hides Cabinet Settings navigation from %s',
    (cabinetRole) => {
      TestBed.inject(AuthStore).setCreatedWorkspace(
        {
          orgId: 'org-firm',
          displayName: 'Cabinet Demo',
          workspaceType: 'ACCOUNTING_FIRM',
          cabinetRole,
          status: 'ACTIVE'
        },
        'org-firm'
      );
      fixture = TestBed.createComponent(AppSidebarComponent);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('Paramètres du cabinet');
    }
  );

  it('restores standard accounting navigation after a cabinet dossier is selected', () => {
    const authStore = TestBed.inject(AuthStore);
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-firm'
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
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Vue d’ensemble');
    expect(text).toContain('Grand livre');
    expect(text).toContain('Balance auxiliaire');
    expect(text).toContain('Exercices');
    expect(text).toContain('Journaux');
    expect(text).toContain('Tiers');
    expect(text).toContain('Écritures');
    expect(text).toContain('Lettrage');
    expect(text).toContain('Balance');
    expect(text).not.toContain('Reporting simplifié');
    expect(text).toContain('Plan comptable');
    expect(text).not.toContain('Paramètres du cabinet');
  });

  it('routes the single overview sidebar item to /accounting without a duplicate active item', () => {
    const authStore = TestBed.inject(AuthStore);
    const uiStore = TestBed.inject(UiStore);
    const router = TestBed.inject(Router);
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-company',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company'
    );
    uiStore.setCurrentPage('accounting.overview');
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(false);
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();

    const overviewButton = fixture.nativeElement.querySelector(
      'liass-sidebar-nav-item button[aria-label="Vue d’ensemble"]'
    ) as HTMLButtonElement;
    overviewButton.click();
    fixture.detectChanges();
    const activeButtons = Array.from(
      fixture.nativeElement.querySelectorAll('liass-sidebar-nav-item button')
    ).filter((button) => (button as HTMLButtonElement).className.includes('bg-brand-50'));

    expect(router.navigateByUrl).toHaveBeenCalledWith('/accounting');
    expect(uiStore.currentPage()).toBe('accounting.overview');
    expect(activeButtons).toHaveLength(1);
    expect((activeButtons[0] as HTMLButtonElement).getAttribute('aria-label')).toBe('Vue d’ensemble');
    expect(fixture.nativeElement.textContent).not.toContain('Reporting simplifié');
  });

  it('marks a target page active immediately while routing to the requested URL', () => {
    const authStore = TestBed.inject(AuthStore);
    const uiStore = TestBed.inject(UiStore);
    const router = TestBed.inject(Router);
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-company',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company'
    );
    uiStore.setCurrentPage('accounting.overview');
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(false);
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();

    const auxiliaryBalanceButton = fixture.nativeElement.querySelector(
      'liass-sidebar-nav-item button[aria-label="Balance auxiliaire"]'
    ) as HTMLButtonElement;
    auxiliaryBalanceButton.click();
    fixture.detectChanges();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/accounting/auxiliary-balance');
    expect(uiStore.currentPage()).toBe('accounting.auxiliaryBalance');
  });

  it('shows cabinet navigation after entering a cabinet route clears the selected dossier', () => {
    const authStore = TestBed.inject(AuthStore);
    TestBed.inject(UiStore).setCurrentPage('cabinet.dossiers');
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-firm'
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
    authStore.enterCabinetContext();

    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Tableau de bord cabinet');
    expect(text).toContain('Dossiers clients');
    expect(text).not.toContain('Grand livre');
    expect(text).not.toContain('Balance auxiliaire');
    expect(text).not.toContain('Tiers');
    expect(text).not.toContain('Lettrage');
    expect(authStore.activeDossierOrgId()).toBeNull();
  });
});
