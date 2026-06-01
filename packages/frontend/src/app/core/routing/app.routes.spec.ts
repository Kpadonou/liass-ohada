import { AuthCallbackPage } from '../../domains/identity/feature/auth-callback/auth-callback.page';
import { routes } from './app.routes';

describe('routes', () => {
  it('registers the OAuth callback as a technical identity route', () => {
    const callbackRoute = routes.find((route) => route.path === 'auth/callback');

    expect(callbackRoute?.component).toBe(AuthCallbackPage);
    expect(callbackRoute?.canActivate).toBeUndefined();
  });
});
