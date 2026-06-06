import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { vi } from 'vitest';

import { AuthStore } from '../../data-access/auth.store';
import { CabinetDossiersApi } from '../../data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../data-access/workspaces.api';
import { CabinetDossiersPage } from './cabinet-dossiers.page';

const translations = {
  en: {
    IDENTITY: {
      CABINET_DASHBOARD: {
        LOADING: 'Loading client dossiers...',
        EMPTY_TITLE: 'No client dossier yet',
        EMPTY_SUBTITLE: 'Create the first client dossier.',
        STATUS: {
          ACTIVE: 'Active',
          UNKNOWN: 'Unknown'
        },
        ACTIONS: {
          CREATE_FIRST_DOSSIER: 'Create your first client dossier',
          NEW_DOSSIER: 'New dossier'
        }
      },
      CABINET_DOSSIERS: {
        ACTIONS: {
          BACK: 'Back to dossiers',
          CREATE: 'Create dossier',
          CREATING: 'Creating dossier...',
          NEW: 'New dossier'
        },
        EYEBROW: 'Client dossiers',
        FIELDS: {
          ACCOUNTING_FRAMEWORK: 'Accounting framework',
          COMPANY_NAME: 'Client company name',
          COUNTRY: 'Country'
        },
        FORM_SUBTITLE: 'These details create a client dossier.',
        FORM_TITLE: 'Dossier information',
        LIST_TITLE: 'Client dossiers',
        LIST_SUBTITLE: 'Choose the client company.',
        NEW_SUBTITLE: 'Add the client company your accounting firm will manage.',
        NEW_TITLE: 'New client dossier',
        VALIDATION: {
          COMPANY_NAME: 'Enter the client company name.'
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
    }
  }
};

describe('CabinetDossiersPage', () => {
  let fixture: ComponentFixture<CabinetDossiersPage>;
  let cabinetDossiersApi: { listDossiers: ReturnType<typeof vi.fn> };
  let router: Router;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();
    cabinetDossiersApi = { listDossiers: vi.fn().mockResolvedValue([]) };

    await TestBed.configureTestingModule({
      imports: [
        CabinetDossiersPage,
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

  it('renders the empty state with the first-dossier call to action', async () => {
    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-firm'
    );

    fixture = TestBed.createComponent(CabinetDossiersPage);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No client dossier yet');
    expect(fixture.nativeElement.textContent).toContain('Create your first client dossier');
  });

  it('selects a dossier without replacing the active cabinet workspace', async () => {
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

    fixture = TestBed.createComponent(CabinetDossiersPage);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    buttons.find((button) => button.textContent?.includes('Client SARL'))?.click();

    expect(authStore.activeWorkspaceOrgId()).toBe('org-firm');
    expect(authStore.activeDossierOrgId()).toBe('org-client');
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard'], { replaceUrl: true });
  });
});
