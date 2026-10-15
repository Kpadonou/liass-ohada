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

it('keeps COMPANY auth return isolated from Cabinet and rejects malformed replacement tokens', () => {
  const state = TestBed.inject(InvitationAcceptanceState);
  expect(state.captureToken('a'.repeat(43), true)).toBe(true);
  expect(state.isCompany()).toBe(true);
  state.rememberReturnToAcceptance();
  expect(state.consumeReturnUrl()).toBe('/accept-company-invitation');
  expect(state.captureToken('invalid', true)).toBe(false);
  expect(state.token()).toBeNull();
});

it('binds COMPANY context on authenticated return and clears every transient field on completion or account change', () => {
  const state = TestBed.inject(InvitationAcceptanceState);
  state.captureToken('b'.repeat(43), true);
  state.rememberReturnToAcceptance();
  expect(state.bindUser('first')).toBe(true);
  expect(state.bindUser('second')).toBe(false);
  expect(state.token()).toBeNull();
  expect(state.consumeReturnUrl()).toBeNull();
  state.captureToken('c'.repeat(43), true);
  state.rememberReturnToAcceptance();
  state.clearToken();
  expect(state.isCompany()).toBe(false);
  expect(state.consumeReturnUrl()).toBeNull();
});
