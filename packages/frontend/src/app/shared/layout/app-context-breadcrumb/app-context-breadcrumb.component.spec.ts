import { Router, provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@ngneat/transloco';

import { UiStore } from '../../../core/state/ui.store';
import { CabinetDossiersApi } from '../../../domains/identity/data-access/cabinet-dossiers.api';
import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { WorkspacesApi } from '../../../domains/identity/data-access/workspaces.api';
import { AppContextBreadcrumbComponent } from './app-context-breadcrumb.component';

describe('AppContextBreadcrumbComponent', () => {
  let fixture: ComponentFixture<AppContextBreadcrumbComponent>;
  let authStore: InstanceType<typeof AuthStore>;
  let uiStore: InstanceType<typeof UiStore>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        AppContextBreadcrumbComponent,
        TranslocoTestingModule.forRoot({
          langs: {
            en: {
              RESTAURANTS: {
                UX: {
                  PAGES: {
                    table: { TITLE: 'Tables' },
                    menu: { TITLE: 'Menu' },
                    overview: { TITLE: 'Dashboard' },
                  },
                },
              },
              SHELL: {
                NAV: { RESTAURANTS: 'Liass-Resto', SALES: 'Sales' },
                BREADCRUMB_LABEL: 'Active context breadcrumb',
                PAGES: {
                  DASHBOARD: 'Dashboard',
                  CABINET_DASHBOARD: 'Cabinet dashboard',
                  CABINET_COLLABORATORS: 'Team',
                  CABINET_SETTINGS: 'Cabinet settings',
                  GENERAL_LEDGER: 'General ledger',
                },
              },
            },
          },
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
        }),
      ],
      providers: [
        provideRouter([]),
        { provide: WorkspacesApi, useValue: { listWorkspaces: () => Promise.resolve([]) } },
        { provide: CabinetDossiersApi, useValue: { listDossiers: () => Promise.resolve([]) } },
      ],
    }).compileComponents();

    authStore = TestBed.inject(AuthStore);
    uiStore = TestBed.inject(UiStore);
  });

  it('renders cabinet, dossier, and current accounting page without mixing cabinet navigation', () => {
    authStore.setCreatedWorkspace(
      { orgId: 'org-firm', displayName: 'Cabinet Conseil', workspaceType: 'ACCOUNTING_FIRM' },
      'org-firm',
    );
    authStore.setCreatedDossier(
      {
        orgId: 'org-client',
        displayName: 'Dona Shop',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z',
      },
      'org-client',
    );
    uiStore.setCurrentPage('accounting.generalLedger');

    fixture = TestBed.createComponent(AppContextBreadcrumbComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Cabinet Conseil');
    expect(fixture.nativeElement.textContent).toContain('Dona Shop');
    expect(fixture.nativeElement.textContent).toContain('General ledger');
    expect(fixture.nativeElement.textContent).not.toContain('Cabinet dashboard');
  });

  it('drops the dossier segment immediately when returning to cabinet context', () => {
    authStore.setCreatedWorkspace(
      { orgId: 'org-firm', displayName: 'Cabinet Conseil', workspaceType: 'ACCOUNTING_FIRM' },
      'org-firm',
    );
    authStore.setCreatedDossier(
      {
        orgId: 'org-client',
        displayName: 'Dona Shop',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z',
      },
      'org-client',
    );
    authStore.enterCabinetContext();
    uiStore.setCurrentPage('cabinet.dashboard');

    fixture = TestBed.createComponent(AppContextBreadcrumbComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Cabinet Conseil');
    expect(fixture.nativeElement.textContent).toContain('Cabinet dashboard');
    expect(fixture.nativeElement.textContent).not.toContain('Dona Shop');
  });

  it('renders the Team breadcrumb for the cabinet Team page', () => {
    authStore.setCreatedWorkspace(
      { orgId: 'org-firm', displayName: 'CLO Comptabilite', workspaceType: 'ACCOUNTING_FIRM' },
      'org-firm',
    );
    authStore.enterCabinetContext();
    uiStore.setCurrentPage('cabinet.team');

    fixture = TestBed.createComponent(AppContextBreadcrumbComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('CLO Comptabilite');
    expect(fixture.nativeElement.textContent).toContain('Team');
    expect(fixture.nativeElement.textContent).not.toContain('Cabinet dashboard');
  });

  it('renders the dynamic Cabinet name and Settings page only', () => {
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet Nouvelle Donne',
        workspaceType: 'ACCOUNTING_FIRM',
      },
      'org-firm',
    );
    authStore.enterCabinetContext();
    uiStore.setCurrentPage('cabinet.settings');

    fixture = TestBed.createComponent(AppContextBreadcrumbComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Cabinet Nouvelle Donne');
    expect(fixture.nativeElement.textContent).toContain('Cabinet settings');
    expect(fixture.nativeElement.textContent).not.toContain('Cabinet dashboard');
    expect(fixture.nativeElement.textContent).not.toContain('org-firm');
  });
  it('uses Dashboard for the restaurant landing breadcrumb', () => {
    vi.spyOn(TestBed.inject(Router), 'url', 'get').mockReturnValue('/restaurants');
    authStore.setCreatedWorkspace(
      { orgId: 'beta', displayName: 'BETA', workspaceType: 'COMPANY' },
      'beta',
    );
    uiStore.setCurrentPage('restaurants');
    fixture = TestBed.createComponent(AppContextBreadcrumbComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-current="page"]').textContent.trim()).toBe(
      'Dashboard',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Overview');
  });

  it('shows organization, product and exact restaurant task without a Configuration segment', () => {
    vi.spyOn(TestBed.inject(Router), 'url', 'get').mockReturnValue('/restaurants/setup/tables');
    authStore.setCreatedWorkspace(
      { orgId: 'beta', displayName: 'BETA', workspaceType: 'COMPANY' },
      'beta',
    );
    uiStore.setCurrentPage('restaurants');
    fixture = TestBed.createComponent(AppContextBreadcrumbComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('BETA');
    expect(fixture.nativeElement.textContent).toContain('Liass-Resto');
    expect(fixture.nativeElement.querySelector('[aria-current="page"]').textContent.trim()).toBe(
      'Tables',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Configuration');
  });
  it('includes the Sales product and Dashboard label on its landing route', () => {
    authStore.setCreatedWorkspace(
      { orgId: 'sales', displayName: 'BETA', workspaceType: 'COMPANY' },
      'sales',
    );
    uiStore.setCurrentPage('sales.dashboard');
    fixture = TestBed.createComponent(AppContextBreadcrumbComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('BETA');
    expect(fixture.nativeElement.textContent).toContain('Sales');
    expect(fixture.nativeElement.querySelector('[aria-current="page"]').textContent.trim()).toBe(
      'Dashboard',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Liass-Resto');
  });
});
