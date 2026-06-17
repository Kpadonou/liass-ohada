import { AuthCallbackPage } from '../../domains/identity/feature/auth-callback/auth-callback.page';
import { appRootRedirectGuard, authGuard, cabinetDashboardGuard, tenantGuard } from './auth.guards';
import { routes } from './app.routes';

function shellRoute() {
  return routes.find((route) => route.path === '' && route.children);
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
    const shell = shellRoute();
    const generalLedgerRoute = shell?.children?.find(
      (route) => route.path === 'accounting/general-ledger'
    );
    const component = await generalLedgerRoute?.loadComponent?.();
    const { GeneralLedgerPage } = await import(
      '../../domains/accounting/feature/general-ledger/general-ledger.page'
    );

    expect(component).toBe(GeneralLedgerPage);
    expect(generalLedgerRoute?.data?.['titleKey']).toBe('ACCOUNTING.PAGES.GENERAL_LEDGER.TITLE');
  });

  it('registers the accounting overview route', async () => {
    const shell = shellRoute();
    const accountingRoute = shell?.children?.find((route) => route.path === 'accounting');
    const component = await accountingRoute?.loadComponent?.();
    const { AccountingOverviewPage } = await import(
      '../../domains/accounting/feature/accounting-overview/accounting-overview.page'
    );

    expect(component).toBe(AccountingOverviewPage);
    expect(accountingRoute?.data?.['titleKey']).toBe('ACCOUNTING.PAGES.OVERVIEW.TITLE');
  });

  it('registers the accounting accounts route and keeps the historical chart route as an alias', async () => {
    const shell = shellRoute();
    const accountsRoute = shell?.children?.find((route) => route.path === 'accounting/accounts');
    const legacyChartRoute = shell?.children?.find(
      (route) => route.path === 'accounting/chart-of-accounts'
    );
    const component = await accountsRoute?.loadComponent?.();
    const { AccountsPage } = await import(
      '../../domains/accounting/feature/accounts/accounts.page'
    );

    expect(component).toBe(AccountsPage);
    expect(accountsRoute?.data?.['titleKey']).toBe('ACCOUNTING.PAGES.CHART_OF_ACCOUNTS.TITLE');
    expect(legacyChartRoute?.redirectTo).toBe('/accounting/accounts');
  });

  it('registers the accounting fiscal-year route', async () => {
    const shell = shellRoute();
    const fiscalYearRoute = shell?.children?.find(
      (route) => route.path === 'accounting/fiscal-years'
    );
    const legacyFiscalYearRoute = shell?.children?.find(
      (route) => route.path === 'accounting/fiscal-year'
    );
    const component = await fiscalYearRoute?.loadComponent?.();
    const { FiscalYearPage } = await import(
      '../../domains/accounting/feature/fiscal-year/fiscal-year.page'
    );

    expect(component).toBe(FiscalYearPage);
    expect(fiscalYearRoute?.data?.['titleKey']).toBe('ACCOUNTING.PAGES.FISCAL_YEAR.TITLE');
    expect(legacyFiscalYearRoute?.redirectTo).toBe('accounting/fiscal-years');
  });

  it('registers the accounting lettering route', async () => {
    const shell = shellRoute();
    const letteringRoute = shell?.children?.find(
      (route) => route.path === 'accounting/lettering'
    );
    const component = await letteringRoute?.loadComponent?.();
    const { LetteringPage } = await import(
      '../../domains/accounting/feature/lettering/lettering.page'
    );

    expect(component).toBe(LetteringPage);
    expect(letteringRoute?.data?.['titleKey']).toBe('ACCOUNTING.PAGES.LETTERING.TITLE');
  });
});
