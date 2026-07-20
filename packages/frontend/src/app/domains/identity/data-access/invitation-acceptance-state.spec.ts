import { TestBed } from '@angular/core/testing';

import { InvitationAcceptanceState } from './invitation-acceptance-state';

describe('InvitationAcceptanceState', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('keeps a valid token only in short-lived session storage', () => {
    const state = TestBed.inject(InvitationAcceptanceState);
    const token = 'a'.repeat(48);
    expect(state.captureToken(token)).toBe(true);
    expect(state.token()).toBe(token);
    expect(JSON.stringify(localStorage)).not.toContain(token);
    state.clearToken();
    expect(state.token()).toBeNull();
  });

  it('rejects incomplete tokens and constrains the auth return path', () => {
    const state = TestBed.inject(InvitationAcceptanceState);
    expect(state.captureToken('short')).toBe(false);
    state.rememberReturnToAcceptance();
    expect(state.consumeReturnUrl()).toBe('/accept-invitation');
    expect(state.consumeReturnUrl()).toBeNull();
  });
});
