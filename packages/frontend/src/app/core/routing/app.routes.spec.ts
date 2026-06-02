import { AuthCallbackPage } from '../../domains/identity/feature/auth-callback/auth-callback.page';
import { OnboardingPage } from '../../domains/identity/feature/onboarding/onboarding.page';
import { authGuard, tenantGuard } from './auth.guards';
import { routes } from './app.routes';

describe('routes', () => {
  it('registers the OAuth callback as a technical identity route', () => {
    const callbackRoute = routes.find((route) => route.path === 'auth/callback');

    expect(callbackRoute?.component).toBe(AuthCallbackPage);
    expect(callbackRoute?.canActivate).toBeUndefined();
  });

  it('registers onboarding as an authenticated pre-tenant identity route', () => {
    const onboardingRoute = routes.find((route) => route.path === 'onboarding');

    expect(onboardingRoute?.component).toBe(OnboardingPage);
    expect(onboardingRoute?.canActivate).toEqual([authGuard]);
    expect(onboardingRoute?.canActivate).not.toContain(tenantGuard);
  });
});
