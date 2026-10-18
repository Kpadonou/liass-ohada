import { AuthCallbackPage } from '../../domains/identity/feature/auth-callback/auth-callback.page';
import {
  appRootRedirectGuard,
  authGuard,
  cabinetDashboardGuard,
  cabinetSettingsGuard,
  cabinetTeamGuard,
  invitationAcceptanceGuard,
  pendingChangesGuard,
  tenantGuard,
} from './auth.guards';
import { routes } from './app.routes';
import { publicLandingHostGuard } from '../public/public-site.guard';
import { vi } from 'vitest';
import type { Route } from '@angular/router';

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

function shellRoute() {
  return routes.find((route) => route.path === '' && route.children);
}

function accountingRoute(): Route | undefined {
  return shellRoute()?.children?.find((route) => route.path === 'accounting');
}

function accountingChild(path: string): Route | undefined {
  return accountingRoute()?.children?.find((route) => route.path === path);
}

describe('routes', () => {
  it('registers the OAuth callback as a technical identity route', () => {
    const callbackRoute = routes.find((route) => route.path === 'auth/callback');

    expect(callbackRoute?.component).toBe(AuthCallbackPage);
    expect(callbackRoute?.canActivate).toBeUndefined();
  });

  it('registers onboarding as an authenticated pre-tenant identity route', async () => {
    const onboardingRoute = routes.find((route) => route.path === 'onboarding');
    const component = await onboardingRoute?.loadComponent?.();
    const { OnboardingPage } =
      await import('../../domains/identity/feature/onboarding/onboarding.page');

    expect(component).toBe(OnboardingPage);
    expect(onboardingRoute?.canActivate).toEqual([authGuard]);
    expect(onboardingRoute?.canActivate).not.toContain(tenantGuard);
  });

  it('registers invitation acceptance as an authenticated pre-tenant route', async () => {
    const acceptanceRoute = routes.find((route) => route.path === 'accept-invitation');
    const component = await acceptanceRoute?.loadComponent?.();
    const { InvitationAcceptancePage } =
      await import('../../domains/identity/feature/invitation-acceptance/invitation-acceptance.page');
    expect(component).toBe(InvitationAcceptancePage);
    expect(acceptanceRoute?.canActivate).toEqual([invitationAcceptanceGuard]);
    expect(acceptanceRoute?.canActivate).not.toContain(tenantGuard);
  });

  it('registers dashboard under the authenticated tenant shell', async () => {
    const shell = shellRoute();
    const dashboardRoute = shell?.children?.find((route) => route.path === 'dashboard');
    const component = await dashboardRoute?.loadComponent?.();
    const { DashboardEntryPage } = await import('../feature/dashboard/dashboard-entry.page');

    expect(shell?.canActivate).toEqual([authGuard, tenantGuard]);
    expect(component).toBe(DashboardEntryPage);
  });

  it('registers the public landing at the root without the authenticated shell', async () => {
    const rootRoute = routes.find(
      (route) => route.path === '' && route.pathMatch === 'full' && route.canMatch,
    );
    const component = await rootRoute?.loadComponent?.();
    const { PublicLandingPage } = await import('../public/public-landing.page');

    expect(rootRoute?.canMatch).toEqual([publicLandingHostGuard]);
    expect(rootRoute?.canActivate).toBeUndefined();
    expect(component).toBe(PublicLandingPage);
  });

  it('keeps an explicit application-root redirect after the public host route', async () => {
    const rootRoute = routes.find(
      (route) => route.path === '' && route.pathMatch === 'full' && route.canActivate,
    );
    const component = await rootRoute?.loadComponent?.();
    const { AppShellComponent } = await import('../../shared/layout/app-shell/app-shell.component');

    expect(rootRoute?.canActivate).toEqual([appRootRedirectGuard]);
    expect(component).toBe(AppShellComponent);
  });

  it('registers cabinet dashboard as an accounting-firm route', async () => {
    const shell = shellRoute();
    const cabinetDashboardRoute = shell?.children?.find(
      (route) => route.path === 'cabinet/dashboard',
    );
    const component = await cabinetDashboardRoute?.loadComponent?.();
    const { CabinetDashboardPage } =
      await import('../../domains/identity/feature/cabinet-dashboard/cabinet-dashboard.page');

    expect(shell?.canActivate).toEqual([authGuard, tenantGuard]);
    expect(component).toBe(CabinetDashboardPage);
    expect(cabinetDashboardRoute?.canActivate).toEqual([cabinetDashboardGuard]);
  });

  it('registers client dossiers as a distinct accounting-firm route', async () => {
    const shell = shellRoute();
    const cabinetDossiersRoute = shell?.children?.find(
      (route) => route.path === 'cabinet/dossiers',
    );
    const component = await cabinetDossiersRoute?.loadComponent?.();
    const { CabinetDossiersPage } =
      await import('../../domains/identity/feature/cabinet-dossiers/cabinet-dossiers.page');

    expect(component).toBe(CabinetDossiersPage);
    expect(cabinetDossiersRoute?.canActivate).toEqual([cabinetDashboardGuard]);
  });

  it('registers Cabinet Team under the tenant shell with its capability guard', async () => {
    const teamRoute = shellRoute()?.children?.find((route) => route.path === 'cabinet/team');
    const component = await teamRoute?.loadComponent?.();
    const { CabinetTeamPage } =
      await import('../../domains/identity/feature/cabinet-team/cabinet-team.page');
    expect(component).toBe(CabinetTeamPage);
    expect(teamRoute?.canActivate).toEqual([cabinetTeamGuard]);
  });

  it('registers Cabinet Settings with capability and unsaved-changes guards', async () => {
    const settingsRoute = shellRoute()?.children?.find(
      (route) => route.path === 'cabinet/settings',
    );
    const component = await settingsRoute?.loadComponent?.();
    const { CabinetSettingsPage } =
      await import('../../domains/identity/feature/cabinet-settings/cabinet-settings.page');

    expect(component).toBe(CabinetSettingsPage);
    expect(settingsRoute?.canActivate).toEqual([cabinetSettingsGuard]);
    expect(settingsRoute?.canDeactivate).toEqual([pendingChangesGuard]);
  });

  it('registers new client dossier creation inside the authenticated tenant shell', async () => {
    const shell = shellRoute();
    const newDossierRoute = shell?.children?.find((route) => route.path === 'cabinet/dossiers/new');
    const component = await newDossierRoute?.loadComponent?.();
    const { CabinetDossierNewPage } =
      await import('../../domains/identity/feature/cabinet-dossier-new/cabinet-dossier-new.page');

    expect(shell?.canActivate).toEqual([authGuard, tenantGuard]);
    expect(component).toBe(CabinetDossierNewPage);
    expect(newDossierRoute?.canActivate).toEqual([cabinetDashboardGuard]);
    expect(routes.find((route) => route.path === 'cabinet/dossiers/new')).toBeUndefined();
  });

  it('registers the accounting general-ledger route', async () => {
    const generalLedgerRoute = accountingChild('general-ledger');
    const component = await generalLedgerRoute?.loadComponent?.();
    const { GeneralLedgerPage } =
      await import('../../domains/accounting/feature/general-ledger/general-ledger.page');

    expect(component).toBe(GeneralLedgerPage);
    expect(generalLedgerRoute?.data?.['titleKey']).toBe('ACCOUNTING.PAGES.GENERAL_LEDGER.TITLE');
  });

  it('registers the accounting auxiliary-ledger route', async () => {
    const auxiliaryLedgerRoute = accountingChild('auxiliary-ledger');
    const component = await auxiliaryLedgerRoute?.loadComponent?.();
    const { AuxiliaryLedgerPage } =
      await import('../../domains/accounting/feature/auxiliary-ledger/auxiliary-ledger.page');

    expect(component).toBe(AuxiliaryLedgerPage);
    expect(auxiliaryLedgerRoute?.data?.['titleKey']).toBe(
      'ACCOUNTING.PAGES.AUXILIARY_LEDGER.TITLE',
    );
  });

  it('registers the accounting auxiliary-balance route', async () => {
    const auxiliaryBalanceRoute = accountingChild('auxiliary-balance');
    const component = await auxiliaryBalanceRoute?.loadComponent?.();
    const { AuxiliaryBalancePage } =
      await import('../../domains/accounting/feature/auxiliary-balance/auxiliary-balance.page');

    expect(component).toBe(AuxiliaryBalancePage);
    expect(auxiliaryBalanceRoute?.data?.['titleKey']).toBe(
      'ACCOUNTING.PAGES.AUXILIARY_BALANCE.TITLE',
    );
  });

  it('registers the accounting overview route with the simplified reporting content', async () => {
    const overviewRoute = accountingChild('');
    const component = await overviewRoute?.loadComponent?.();
    const { SimplifiedReportingPage } =
      await import('../../domains/accounting/feature/simplified-reporting/simplified-reporting.page');

    expect(component).toBe(SimplifiedReportingPage);
    expect(overviewRoute?.data?.['titleKey']).toBe('ACCOUNTING.PAGES.OVERVIEW.TITLE');
    expect(overviewRoute?.data?.['subtitleKey']).toBe('ACCOUNTING.PAGES.OVERVIEW.SUBTITLE');
    expect(overviewRoute?.pathMatch).toBe('full');
  });

  it('keeps the old simplified reporting URL as an alias to the accounting overview', () => {
    const simplifiedReportingRoute = accountingChild('reports/simplified');

    expect(simplifiedReportingRoute?.redirectTo).toBe('/accounting');
    expect(simplifiedReportingRoute?.pathMatch).toBe('full');
    expect(simplifiedReportingRoute?.loadComponent).toBeUndefined();
  });

  it('registers the accounting accounts route and keeps the historical chart route as an alias', async () => {
    const accountsRoute = accountingChild('accounts');
    const legacyChartRoute = accountingChild('chart-of-accounts');
    const component = await accountsRoute?.loadComponent?.();
    const { AccountsPage } =
      await import('../../domains/accounting/feature/accounts/accounts.page');

    expect(component).toBe(AccountsPage);
    expect(accountsRoute?.data?.['titleKey']).toBe('ACCOUNTING.PAGES.CHART_OF_ACCOUNTS.TITLE');
    expect(legacyChartRoute?.redirectTo).toBe('accounts');
  });

  it('registers the accounting third-party management route', async () => {
    const thirdPartiesRoute = accountingChild('third-parties');
    const component = await thirdPartiesRoute?.loadComponent?.();
    const { ThirdPartiesPage } =
      await import('../../domains/accounting/feature/third-parties/third-parties.page');

    expect(component).toBe(ThirdPartiesPage);
    expect(thirdPartiesRoute?.data?.['titleKey']).toBe('ACCOUNTING.PAGES.THIRD_PARTIES.TITLE');
  });

  it('registers the accounting fiscal-year route', async () => {
    const fiscalYearRoute = accountingChild('fiscal-years');
    const legacyFiscalYearRoute = accountingChild('fiscal-year');
    const component = await fiscalYearRoute?.loadComponent?.();
    const { FiscalYearPage } =
      await import('../../domains/accounting/feature/fiscal-year/fiscal-year.page');

    expect(component).toBe(FiscalYearPage);
    expect(fiscalYearRoute?.data?.['titleKey']).toBe('ACCOUNTING.PAGES.FISCAL_YEAR.TITLE');
    expect(legacyFiscalYearRoute?.redirectTo).toBe('fiscal-years');
  });

  it('keeps accounting routes under a stable nested /accounting route tree', () => {
    const route = accountingRoute();
    const accountingChildRoutes = route?.children?.filter((childRoute) => !childRoute.redirectTo);

    expect(route?.path).toBe('accounting');
    expect(route?.pathMatch).toBeUndefined();
    expect(route?.loadComponent).toBeUndefined();
    expect(accountingChildRoutes?.map((childRoute) => childRoute.path)).toEqual(
      expect.arrayContaining([
        '',
        'accounts',
        'entries',
        'entries/new',
        'entries/:entryId',
        'entries/:entryId/edit',
        'fiscal-years',
        'general-ledger',
        'auxiliary-ledger',
        'auxiliary-balance',
        'journal-book',
        'journals',
        'lettering',
        'third-parties',
        'trial-balance',
      ]),
    );
    expect(accountingChild('reports/simplified')?.redirectTo).toBe('/accounting');
    expect(route?.children?.some((childRoute) => childRoute.path?.startsWith('accounting/'))).toBe(
      false,
    );
  });

  it('registers the accounting lettering route', async () => {
    const letteringRoute = accountingChild('lettering');
    const component = await letteringRoute?.loadComponent?.();
    const { LetteringPage } =
      await import('../../domains/accounting/feature/lettering/lettering.page');

    expect(component).toBe(LetteringPage);
    expect(letteringRoute?.data?.['titleKey']).toBe('ACCOUNTING.PAGES.LETTERING.TITLE');
  });

  it('registers dedicated accounting entry create and draft edit routes', async () => {
    const newEntryRoute = accountingChild('entries/new');
    const editEntryRoute = accountingChild('entries/:entryId/edit');
    const newComponent = await newEntryRoute?.loadComponent?.();
    const editComponent = await editEntryRoute?.loadComponent?.();
    const { EntryFormPage } =
      await import('../../domains/accounting/feature/entry-form/entry-form.page');

    expect(newComponent).toBe(EntryFormPage);
    expect(editComponent).toBe(EntryFormPage);
    expect(newEntryRoute?.data?.['titleKey']).toBe('ACCOUNTING.ENTRIES.FORM.NEW_TITLE');
    expect(editEntryRoute?.data?.['titleKey']).toBe('ACCOUNTING.ENTRIES.FORM.EDIT_TITLE');
  });

  it('registers the dedicated accounting entry detail route', async () => {
    const detailEntryRoute = accountingChild('entries/:entryId');
    const component = await detailEntryRoute?.loadComponent?.();
    const { EntryDetailPage } =
      await import('../../domains/accounting/feature/entry-detail/entry-detail.page');

    expect(component).toBe(EntryDetailPage);
    expect(detailEntryRoute?.data?.['titleKey']).toBe('ACCOUNTING.ENTRIES.DETAIL.TITLE');
  });
});

describe('SALES routes', () => {
  it('registers the implemented SALES foundations and draft invoices with a guarded /sales dashboard', async () => {
    const salesRoute = shellRoute()?.children?.find((route) => route.path === 'sales');
    const redirect = salesRoute?.children?.find((route) => route.path === '');
    const customersRoute = salesRoute?.children?.find((route) => route.path === 'customers');
    const itemsRoute = salesRoute?.children?.find((route) => route.path === 'items');
    const invoicesRoute = salesRoute?.children?.find((route) => route.path === 'invoices');
    const invoiceDetailRoute = salesRoute?.children?.find(
      (route) => route.path === 'invoices/:invoiceId',
    );
    const creditNoteDetailRoute = salesRoute?.children?.find(
      (route) => route.path === 'invoices/:invoiceId/credit-notes/:creditNoteId',
    );
    const customersComponent = await customersRoute?.loadComponent?.();
    const itemsComponent = await itemsRoute?.loadComponent?.();
    const invoicesComponent = await invoicesRoute?.loadComponent?.();
    const invoiceDetailComponent = await invoiceDetailRoute?.loadComponent?.();
    const creditNoteDetailComponent = await creditNoteDetailRoute?.loadComponent?.();
    const { SalesCustomersPage } =
      await import('../../domains/sales/feature/customers/sales-customers.page');
    const { SalesItemsPage } = await import('../../domains/sales/feature/items/sales-items.page');
    const { SalesInvoicesPage } =
      await import('../../domains/sales/feature/invoices/sales-invoices.page');
    const { SalesInvoiceDetailPage } =
      await import('../../domains/sales/feature/invoices/sales-invoice-detail.page');
    const { SalesCreditNoteDetailPage } =
      await import('../../domains/sales/feature/invoices/sales-credit-note-detail.page');

    const { SalesDashboardPage } =
      await import('../../domains/sales/feature/dashboard/sales-dashboard.page');
    expect(await redirect?.loadComponent?.()).toBe(SalesDashboardPage);
    expect(redirect?.data?.['productCode']).toBe('SALES');
    expect(redirect?.canActivate).toHaveLength(2);
    expect(redirect?.pathMatch).toBe('full');
    expect(customersComponent).toBe(SalesCustomersPage);
    expect(itemsComponent).toBe(SalesItemsPage);
    expect(invoicesComponent).toBe(SalesInvoicesPage);
    expect(invoiceDetailComponent).toBe(SalesInvoiceDetailPage);
    expect(creditNoteDetailComponent).toBe(SalesCreditNoteDetailPage);
    expect(customersRoute?.data?.['titleKey']).toBe('SALES.CUSTOMERS.PAGE.TITLE');
    expect(itemsRoute?.data?.['titleKey']).toBe('SALES.ITEMS.PAGE.TITLE');
  });

  it('keeps the canonical Sales dashboard at /sales without deferred issuing routes', () => {
    const salesRoute = shellRoute()?.children?.find((route) => route.path === 'sales');
    const paths = salesRoute?.children?.map((route) => route.path) ?? [];

    expect(paths).toEqual([
      '',
      'customers',
      'items',
      'invoices',
      'invoices/:invoiceId/credit-notes/:creditNoteId',
      'invoices/:invoiceId',
    ]);
    expect(paths).not.toContain('dashboard');
    expect(paths).not.toContain('catalog');
    expect(paths).not.toContain('invoices/:invoiceId/issue');
    expect(paths).not.toContain('invoices/:invoiceId/pdf');
  });
});

it('keeps Setup and Menu behind RESTAURANTS ProductAccess without future modules', () => {
  const product = shellRoute()?.children?.find((route) => route.path === 'restaurants');
  expect(product?.children?.map((route) => route.path)).toEqual([
    'kitchen',
    'service/outlets/:outletId/sessions/:guestSessionId',
    'service',
    'setup/team',
    '',
    'setup',
    'setup/locations',
    'setup/areas',
    'setup/tables',
    'setup/stations',
    'menu',
  ]);
  for (const route of product?.children ?? []) {
    expect(route.canActivate).toHaveLength(1);
    expect(route.data?.['productCode']).toBe('RESTAURANTS');
  }
});

it('loads the Team destination inside the existing Restaurants product wrapper', async () => {
  const product = shellRoute()?.children?.find((route) => route.path === 'restaurants');
  const team = product?.children?.find((route) => route.path === 'setup/team');
  expect(await team?.loadComponent?.()).toBe(
    (await import('../../domains/restaurants/feature/restaurant-team.page')).RestaurantTeamPage,
  );
  expect(team?.data?.['titleKey']).toBe('RESTAURANTS.TEAM.TITLE');
});

it('lazy-loads the contextual keyed GuestSession workspace inside Restaurants', async () => {
  const product = shellRoute()?.children?.find((route) => route.path === 'restaurants');
  const workspace = product?.children?.find(
    (route) => route.path === 'service/outlets/:outletId/sessions/:guestSessionId',
  );
  expect(await workspace?.loadComponent?.()).toBe(
    (await import('../../domains/restaurants/feature/restaurant-table-workspace.page'))
      .RestaurantTableWorkspacePage,
  );
});
