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
          CLEAR_FILTERS: 'Reset',
          CREATE: 'Create dossier',
          CREATING: 'Creating dossier...',
          NEW: 'New dossier',
          OPEN: 'Open'
        },
        EYEBROW: 'Client dossiers',
        ERRORS: {
          LOAD_FAILED: 'Client dossiers could not be loaded. Please retry.'
        },
        FIELDS: {
          ACCOUNTING_FRAMEWORK: 'Accounting framework',
          COMPANY_NAME: 'Client company name',
          COUNTRY: 'Country'
        },
        FILTERS: {
          SEARCH_LABEL: 'Search',
          SEARCH_PLACEHOLDER: 'Name, country, or framework',
          STATUS_ACTIVE: 'Active',
          STATUS_ALL: 'All statuses',
          STATUS_LABEL: 'Status'
        },
        FORM_SUBTITLE: 'These details create a client dossier.',
        FORM_TITLE: 'Dossier information',
        LIST_TITLE: 'Client dossiers',
        LIST_SUBTITLE: 'Choose the client company.',
        METRICS: {
          ACTIVE: 'Active dossiers',
          TOTAL: 'Total dossiers',
          VISIBLE: 'Visible dossiers'
        },
        NEW_SUBTITLE: 'Add the client company your accounting firm will manage.',
        NEW_TITLE: 'New client dossier',
        NO_RESULTS: {
          TITLE: 'No dossier matches these filters',
          SUBTITLE: 'Adjust the search or reset filters to find your client dossiers.'
        },
        RESULTS: {
          FILTERED: 'Filters active',
          SUMMARY: '{{ visible }} dossier(s) shown out of {{ total }}'
        },
        TABLE: {
          ACTIONS: 'Action',
          COMPANY: 'Client company',
          COUNTRY: 'Country',
          DESCRIPTION: 'Search, filter, and open the client dossier you need to work on.',
          FRAMEWORK: 'Framework',
          STATUS: 'Status',
          TITLE: 'Client dossier list'
        },
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
    buttons.find((button) => button.textContent?.includes('Open'))?.click();

    expect(authStore.activeWorkspaceOrgId()).toBe('org-firm');
    expect(authStore.activeDossierOrgId()).toBe('org-client');
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard'], { replaceUrl: true });
  });

  it('renders a table-oriented dossier list with human-readable dossier data', async () => {
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

    fixture = TestBed.createComponent(CabinetDossiersPage);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Client dossier list');
    expect(text).toContain('Client SARL');
    expect(text).toContain('Benin');
    expect(text).toContain('Revised SYSCOHADA');
    expect(text).toContain('Active');
    expect(text).not.toContain('org-client');
  });

  it('filters dossiers and shows a no-results state', async () => {
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
        orgId: 'org-client-a',
        displayName: 'Client SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      },
      {
        orgId: 'org-client-b',
        displayName: 'Finance Conseil',
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

    const searchInput = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    searchInput.value = 'missing';
    searchInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No dossier matches these filters');
    expect(fixture.nativeElement.textContent).toContain('Reset');
  });
});
