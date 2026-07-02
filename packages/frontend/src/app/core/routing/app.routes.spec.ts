import { AuthCallbackPage } from '../../domains/identity/feature/auth-callback/auth-callback.page';
import { appRootRedirectGuard, authGuard, cabinetDashboardGuard, tenantGuard } from './auth.guards';
import { routes } from './app.routes';
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
    signOut: vi.fn()
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
    const { OnboardingPage } = await import(
      '../../domains/identity/feature/onboarding/onboarding.page'
    );

    expect(component).toBe(OnboardingPage);
    expect(onboardingRoute?.canActivate).toEqual([authGuard]);
    expect(onboardingRoute?.canActivate).not.toContain(tenantGuard);
  });

  it('registers dashboard under the authenticated tenant shell', async () => {
    const shell = shellRoute();
    const dashboardRoute = shell?.children?.find((route) => route.path === 'dashboard');
    const component = await dashboardRoute?.loadComponent?.();
    const { DashboardPage } = await import('../feature/dashboard/dashboard.page');

    expect(shell?.canActivate).toEqual([authGuard, tenantGuard]);
    expect(component).toBe(DashboardPage);
  });

  it('registers the app root as an explicit authenticated redirect surface', async () => {
    const rootRoute = routes.find((route) => route.path === '' && route.pathMatch === 'full');
    const component = await rootRoute?.loadComponent?.();
    const { AppShellComponent } = await import('../../shared/layout/app-shell/app-shell.component');

    expect(rootRoute?.canActivate).toEqual([appRootRedirectGuard]);
    expect(component).toBe(AppShellComponent);
  });

  it('registers cabinet dashboard as an accounting-firm route', async () => {
    const shell = shellRoute();
    const cabinetDashboardRoute = shell?.children?.find(
      (route) => route.path === 'cabinet/dashboard'
    );
    const component = await cabinetDashboardRoute?.loadComponent?.();
    const { CabinetDashboardPage } = await import(
      '../../domains/identity/feature/cabinet-dashboard/cabinet-dashboard.page'
    );

    expect(shell?.canActivate).toEqual([authGuard, tenantGuard]);
    expect(component).toBe(CabinetDashboardPage);
    expect(cabinetDashboardRoute?.canActivate).toEqual([cabinetDashboardGuard]);
  });

  it('registers client dossiers as a distinct accounting-firm route', async () => {
    const shell = shellRoute();
    const cabinetDossiersRoute = shell?.children?.find(
      (route) => route.path === 'cabinet/dossiers'
    );
    const component = await cabinetDossiersRoute?.loadComponent?.();
    const { CabinetDossiersPage } = await import(
      '../../domains/identity/feature/cabinet-dossiers/cabinet-dossiers.page'
    );

    expect(component).toBe(CabinetDossiersPage);
    expect(cabinetDossiersRoute?.canActivate).toEqual([cabinetDashboardGuard]);
  });

  it('registers new client dossier creation inside the authenticated tenant shell', async () => {
    const shell = shellRoute();
    const newDossierRoute = shell?.children?.find(
      (route) => route.path === 'cabinet/dossiers/new'
    );
    const component = await newDossierRoute?.loadComponent?.();
    const { CabinetDossierNewPage } = await import(
      '../../domains/identity/feature/cabinet-dossier-new/cabinet-dossier-new.page'
    );

    expect(shell?.canActivate).toEqual([authGuard, tenantGuard]);
    expect(component).toBe(CabinetDossierNewPage);
    expect(newDossierRoute?.canActivate).toEqual([cabinetDashboardGuard]);
    expect(routes.find((route) => route.path === 'cabinet/dossiers/new')).toBeUndefined();
  });

  it('registers the accounting general-ledger route', async () => {
    const generalLedgerRoute = accountingChild('general-ledger');
    const component = await generalLedgerRoute?.loadComponent?.();
    const { GeneralLedgerPage } = await import(
      '../../domains/accounting/feature/general-ledger/general-ledger.page'
    );

    expect(component).toBe(GeneralLedgerPage);
    expect(generalLedgerRoute?.data?.['titleKey']).toBe('ACCOUNTING.PAGES.GENERAL_LEDGER.TITLE');
  });

  it('registers the accounting auxiliary-ledger route', async () => {
    const auxiliaryLedgerRoute = accountingChild('auxiliary-ledger');
    const component = await auxiliaryLedgerRoute?.loadComponent?.();
    const { AuxiliaryLedgerPage } = await import(
      '../../domains/accounting/feature/auxiliary-ledger/auxiliary-ledger.page'
    );

    expect(component).toBe(AuxiliaryLedgerPage);
    expect(auxiliaryLedgerRoute?.data?.['titleKey']).toBe(
      'ACCOUNTING.PAGES.AUXILIARY_LEDGER.TITLE'
    );
  });

  it('registers the accounting auxiliary-balance route', async () => {
    const auxiliaryBalanceRoute = accountingChild('auxiliary-balance');
    const component = await auxiliaryBalanceRoute?.loadComponent?.();
    const { AuxiliaryBalancePage } = await import(
      '../../domains/accounting/feature/auxiliary-balance/auxiliary-balance.page'
    );

    expect(component).toBe(AuxiliaryBalancePage);
    expect(auxiliaryBalanceRoute?.data?.['titleKey']).toBe(
      'ACCOUNTING.PAGES.AUXILIARY_BALANCE.TITLE'
    );
  });

  it('registers the accounting overview route with the simplified reporting content', async () => {
    const overviewRoute = accountingChild('');
    const component = await overviewRoute?.loadComponent?.();
    const { SimplifiedReportingPage } = await import(
      '../../domains/accounting/feature/simplified-reporting/simplified-reporting.page'
    );

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
    const { AccountsPage } = await import(
      '../../domains/accounting/feature/accounts/accounts.page'
    );

    expect(component).toBe(AccountsPage);
    expect(accountsRoute?.data?.['titleKey']).toBe('ACCOUNTING.PAGES.CHART_OF_ACCOUNTS.TITLE');
    expect(legacyChartRoute?.redirectTo).toBe('accounts');
  });

  it('registers the accounting third-party management route', async () => {
    const thirdPartiesRoute = accountingChild('third-parties');
    const component = await thirdPartiesRoute?.loadComponent?.();
    const { ThirdPartiesPage } = await import(
      '../../domains/accounting/feature/third-parties/third-parties.page'
    );

    expect(component).toBe(ThirdPartiesPage);
    expect(thirdPartiesRoute?.data?.['titleKey']).toBe('ACCOUNTING.PAGES.THIRD_PARTIES.TITLE');
  });

  it('registers the accounting fiscal-year route', async () => {
    const fiscalYearRoute = accountingChild('fiscal-years');
    const legacyFiscalYearRoute = accountingChild('fiscal-year');
    const component = await fiscalYearRoute?.loadComponent?.();
    const { FiscalYearPage } = await import(
      '../../domains/accounting/feature/fiscal-year/fiscal-year.page'
    );

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
        'trial-balance'
      ])
    );
    expect(accountingChild('reports/simplified')?.redirectTo).toBe('/accounting');
    expect(route?.children?.some((childRoute) => childRoute.path?.startsWith('accounting/'))).toBe(false);
  });

  it('registers the accounting lettering route', async () => {
    const letteringRoute = accountingChild('lettering');
    const component = await letteringRoute?.loadComponent?.();
    const { LetteringPage } = await import(
      '../../domains/accounting/feature/lettering/lettering.page'
    );

    expect(component).toBe(LetteringPage);
    expect(letteringRoute?.data?.['titleKey']).toBe('ACCOUNTING.PAGES.LETTERING.TITLE');
  });

  it('registers dedicated accounting entry create and draft edit routes', async () => {
    const newEntryRoute = accountingChild('entries/new');
    const editEntryRoute = accountingChild('entries/:entryId/edit');
    const newComponent = await newEntryRoute?.loadComponent?.();
    const editComponent = await editEntryRoute?.loadComponent?.();
    const { EntryFormPage } = await import(
      '../../domains/accounting/feature/entry-form/entry-form.page'
    );

    expect(newComponent).toBe(EntryFormPage);
    expect(editComponent).toBe(EntryFormPage);
    expect(newEntryRoute?.data?.['titleKey']).toBe('ACCOUNTING.ENTRIES.FORM.NEW_TITLE');
    expect(editEntryRoute?.data?.['titleKey']).toBe('ACCOUNTING.ENTRIES.FORM.EDIT_TITLE');
  });

  it('registers the dedicated accounting entry detail route', async () => {
    const detailEntryRoute = accountingChild('entries/:entryId');
    const component = await detailEntryRoute?.loadComponent?.();
    const { EntryDetailPage } = await import(
      '../../domains/accounting/feature/entry-detail/entry-detail.page'
    );

    expect(component).toBe(EntryDetailPage);
    expect(detailEntryRoute?.data?.['titleKey']).toBe('ACCOUNTING.ENTRIES.DETAIL.TITLE');
  });
});
