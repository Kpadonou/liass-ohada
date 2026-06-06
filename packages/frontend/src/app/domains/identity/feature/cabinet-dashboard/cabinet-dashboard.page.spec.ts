import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { vi } from 'vitest';

import { AuthStore } from '../../data-access/auth.store';
import { CabinetDossiersApi } from '../../data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../data-access/workspaces.api';
import { CabinetDashboardPage } from './cabinet-dashboard.page';

const translations = {
  en: {
    IDENTITY: {
      CABINET_DASHBOARD: {
        EYEBROW: 'Accounting firm workspace',
        TITLE: 'Cabinet dashboard',
        SUBTITLE: 'Manage client dossiers.',
        DOSSIERS_TITLE: 'Client dossiers',
        DOSSIERS_SUBTITLE: 'Select a client dossier.',
        LOADING: 'Loading client dossiers...',
        EMPTY_TITLE: 'No client dossier yet',
        EMPTY_SUBTITLE: 'Create the first client dossier.',
        CABINET_CONTEXT: 'Cabinet context',
        ACTIVE_WORKSPACE: 'Cabinet workspace:',
        ACTIVE_DOSSIER: 'Selected client dossier:',
        ACTIONS: {
          NEW_DOSSIER: 'New dossier'
        }
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
    expect(fixture.nativeElement.textContent).toContain('Client SARL');
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
    fixture.nativeElement.querySelectorAll('button')[1].click();

    expect(authStore.activeWorkspaceOrgId()).toBe('org-firm');
    expect(authStore.activeDossierOrgId()).toBe('org-client');
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard'], { replaceUrl: true });
  });
});
