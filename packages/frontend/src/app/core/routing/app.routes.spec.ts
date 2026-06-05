import { AuthCallbackPage } from '../../domains/identity/feature/auth-callback/auth-callback.page';
import { authGuard, tenantGuard } from './auth.guards';
import { routes } from './app.routes';

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
    const shellRoute = routes.find((route) => route.path === '');
    const dashboardRoute = shellRoute?.children?.find((route) => route.path === 'dashboard');
    const component = await dashboardRoute?.loadComponent?.();
    const { DashboardPage } = await import('../feature/dashboard/dashboard.page');

    expect(shellRoute?.canActivate).toEqual([authGuard, tenantGuard]);
    expect(component).toBe(DashboardPage);
  });

  it('registers the accounting general-ledger placeholder route', async () => {
    const shellRoute = routes.find((route) => route.path === '');
    const generalLedgerRoute = shellRoute?.children?.find(
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
