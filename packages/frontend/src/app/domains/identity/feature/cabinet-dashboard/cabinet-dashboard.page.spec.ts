import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { vi } from 'vitest';

import { AuthStore } from '../../data-access/auth.store';
import { CabinetDossiersApi } from '../../data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../data-access/workspaces.api';
import { CabinetDashboardPage } from './cabinet-dashboard.page';

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
    IDENTITY: {
      CABINET_DASHBOARD: {
        EYEBROW: 'Accounting firm workspace',
        TITLE: 'Cabinet dashboard',
        SUBTITLE: 'Manage client dossiers.',
        FALLBACK_CABINET_NAME: 'Accounting firm',
        WORKSPACE_TYPE: 'Workspace type',
        CONNECTED_USER: 'Connected user',
        OPEN_DOSSIER_LABEL: 'Open dossier',
        CONTEXT_TITLE: 'Cabinet context',
        CONTEXT_DESCRIPTION: 'Cabinet actions use the accounting-firm workspace.',
        CONTEXT_HINT: 'The cabinet remains the management context.',
        CONTEXT_ITEM_CABINET: 'Manage the accounting firm and client dossiers',
        CONTEXT_ITEM_DOSSIERS: 'Open a dossier explicitly before accounting modules',
        RECENT_DOSSIERS_TITLE: 'Recently opened dossiers',
        RECENT_DOSSIERS_SUBTITLE: 'Open a client dossier.',
        LOADING: 'Loading client dossiers...',
        EMPTY_TITLE: 'No client dossier yet',
        EMPTY_SUBTITLE: 'Create the first client dossier.',
        COLLABORATORS_TITLE: 'Collaborators',
        COLLABORATORS_PLACEHOLDER: 'Collaborator placeholder.',
        MISSIONS_TITLE: 'Missions',
        MISSIONS_PLACEHOLDER: 'Mission placeholder.',
        DEADLINES_TITLE: 'Deadlines',
        DEADLINES_PLACEHOLDER: 'Deadline placeholder.',
        METRICS: {
          ACTIVE_DOSSIERS: 'Active dossiers',
          COLLABORATORS: 'Collaborators',
          PENDING_TASKS: 'Pending tasks',
          TOTAL_DOSSIERS: 'Total dossiers',
          UPCOMING_DEADLINES: 'Upcoming deadlines'
        },
        METRICS_META: {
          ACTIVE_DOSSIERS: 'Dossiers available for accounting modules.',
          COLLABORATORS: 'Cabinet staffing view to connect.',
          PENDING_TASKS: 'Cabinet tasks to connect.',
          TOTAL_DOSSIERS: 'Client portfolio attached to the firm.',
          UPCOMING_DEADLINES: 'Cabinet deadlines to connect.'
        },
        PLACEHOLDERS: {
          NO_DEADLINE: 'No deadline connected',
          NO_MISSION: 'No mission connected',
          PRIMARY_CONTACT: 'Cabinet lead',
          ROADMAP: 'Coming soon'
        },
        STATUS: {
          ACTIVE: 'Active',
          UNKNOWN: 'Unknown'
        },
        ACTIONS: {
          CREATE_FIRST_DOSSIER: 'Create your first client dossier',
          NEW_DOSSIER: 'New dossier',
          VIEW_DOSSIERS: 'View dossiers'
        },
        ERRORS: {
          LOAD_FAILED: 'Client dossiers could not be loaded. Please retry.'
        }
      },
      ONBOARDING: {
        COUNTRIES: {
          BENIN: 'Benin'
        },
        FRAMEWORKS: {
          SYSCOHADA_REVISED: 'Revised SYSCOHADA'
        }
      }
    },
    SHELL: {
      TOPBAR: {
        NO_DOSSIER: 'No dossier open',
        USER: 'User'
      },
      WORKSPACE_TYPES: {
        ACCOUNTING_FIRM: 'Accounting firm'
      }
    }
  }
};

describe('CabinetDashboardPage', () => {
  let fixture: ComponentFixture<CabinetDashboardPage>;
  let cabinetDossiersApi: { listDossiers: ReturnType<typeof vi.fn> };
  let router: Router;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();
    cabinetDossiersApi = { listDossiers: vi.fn().mockResolvedValue([]) };

    await TestBed.configureTestingModule({
      imports: [
        CabinetDashboardPage,
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
        { provide: CabinetDossiersApi, useValue: cabinetDossiersApi },
        { provide: WorkspacesApi, useValue: { listWorkspaces: vi.fn().mockResolvedValue([]) } },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  it('loads and renders cabinet client dossiers', async () => {
    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-firm'
    );
    cabinetDossiersApi.listDossiers.mockResolvedValue([
      {
        orgId: 'org-client',
        displayName: 'Client SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      }
    ]);

    fixture = TestBed.createComponent(CabinetDashboardPage);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();

    expect(cabinetDossiersApi.listDossiers).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Cabinet Demo');
    expect(fixture.nativeElement.textContent).toContain('Accounting firm');
    expect(fixture.nativeElement.textContent).toContain('Open dossier');
    expect(fixture.nativeElement.textContent).toContain('No dossier open');
    expect(fixture.nativeElement.textContent).toContain('Total dossiers');
    expect(fixture.nativeElement.textContent).toContain('Active dossiers');
    expect(fixture.nativeElement.textContent).toContain('Client portfolio attached to the firm.');
    expect(fixture.nativeElement.textContent).toContain('Cabinet lead');
    expect(fixture.nativeElement.textContent).toContain('Client SARL');
    expect(fixture.nativeElement.textContent).toContain('Benin');
    expect(fixture.nativeElement.textContent).toContain('Revised SYSCOHADA');
    expect(fixture.nativeElement.textContent).not.toContain('org-firm');
  });

  it('selects a dossier before opening the standard dashboard', async () => {
    const authStore = TestBed.inject(AuthStore);
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-firm'
    );
    cabinetDossiersApi.listDossiers.mockResolvedValue([
      {
        orgId: 'org-client',
        displayName: 'Client SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      }
    ]);

    fixture = TestBed.createComponent(CabinetDashboardPage);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    buttons.find((button) => button.textContent?.includes('Client SARL'))?.click();

    expect(authStore.activeWorkspaceOrgId()).toBe('org-firm');
    expect(authStore.activeDossierOrgId()).toBe('org-client');
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard'], { replaceUrl: true });
  });

  it('routes new dossier creation to the dialog deep link on the dossiers page', async () => {
    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-firm'
    );

    fixture = TestBed.createComponent(CabinetDashboardPage);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    buttons.find((button) => button.textContent?.includes('New dossier'))?.click();

    expect(router.navigate).toHaveBeenCalledWith(['/cabinet/dossiers'], {
      queryParams: { createDossier: '1' }
    });
  });
});
