import { TestBed } from '@angular/core/testing';
import { convertToParamMap, provideRouter, Router } from '@angular/router';
import { invitationAcceptanceGuard } from './auth.guards';
import { InvitationAcceptanceState } from '../../domains/identity/data-access/invitation-acceptance-state';
import { AuthStore } from '../../domains/identity/data-access/auth.store';
it('preserves only COMPANY acceptance context through canonical login with no active tenant', async () => {
  sessionStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthStore, useValue: { hydrated: () => true, isAuthenticated: () => false } },
    ],
  });
  const result = await TestBed.runInInjectionContext(() =>
    invitationAcceptanceGuard(
      {
        routeConfig: { path: 'accept-company-invitation' },
        queryParamMap: convertToParamMap({ token: 'a'.repeat(43) }),
      } as never,
      {} as never,
    ),
  );
  expect(TestBed.inject(Router).serializeUrl(result as never)).toBe(
    '/login?returnUrl=%2Faccept-company-invitation',
  );
  const state = TestBed.inject(InvitationAcceptanceState);
  expect(state.token()).toBe('a'.repeat(43));
  expect(state.consumeReturnUrl()).toBe('/accept-company-invitation');
  TestBed.resetTestingModule();
  sessionStorage.clear();
});
