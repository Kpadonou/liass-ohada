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
});
