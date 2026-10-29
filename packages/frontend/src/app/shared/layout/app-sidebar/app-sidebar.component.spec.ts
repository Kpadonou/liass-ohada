import { signal } from '@angular/core';
import { RestaurantOutletContext } from '../../../domains/restaurants/data-access/restaurant-outlet-context';
import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { Location } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { SalesDashboardPage } from '../../../domains/sales/feature/dashboard/sales-dashboard.page';
import { Router, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { vi } from 'vitest';

import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { CabinetDossiersApi } from '../../../domains/identity/data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../../domains/identity/data-access/workspaces.api';
import { UiStore } from '../../../core/state/ui.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import type { ProductAvailability } from '../../../core/product-access/product-availability';
import type { ProductCode } from '@liass-ohada/shared/shared';
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
    signOut: vi.fn(),
  };

  return globalScope.__liassAmplifyAuthMock;
});

@Component({ template: '' })
class NavigationTarget {}

const activeOutlet = signal('ready-outlet');
const translations = {
  fr: {
    RESTAURANTS_INVENTORY: { TITLE: 'Stock' },
    RESTAURANTS: {
      CHECKOUT: { TITLE: 'Caisse' },
      SERVICE: { GROUP: 'Service' },
      UX: {
        NAV: {
          restaurant: 'Restaurant',
          outlet: 'Établissements',
          area: 'Espaces de restauration',
          table: 'Tables',
          station: 'Postes de préparation',
          menu: 'Menu',
          team: 'Équipe',
          MENU_SECTION: 'Carte',
          overview: 'Tableau de bord',
        },
        CONFIGURATION: 'Configuration',
        PAGES: {
          service: { TITLE: 'Service en salle' },
          overview: { TITLE: 'Vue resto' },
          restaurant: { TITLE: 'Restaurant' },
          outlet: { TITLE: 'Établissements' },
          area: { TITLE: 'Espaces' },
          table: { TITLE: 'Tables' },
          station: { TITLE: 'Postes cuisine et bar' },
        },
      },
      UI: { NAV: { MENU: 'Carte' } },
    },
    SHELL: {
      AI_PANEL: {
        EYEBROW: 'IA native',
        TEXT: 'Les suggestions comptables restent limitées.',
      },
      BRAND_TAGLINE: 'Poste ERP',
      LOGO_ALT: 'logo liass-ohada',
      SIDEBAR: {
        PLATFORM: 'Plateforme',
        ACTIVE_PRODUCT: 'Produit actif',
        COLLAPSE: 'Réduire la barre latérale',
        EXPAND: 'Déployer la barre latérale',
        NAVIGATION_LABEL: 'Navigation principale',
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
        JOURNAL_BOOK: 'Livre-journal',
        JOURNALS: 'Journaux',
        LETTERING: 'Lettrage',
        MISSIONS: 'Missions',
        PROJECTS: 'Projets et fonds',
        REPORTS: 'États OHADA',
        RESTAURANTS: 'Liass-Resto',
        SALES: 'Ventes',
        SALES_CUSTOMERS: 'Clients',
        SALES_ITEMS: 'Articles & services',
        SALES_INVOICES: 'Factures',
        SECTION_LABEL: 'Espace',
        SYCEBNL_BADGE: 'SYCEBNL',
        THIRD_PARTIES: 'Tiers',
        TREASURY: 'Trésorerie',
        UNAVAILABLE: 'Indisponible',
        PRODUCT_UNAVAILABLE_FOR_ORGANIZATION:
          'Cette fonctionnalité n’est pas disponible pour cette organisation.',
        TEAM: 'Équipe',
        TRIAL_BALANCE: 'Balance',
      },
    },
  },
};

describe('AppSidebarComponent', () => {
  let fixture: ComponentFixture<AppSidebarComponent>;
  let productAvailability: Record<ProductCode, ProductAvailability>;

  beforeEach(async () => {
    activeOutlet.set('ready-outlet');
    TestBed.resetTestingModule();
    localStorage.clear();
    productAvailability = {
      ACCOUNTING: 'UNKNOWN',
      SALES: 'UNKNOWN',
      RESTAURANTS: 'UNKNOWN',
    };

    await TestBed.configureTestingModule({
      imports: [
        AppSidebarComponent,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: {
            availableLangs: ['fr'],
            defaultLang: 'fr',
          },
        }),
      ],
      providers: [
        { provide: RestaurantOutletContext, useValue: { id: activeOutlet, available: () => true } },
        provideRouter([]),
        provideLocationMocks(),
        { provide: WorkspacesApi, useValue: { listWorkspaces: () => Promise.resolve([]) } },
        { provide: CabinetDossiersApi, useValue: { listDossiers: () => Promise.resolve([]) } },
        {
          provide: ProductAccessState,
          useValue: {
            availability: (productCode: ProductCode) => productAvailability[productCode],
          },
        },
      ],
    }).compileComponents();
  });

  it('renders the requested French navigation structure', () => {
    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-company',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY',
      },
      'org-company',
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
    expect(text).not.toContain('Ventes');
    expect(text).not.toContain('Sales');
  });

  it('keeps Treasury navigation unchanged while access is active or technically unknown', () => {
    const authStore = TestBed.inject(AuthStore);
    const router = TestBed.inject(Router);
    authStore.setCreatedWorkspace(
      { orgId: 'org-company', displayName: 'Demo SARL', workspaceType: 'COMPANY' },
      'org-company',
    );
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(false);

    for (const availability of ['AVAILABLE', 'UNKNOWN'] as const) {
      productAvailability.ACCOUNTING = availability;
      fixture = TestBed.createComponent(AppSidebarComponent);
      fixture.detectChanges();
      const treasuryButton = fixture.nativeElement.querySelector(
        'liass-sidebar-nav-item button[aria-label="Trésorerie"]',
      ) as HTMLButtonElement;

      expect(treasuryButton.disabled).toBe(false);
      expect(fixture.nativeElement.textContent).not.toContain('Indisponible');
      treasuryButton.click();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/treasury');
      fixture.destroy();
    }
  });

  it('keeps known unavailable Treasury discoverable but prevents navigation', () => {
    productAvailability.ACCOUNTING = 'UNAVAILABLE';
    const router = TestBed.inject(Router);
    TestBed.inject(AuthStore).setCreatedWorkspace(
      { orgId: 'org-company', displayName: 'Demo SARL', workspaceType: 'COMPANY' },
      'org-company',
    );
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(false);
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();

    const treasuryButton = fixture.nativeElement.querySelector(
      'liass-sidebar-nav-item button[aria-label^="Trésorerie"]',
    ) as HTMLButtonElement;
    expect(treasuryButton).not.toBeNull();
    expect(treasuryButton.disabled).toBe(true);
    expect(treasuryButton.getAttribute('aria-disabled')).toBe('true');
    expect(treasuryButton.getAttribute('aria-label')).toContain(
      'Cette fonctionnalité n’est pas disponible pour cette organisation.',
    );
    expect(fixture.nativeElement.textContent).toContain('Indisponible');
    treasuryButton.click();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('keeps Projects navigation unchanged while access is active or technically unknown', () => {
    const authStore = TestBed.inject(AuthStore);
    const router = TestBed.inject(Router);
    authStore.setCreatedWorkspace(
      { orgId: 'org-company', displayName: 'Demo SARL', workspaceType: 'COMPANY' },
      'org-company',
    );
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(false);

    for (const availability of ['AVAILABLE', 'UNKNOWN'] as const) {
      productAvailability.ACCOUNTING = availability;
      fixture = TestBed.createComponent(AppSidebarComponent);
      fixture.detectChanges();
      const projectsButton = fixture.nativeElement.querySelector(
        'liass-sidebar-nav-item button[aria-label="Projets et fonds"]',
      ) as HTMLButtonElement;

      expect(projectsButton.disabled).toBe(false);
      expect(fixture.nativeElement.textContent).not.toContain('Indisponible');
      projectsButton.click();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/projects');
      fixture.destroy();
    }
  });

  it('keeps known unavailable Projects discoverable but prevents navigation', () => {
    productAvailability.ACCOUNTING = 'UNAVAILABLE';
    const router = TestBed.inject(Router);
    TestBed.inject(AuthStore).setCreatedWorkspace(
      { orgId: 'org-company', displayName: 'Demo SARL', workspaceType: 'COMPANY' },
      'org-company',
    );
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(false);
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();

    const projectsButton = fixture.nativeElement.querySelector(
      'liass-sidebar-nav-item button[aria-label^="Projets et fonds"]',
    ) as HTMLButtonElement;
    expect(projectsButton).not.toBeNull();
    expect(projectsButton.disabled).toBe(true);
    expect(projectsButton.getAttribute('aria-disabled')).toBe('true');
    expect(projectsButton.getAttribute('aria-label')).toContain(
      'Cette fonctionnalité n’est pas disponible pour cette organisation.',
    );
    expect(fixture.nativeElement.textContent).toContain('Indisponible');
    expect(fixture.nativeElement.textContent).not.toContain('SYCEBNL');
    projectsButton.click();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('keeps Accounting Core navigation usable while access is active or technically unknown', () => {
    const router = TestBed.inject(Router);
    TestBed.inject(AuthStore).setCreatedWorkspace(
      { orgId: 'org-company', displayName: 'Demo SARL', workspaceType: 'COMPANY' },
      'org-company',
    );
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(false);

    for (const availability of ['AVAILABLE', 'UNKNOWN'] as const) {
      productAvailability.ACCOUNTING = availability;
      fixture = TestBed.createComponent(AppSidebarComponent);
      fixture.detectChanges();
      const overviewButton = fixture.nativeElement.querySelector(
        'liass-sidebar-nav-item button[aria-label="Vue d’ensemble"]',
      ) as HTMLButtonElement;

      expect(overviewButton.disabled).toBe(false);
      overviewButton.click();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/accounting');
      fixture.destroy();
    }
  });

  it('keeps known unavailable Accounting Core navigation discoverable but disabled', () => {
    productAvailability.ACCOUNTING = 'UNAVAILABLE';
    TestBed.inject(AuthStore).setCreatedWorkspace(
      { orgId: 'org-company', displayName: 'Demo SARL', workspaceType: 'COMPANY' },
      'org-company',
    );
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();

    const accountingLabels = [
      'Vue d’ensemble',
      'Exercices',
      'Grand livre',
      'Grand livre auxiliaire',
      'Balance auxiliaire',
      'Livre-journal',
      'Journaux',
      'Tiers',
      'Écritures',
      'Lettrage',
      'Balance',
      'Plan comptable',
    ];
    for (const label of accountingLabels) {
      const button = fixture.nativeElement.querySelector(
        `liass-sidebar-nav-item button[aria-label^="${label}"]`,
      ) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-disabled')).toBe('true');
    }

    const dashboardButton = fixture.nativeElement.querySelector(
      'liass-sidebar-nav-item button[aria-label="Tableau de bord"]',
    ) as HTMLButtonElement;
    expect(dashboardButton.disabled).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Indisponible');
  });

  it('collapses the desktop sidebar into an accessible icon rail', () => {
    const uiStore = TestBed.inject(UiStore);
    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-company',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY',
      },
      'org-company',
    );
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();

    uiStore.setSidebarCollapsed(true);
    fixture.detectChanges();

    const sidebar = fixture.nativeElement.querySelector('aside') as HTMLElement;
    const dashboardButton = fixture.nativeElement.querySelector(
      'liass-sidebar-nav-item button[aria-label="Tableau de bord"]',
    ) as HTMLButtonElement | null;
    const dashboardLabel = dashboardButton?.querySelector(
      'span:nth-child(2)',
    ) as HTMLElement | null;
    const aiPanel = fixture.nativeElement.querySelector(
      '[data-testid="sidebar-ai-panel"]',
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
        status: 'ACTIVE',
      },
      'org-firm',
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
        status: 'ACTIVE',
      },
      'org-firm',
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
          status: 'ACTIVE',
        },
        'org-firm',
      );
      fixture = TestBed.createComponent(AppSidebarComponent);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('Paramètres du cabinet');
    },
  );

  it('restores standard accounting navigation after a cabinet dossier is selected', () => {
    const authStore = TestBed.inject(AuthStore);
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM',
      },
      'org-firm',
    );
    authStore.setCreatedDossier(
      {
        orgId: 'org-client',
        displayName: 'Client SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z',
      },
      'org-client',
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
        workspaceType: 'COMPANY',
      },
      'org-company',
    );
    uiStore.setCurrentPage('accounting.overview');
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(false);
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();

    const overviewButton = fixture.nativeElement.querySelector(
      'liass-sidebar-nav-item button[aria-label="Vue d’ensemble"]',
    ) as HTMLButtonElement;
    overviewButton.click();
    fixture.detectChanges();
    const activeButtons = Array.from(
      fixture.nativeElement.querySelectorAll('liass-sidebar-nav-item button'),
    ).filter((button) => (button as HTMLButtonElement).className.includes('bg-brand-50'));

    expect(router.navigateByUrl).toHaveBeenCalledWith('/accounting');
    expect(uiStore.currentPage()).toBe('accounting.overview');
    expect(activeButtons).toHaveLength(1);
    expect((activeButtons[0] as HTMLButtonElement).getAttribute('aria-label')).toBe(
      'Vue d’ensemble',
    );
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
        workspaceType: 'COMPANY',
      },
      'org-company',
    );
    uiStore.setCurrentPage('accounting.overview');
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(false);
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();

    const auxiliaryBalanceButton = fixture.nativeElement.querySelector(
      'liass-sidebar-nav-item button[aria-label="Balance auxiliaire"]',
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
        workspaceType: 'ACCOUNTING_FIRM',
      },
      'org-firm',
    );
    authStore.setCreatedDossier(
      {
        orgId: 'org-client',
        displayName: 'Client SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z',
      },
      'org-client',
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

  it('shows Customers, Articles & services and Invoices under SALES for an entitled direct OWNER', () => {
    productAvailability.SALES = 'AVAILABLE';
    TestBed.inject(UiStore).setCurrentPage('sales.customers');
    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-sales',
        displayName: 'Sales SARL',
        workspaceType: 'COMPANY',
        role: 'OWNER',
      },
      'org-sales',
    );
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Ventes');
    expect(text).toContain('Clients');
    expect(text).toContain('Articles & services');
    expect(text).toContain('Factures');
    expect(text).not.toContain('Catalog');
    expect(text).not.toContain('Invoices');
  });

  it.each(['UNKNOWN', 'UNAVAILABLE'] as const)(
    'hides SALES navigation when product availability is %s',
    (availability) => {
      productAvailability.SALES = availability;
      TestBed.inject(AuthStore).setCreatedWorkspace(
        {
          orgId: 'org-sales',
          displayName: 'Sales SARL',
          workspaceType: 'COMPANY',
          role: 'OWNER',
        },
        'org-sales',
      );
      fixture = TestBed.createComponent(AppSidebarComponent);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="sales-navigation"]')).toBeNull();
    },
  );

  it('keeps SALES independent from ACCOUNTING and switches module navigation by product', () => {
    const auth = TestBed.inject(AuthStore),
      ui = TestBed.inject(UiStore);
    auth.setCreatedWorkspace(
      { orgId: 'org-sales', workspaceType: 'COMPANY', role: 'OWNER' },
      'org-sales',
    );
    productAvailability.SALES = 'AVAILABLE';
    productAvailability.ACCOUNTING = 'UNAVAILABLE';
    ui.setCurrentPage('sales.customers');
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Clients');
    expect(fixture.nativeElement.textContent).toContain('Articles & services');
    expect(fixture.nativeElement.textContent).toContain('Factures');
    expect(fixture.nativeElement.textContent).not.toContain('Grand livre');
    ui.setCurrentPage('accounting.overview');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="sales-navigation"]')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('button[aria-label^="Vue d’ensemble"]').disabled,
    ).toBe(true);
    fixture.destroy();
    productAvailability.ACCOUNTING = 'AVAILABLE';
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('button[aria-label^="Vue d’ensemble"]').disabled,
    ).toBe(false);
  });

  it('does not show SALES without the current SALES_READ projection or in Cabinet context', () => {
    productAvailability.SALES = 'AVAILABLE';
    const authStore = TestBed.inject(AuthStore);
    authStore.setCreatedWorkspace(
      { orgId: 'org-member', displayName: 'Member SARL', workspaceType: 'COMPANY', role: 'MEMBER' },
      'org-member',
    );
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="sales-navigation"]')).toBeNull();
    fixture.destroy();

    authStore.setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM',
        cabinetRole: 'CABINET_ADMIN',
        role: 'OWNER',
      },
      'org-firm',
    );
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="sales-navigation"]')).toBeNull();
  });
  it.each(['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'] as const)(
    'shows contextual Liass-Resto only with AVAILABLE access (%s)',
    (availability) => {
      productAvailability.RESTAURANTS = availability;
      TestBed.inject(UiStore).setCurrentPage('restaurants');
      TestBed.inject(AuthStore).setCreatedWorkspace(
        {
          orgId: 'org-resto',
          workspaceType: 'COMPANY',
          role: 'OWNER',
          productRoles: { RESTAURANTS: 'OWNER' },
        },
        'org-resto',
      );
      fixture = TestBed.createComponent(AppSidebarComponent);
      fixture.detectChanges();
      expect(!!fixture.nativeElement.querySelector('[data-testid="restaurants-navigation"]')).toBe(
        availability === 'AVAILABLE',
      );
      expect(fixture.nativeElement.querySelector('[data-testid="sales-navigation"]')).toBeNull();
      expect(fixture.nativeElement.textContent).not.toContain('Grand livre');
    },
  );

  it('hides normal operational navigation until authorized Outlet bootstrap is ready', () => {
    productAvailability.RESTAURANTS = 'AVAILABLE';
    TestBed.inject(UiStore).setCurrentPage('restaurants');
    TestBed.inject(AuthStore).setCreatedWorkspace(
      { orgId: 'org-resto', workspaceType: 'COMPANY', productRoles: { RESTAURANTS: 'MANAGER' } },
      'org-resto',
    );
    activeOutlet.set('');
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    const routes = () =>
      (
        fixture.componentInstance as unknown as {
          restaurantGroups: () => { items: { route: string }[] }[];
        }
      )
        .restaurantGroups()
        .flatMap((group) => group.items.map((item) => item.route));
    const operational = [
      '/restaurants/service',
      '/restaurants/kitchen',
      '/restaurants/checkout',
      '/restaurants/cash',
      '/restaurants/cash/day',
      '/restaurants/inventory',
    ];
    expect(routes()).toContain('/restaurants/setup/locations');
    expect(routes()).not.toContain('/restaurants');
    for (const path of operational) expect(routes()).not.toContain(path);
    expect(fixture.nativeElement.querySelector('button[aria-label="Caisse"]')).toBeNull();
    activeOutlet.set('authorized-outlet');
    fixture.detectChanges();
    for (const path of operational) expect(routes()).toContain(path);
    expect(fixture.nativeElement.querySelector('button[aria-label="Caisse"]')).toBeTruthy();
    activeOutlet.set('');
    fixture.detectChanges();
    for (const path of operational) expect(routes()).not.toContain(path);
  });
  it('deep-links, highlights exactly one restaurant entry, routes selections and follows history', async () => {
    productAvailability.RESTAURANTS = 'AVAILABLE';
    const ui = TestBed.inject(UiStore),
      router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', component: NavigationTarget }]);
    router.setUpLocationChangeListener();
    ui.setCurrentPage('restaurants');
    TestBed.inject(AuthStore).setCreatedWorkspace(
      { orgId: 'org-resto', workspaceType: 'COMPANY', productRoles: { RESTAURANTS: 'MANAGER' } },
      'org-resto',
    );
    await router.navigateByUrl('/restaurants/setup/tables?view=all');
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    const active = () =>
      fixture.nativeElement.querySelectorAll('liass-sidebar-nav-item button[aria-current="page"]');
    expect(active()).toHaveLength(1);
    expect(active()[0].getAttribute('aria-label')).toBe('Tables');
    expect(
      fixture.nativeElement.querySelector('button[aria-label="Service en salle"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('button[aria-label="Équipe"]')).not.toBeNull();
    ui.toggleSidebar();
    ui.setSidebarCollapsed(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('aside').className).toContain('translate-x-0');
    expect(active()[0].querySelector('span:nth-child(2)').className).toContain('lg:sr-only');
    fixture.nativeElement.querySelector('button[aria-label="Établissements"]').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(router.url).toBe('/restaurants/setup/locations');
    expect(ui.sidebarOpen()).toBe(false);
    expect(active()).toHaveLength(1);
    expect(active()[0].getAttribute('aria-label')).toBe('Établissements');
    TestBed.inject(Location).back();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(active()[0].getAttribute('aria-label')).toBe('Tables');
    });
    TestBed.inject(Location).forward();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(active()[0].getAttribute('aria-label')).toBe('Établissements');
    });
    expect(
      fixture.nativeElement.querySelectorAll(
        '[data-testid="restaurants-navigation"] liass-sidebar-nav-item',
      ),
    ).toHaveLength(14);
  });

  it.each(['OWNER', 'MANAGER', 'WAITER', 'CASHIER', 'KITCHEN'])(
    'Stock visibility follows the %s management role',
    (role) => {
      productAvailability.RESTAURANTS = 'AVAILABLE';
      TestBed.inject(UiStore).setCurrentPage('restaurants');
      TestBed.inject(AuthStore).setCreatedWorkspace(
        {
          orgId: 'org-resto',
          workspaceType: 'COMPANY',
          productRoles: { RESTAURANTS: role as 'OWNER' },
        },
        'org-resto',
      );
      fixture = TestBed.createComponent(AppSidebarComponent);
      fixture.detectChanges();
      expect(!!fixture.nativeElement.querySelector('button[aria-label="Stock"]')).toBe(
        ['OWNER', 'MANAGER'].includes(role),
      );
    },
  );
  it('retains product discovery but hides all restaurant modules without read permissions', () => {
    productAvailability.RESTAURANTS = 'AVAILABLE';
    TestBed.inject(UiStore).setCurrentPage('restaurants');
    TestBed.inject(AuthStore).setCreatedWorkspace(
      { orgId: 'org-resto', workspaceType: 'COMPANY', role: 'OWNER' },
      'org-resto',
    );
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll(
        '[data-testid="restaurants-navigation"] liass-sidebar-nav-item',
      ),
    ).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('[data-testid="product-navigation"]')).toBeNull();
  });
  it('shows only restaurant navigation without product or platform context', async () => {
    productAvailability.RESTAURANTS = 'AVAILABLE';
    TestBed.inject(UiStore).setCurrentPage('restaurants');
    TestBed.inject(AuthStore).setCreatedWorkspace(
      { orgId: 'resto', workspaceType: 'COMPANY', productRoles: { RESTAURANTS: 'OWNER' } },
      'resto',
    );
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    const resto = fixture.nativeElement.querySelector('[data-testid="restaurants-navigation"]');
    expect(fixture.nativeElement.querySelector('[data-testid="product-navigation"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="active-product-label"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Liass-Resto');
    expect(fixture.nativeElement.textContent).not.toContain('Plateforme');
    expect(
      fixture.nativeElement.querySelectorAll(
        'liass-sidebar-nav-item button[aria-label="Tableau de bord"]',
      ),
    ).toHaveLength(1);
    expect(resto.querySelectorAll('section')[0].querySelector('p')).toBeNull();
    expect(resto.querySelectorAll('section p')).toHaveLength(2);
    expect(resto.querySelector('button[aria-label="Service en salle"]')).not.toBeNull();
    expect(resto.querySelector('button[aria-label="Restaurant"]')).not.toBeNull();
    expect(resto.querySelector('button[aria-label="Postes de préparation"]')).not.toBeNull();
    expect(resto.textContent).not.toContain('Configuration du restaurant');
    expect(resto.querySelectorAll('section p')[1].textContent.trim()).toBe('Configuration');
    const configuration = resto.querySelectorAll('section')[2];
    expect(configuration.querySelector('button[aria-label="Menu"]')).not.toBeNull();
    expect(configuration.querySelector('button[aria-label="Équipe"]')).not.toBeNull();
    expect(resto.querySelectorAll('section')).toHaveLength(3);
    TestBed.inject(UiStore).setSidebarCollapsed(true);
    fixture.detectChanges();
    expect(
      resto.querySelector('button[aria-label="Restaurant"]').querySelector('span:nth-child(2)')
        .className,
    ).toContain('lg:sr-only');
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', component: NavigationTarget }]);
    await router.navigateByUrl('/restaurants/service?outlet=site-a');
    fixture.detectChanges();
    expect(resto.querySelector('button[aria-current="page"]').getAttribute('aria-label')).toBe(
      'Service en salle',
    );
    await router.navigateByUrl('/restaurants/service/outlets/site-a/sessions/visit-a');
    fixture.detectChanges();
    expect(resto.querySelectorAll('button[aria-current="page"]')).toHaveLength(1);
    expect(resto.querySelector('button[aria-current="page"]').getAttribute('aria-label')).toBe(
      'Service en salle',
    );
    await router.navigateByUrl('/restaurants/setup/locations');
    fixture.detectChanges();
    resto.querySelector('button[aria-label="Tableau de bord"]').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(router.url).toBe('/restaurants');
    expect(resto.querySelector('button[aria-current="page"]').className).not.toContain(
      'shadow-app-xs',
    );
    expect(resto.querySelector('button[aria-current="page"]').getAttribute('aria-label')).toBe(
      'Tableau de bord',
    );
  });
  it('keeps sidebar context aligned with a Sales-only workspace on its own dashboard', () => {
    productAvailability.ACCOUNTING = 'UNAVAILABLE';
    productAvailability.SALES = 'AVAILABLE';
    TestBed.inject(AuthStore).setCreatedWorkspace(
      { orgId: 'sales-only', workspaceType: 'COMPANY', role: 'OWNER' },
      'sales-only',
    );
    TestBed.inject(UiStore).setCurrentPage('sales.dashboard');
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="sales-navigation"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Grand livre');
    expect(fixture.nativeElement.querySelector('[data-testid="product-navigation"]')).toBeNull();
  });
  it('routes the Sales Dashboard item to /sales with a current route state', async () => {
    productAvailability.SALES = 'AVAILABLE';
    TestBed.inject(AuthStore).setCreatedWorkspace(
      { orgId: 'sales', workspaceType: 'COMPANY', role: 'OWNER' },
      'sales',
    );
    TestBed.inject(UiStore).setCurrentPage('sales.customers');
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture.nativeElement.querySelector('button[aria-label="Tableau de bord"]').click();
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith('/sales');
    TestBed.inject(UiStore).setCurrentPage('sales.dashboard');
    fixture.detectChanges();
    expect(
      fixture.nativeElement
        .querySelector('button[aria-label="Tableau de bord"]')
        .getAttribute('aria-current'),
    ).toBe('page');
  });
  it('clicking Sales Dashboard renders the Sales landing component rather than Accounting', async () => {
    productAvailability.SALES = 'AVAILABLE';
    TestBed.inject(AuthStore).setCreatedWorkspace(
      { orgId: 'sales', workspaceType: 'COMPANY', role: 'OWNER' },
      'sales',
    );
    TestBed.inject(UiStore).setCurrentPage('sales.customers');
    const router = TestBed.inject(Router);
    router.resetConfig([
      { path: 'sales/customers', component: NavigationTarget },
      { path: 'sales', component: SalesDashboardPage },
    ]);
    const harness = await RouterTestingHarness.create('/sales/customers');
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button[aria-label="Tableau de bord"]').click();
    await fixture.whenStable();
    harness.detectChanges();
    expect(router.url).toBe('/sales');
    expect(
      harness.routeNativeElement?.querySelector('a[href="/sales/customers"]')?.textContent,
    ).toContain('Clients');
    expect(harness.routeNativeElement?.querySelector('liass-dashboard-page')).toBeNull();
  });
  it('keeps outlet context when moving between restaurant configuration destinations', async () => {
    productAvailability.RESTAURANTS = 'AVAILABLE';
    TestBed.inject(UiStore).setCurrentPage('restaurants');
    TestBed.inject(AuthStore).setCreatedWorkspace(
      { orgId: 'resto', workspaceType: 'COMPANY', productRoles: { RESTAURANTS: 'OWNER' } },
      'resto',
    );
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', component: NavigationTarget }]);
    await router.navigateByUrl('/restaurants/setup/tables?outlet=site-a&area=room-a');
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button[aria-label="Postes de préparation"]').click();
    await fixture.whenStable();
    expect(router.url).toBe('/restaurants/setup/stations?outlet=site-a');
    fixture.nativeElement.querySelector('button[aria-label="Menu"]').click();
    await fixture.whenStable();
    expect(router.url).toBe('/restaurants/menu?outlet=site-a');
  });

  it('shows only Service en salle, without configuration or Team navigation for WAITER', () => {
    productAvailability.RESTAURANTS = 'AVAILABLE';
    TestBed.inject(UiStore).setCurrentPage('restaurants');
    TestBed.inject(AuthStore).setCreatedWorkspace(
      { orgId: 'org-resto', workspaceType: 'COMPANY', productRoles: { RESTAURANTS: 'WAITER' } },
      'org-resto',
    );
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('button[aria-label="Service en salle"]'),
    ).not.toBeNull();
    for (const label of [
      'Tableau de bord',
      'Restaurant',
      'Établissements',
      'Espaces de restauration',
      'Tables',
      'Postes de préparation',
      'Menu',
      'Équipe',
    ])
      expect(fixture.nativeElement.querySelector(`button[aria-label="${label}"]`)).toBeNull();
  });
  it('shows Caisse and Ma caisse for CASHIER, preserving other product role boundaries', () => {
    productAvailability.RESTAURANTS = 'AVAILABLE';
    TestBed.inject(UiStore).setCurrentPage('restaurants');
    TestBed.inject(AuthStore).setCreatedWorkspace(
      { orgId: 'org-resto', workspaceType: 'COMPANY', productRoles: { RESTAURANTS: 'CASHIER' } },
      'org-resto',
    );
    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[aria-label="Caisse"]')).not.toBeNull();
    const items = fixture.nativeElement.querySelectorAll(
      '[data-testid="restaurants-navigation"] liass-sidebar-nav-item',
    );
    expect(items).toHaveLength(2);
    for (const label of ['Service en salle', 'Cuisine', 'Restaurant', 'Équipe', 'Menu'])
      expect(fixture.nativeElement.querySelector(`button[aria-label="${label}"]`)).toBeNull();
  });
});
