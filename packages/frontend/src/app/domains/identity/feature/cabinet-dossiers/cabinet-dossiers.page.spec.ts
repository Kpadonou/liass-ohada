import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';

import { AuthStore } from '../../data-access/auth.store';
import { CabinetDossiersApi } from '../../data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../data-access/workspaces.api';
import { CabinetDossiersPage } from './cabinet-dossiers.page';

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
    COMMON: {
      SELECT: {
        NO_RESULTS: 'No results',
        SEARCH_PLACEHOLDER: 'Search...'
      }
    },
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
          CANCEL: 'Cancel',
          CLEAR_FILTERS: 'Reset',
          CREATE: 'Create dossier',
          CREATING: 'Creating dossier...',
          NEW: 'New dossier',
          OPEN: 'Open'
        },
        EYEBROW: 'Client dossiers',
        ERRORS: {
          CREATE_FAILED: 'Client dossier creation could not finish. Please retry.',
          DUPLICATE: 'This client dossier already exists.',
          LOAD_FAILED: 'Client dossiers could not be loaded. Please retry.',
          NETWORK: 'The client dossier could not be created because the network connection failed.',
          VALIDATION: 'The client dossier response could not be verified. Please retry.'
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
        DIALOG: {
          REDIRECTING: 'Opening the creation form...',
          SUBTITLE: 'Create a client dossier attached to the active accounting firm.',
          TITLE: 'New client dossier'
        },
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
  let cabinetDossiersApi: {
    createDossier: ReturnType<typeof vi.fn>;
    listDossiers: ReturnType<typeof vi.fn>;
  };
  let queryParamMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let router: Router;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();
    cabinetDossiersApi = {
      createDossier: vi.fn(),
      listDossiers: vi.fn().mockResolvedValue([])
    };
    queryParamMap$ = new BehaviorSubject(convertToParamMap({}));

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
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: queryParamMap$.asObservable()
          }
        },
        { provide: CabinetDossiersApi, useValue: cabinetDossiersApi },
        { provide: WorkspacesApi, useValue: { listWorkspaces: vi.fn().mockResolvedValue([]) } },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    document.querySelectorAll('.cdk-overlay-container').forEach((container) => container.remove());
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

  it('opens the create dossier dialog from the primary action on the same page', async () => {
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
    clickButtonContaining(fixture.nativeElement, 'New dossier');
    fixture.detectChanges();

    expect(document.body.textContent).toContain('New client dossier');
    expect(document.body.textContent).toContain(
      'Create a client dossier attached to the active accounting firm.'
    );
    expect(document.body.querySelector('liass-searchable-select input')).toBeTruthy();
    expect(document.body.querySelector('mat-select[formControlName="country"]')).toBeNull();
    expect(
      document.body.querySelector('mat-select[formControlName="accountingFramework"]')
    ).toBeTruthy();
    expect(router.navigate).not.toHaveBeenCalledWith(['/cabinet/dossiers/new']);
  });

  it('opens the create dossier dialog from the createDossier query parameter', async () => {
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
    queryParamMap$.next(convertToParamMap({ createDossier: '1' }));
    fixture.detectChanges();

    expect(document.body.textContent).toContain('New client dossier');
  });

  it('blocks empty create submits with field validation', async () => {
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
    clickButtonContaining(fixture.nativeElement, 'New dossier');
    fixture.detectChanges();
    clickButtonContaining(document.body, 'Create dossier');
    fixture.detectChanges();

    expect(cabinetDossiersApi.createDossier).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('New client dossier');
  });

  it('creates a dossier from the dialog without changing the active tenant or opening it', async () => {
    const authStore = TestBed.inject(AuthStore);
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-firm'
    );
    cabinetDossiersApi.createDossier.mockResolvedValue({
      dossier: {
        orgId: 'org-created',
        displayName: 'Created Client SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      }
    });

    fixture = TestBed.createComponent(CabinetDossiersPage);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    clickButtonContaining(fixture.nativeElement, 'New dossier');
    fixture.detectChanges();
    const companyInput = document.body.querySelector(
      'input[autocomplete="organization"]'
    ) as HTMLInputElement;
    companyInput.value = 'Created Client SARL';
    companyInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    clickButtonContaining(document.body, 'Create dossier');
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 300));
    fixture.detectChanges();

    expect(cabinetDossiersApi.createDossier).toHaveBeenCalledWith({
      accountingFramework: 'SYSCOHADA_REVISED',
      companyName: 'Created Client SARL',
      country: 'BJ'
    });
    expect(cabinetDossiersApi.createDossier.mock.calls[0]?.[0]).not.toHaveProperty('orgId');
    expect(cabinetDossiersApi.createDossier.mock.calls[0]?.[0]).not.toHaveProperty('userId');
    expect(cabinetDossiersApi.createDossier.mock.calls[0]?.[0]).not.toHaveProperty('cabinetId');
    expect(cabinetDossiersApi.createDossier.mock.calls[0]?.[0]).not.toHaveProperty('role');
    expect(authStore.activeWorkspaceOrgId()).toBe('org-firm');
    expect(authStore.activeDossierOrgId()).toBeNull();
    expect(authStore.dossiers().map((dossier) => dossier.displayName)).toContain(
      'Created Client SARL'
    );
    expect(router.navigate).not.toHaveBeenCalledWith(['/dashboard'], { replaceUrl: true });
    expect(TestBed.inject(MatDialog).openDialogs.length).toBe(0);
  });

  it('keeps the dialog open and shows an error when creation fails', async () => {
    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-firm'
    );
    cabinetDossiersApi.createDossier.mockRejectedValue(new Error('boom'));

    fixture = TestBed.createComponent(CabinetDossiersPage);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    clickButtonContaining(fixture.nativeElement, 'New dossier');
    fixture.detectChanges();
    const companyInput = document.body.querySelector(
      'input[autocomplete="organization"]'
    ) as HTMLInputElement;
    companyInput.value = 'Failed Client SARL';
    companyInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    clickButtonContaining(document.body, 'Create dossier');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(document.body.textContent).toContain('New client dossier');
    expect(document.body.textContent).toContain('Client dossier creation could not finish.');
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
    await fixture.whenStable();

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

function clickButtonContaining(root: ParentNode, label: string): void {
  const button = Array.from(root.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(label)
  ) as HTMLButtonElement | undefined;

  if (!button) {
    throw new Error(`Could not find button containing "${label}"`);
  }

  button.click();
}
