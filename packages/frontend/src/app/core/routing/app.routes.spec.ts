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

  it('registers the accounting general-ledger placeholder route', async () => {
    const shell = shellRoute();
    const generalLedgerRoute = shell?.children?.find(
      (route) => route.path === 'accounting/general-ledger'
    );
    const component = await generalLedgerRoute?.loadComponent?.();
    const { AccountingPlaceholderPage } = await import(
      '../../domains/accounting/feature/accounting-placeholder.page'
    );

    expect(component).toBe(AccountingPlaceholderPage);
    expect(generalLedgerRoute?.data?.['titleKey']).toBe('ACCOUNTING.PAGES.GENERAL_LEDGER.TITLE');
  });
});
