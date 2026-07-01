import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
        EXPAND: 'Déployer la barre latérale'
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
    expect(text).toContain('Plan comptable');
    expect(text).toContain('Projets et fonds');
    expect(text).toContain('Trésorerie');
    expect(text).toContain('États OHADA');
    expect(text).toContain('Administration');
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

    const collapseButton = fixture.nativeElement.querySelector(
      'button[aria-label="Réduire la barre latérale"]'
    ) as HTMLButtonElement | null;
    collapseButton?.click();
    fixture.detectChanges();

    const sidebar = fixture.nativeElement.querySelector('aside') as HTMLElement;
    const dashboardButton = fixture.nativeElement.querySelector(
      'liass-sidebar-nav-item button[aria-label="Tableau de bord"]'
    ) as HTMLButtonElement | null;
    const aiPanel = fixture.nativeElement.querySelector(
      '[data-testid="sidebar-ai-panel"]'
    ) as HTMLElement | null;

    expect(uiStore.sidebarCollapsed()).toBe(true);
    expect(localStorage.getItem('liass-ohada.sidebarCollapsed')).toBe('true');
    expect(sidebar.className).toContain('lg:w-[var(--spacing-shell-sidebar-collapsed)]');
    expect(dashboardButton).not.toBeNull();
    expect(aiPanel?.className).toContain('lg:hidden');
  });

  it('shows cabinet navigation and hides standard accounting navigation without an active dossier', () => {
    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-firm'
    );
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Tableau de bord cabinet');
    expect(text).toContain('Dossiers clients');
    expect(text).toContain('Collaborateurs');
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
    expect(text).not.toContain('Plan comptable');
    expect(text).not.toContain('Trésorerie');
    expect(text).not.toContain('États OHADA');
    expect(text).not.toContain('Projets et fonds');
  });

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
    expect(text).toContain('Plan comptable');
    expect(text).not.toContain('Paramètres du cabinet');
  });

  it('shows cabinet navigation on cabinet routes even when a dossier remains selected', () => {
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

    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Tableau de bord cabinet');
    expect(text).toContain('Dossiers clients');
    expect(text).not.toContain('Grand livre');
    expect(text).not.toContain('Balance auxiliaire');
    expect(text).not.toContain('Tiers');
    expect(text).not.toContain('Lettrage');
    expect(authStore.activeDossierOrgId()).toBe('org-client');
  });
});
