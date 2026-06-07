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
      NAV: {
        ACCOUNTING: 'Comptabilité',
        ADMINISTRATION: 'Administration',
        CABINET_DASHBOARD: 'Tableau de bord cabinet',
        CABINET_SETTINGS: 'Paramètres du cabinet',
        CHART_OF_ACCOUNTS: 'Plan comptable',
        CLIENT_DOSSIERS: 'Dossiers clients',
        COLLABORATORS: 'Collaborateurs',
        DASHBOARD: 'Tableau de bord',
        DEADLINES: 'Échéances',
        ENTRIES: 'Écritures',
        GENERAL_LEDGER: 'Grand livre',
        JOURNALS: 'Journaux',
        MISSIONS: 'Missions',
        PROJECTS: 'Projets et fonds',
        REPORTS: 'États OHADA',
        SECTION_LABEL: 'Espace',
        SYCEBNL_BADGE: 'SYCEBNL',
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
    expect(text).toContain('Grand livre');
    expect(text).toContain('Journaux');
    expect(text).toContain('Écritures');
    expect(text).toContain('Balance');
    expect(text).toContain('Plan comptable');
    expect(text).toContain('Projets et fonds');
    expect(text).toContain('Trésorerie');
    expect(text).toContain('États OHADA');
    expect(text).toContain('Administration');
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
    expect(text).not.toContain('Journaux');
    expect(text).not.toContain('Écritures');
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

    expect(text).toContain('Grand livre');
    expect(text).toContain('Journaux');
    expect(text).toContain('Écritures');
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
    expect(authStore.activeDossierOrgId()).toBe('org-client');
  });
});
