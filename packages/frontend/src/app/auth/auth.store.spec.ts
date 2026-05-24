import { TestBed } from '@angular/core/testing';
import { getCurrentUser, signIn, signOut } from 'aws-amplify/auth';
import { vi } from 'vitest';

import { AuthStore } from './auth.store';

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn()
}));

describe('AuthStore', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(signIn).mockReset();
    vi.mocked(signOut).mockReset();
  });

  it('stores the current Cognito user after successful sign-in', async () => {
    const user = {
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    };
    vi.mocked(signIn).mockResolvedValue({
      isSignedIn: true,
      nextStep: { signInStep: 'DONE' }
    });
    vi.mocked(getCurrentUser).mockResolvedValue(user);

    const store = TestBed.inject(AuthStore);
    await store.login('user@example.com', 'password');

    expect(store.user()).toEqual(user);
    expect(store.isAuthenticated()).toBe(true);
  });

  it('persists the selected active tenant', () => {
    const store = TestBed.inject(AuthStore);

    store.setTenant('  org-test  ');

    expect(store.activeOrgId()).toBe('org-test');
    expect(localStorage.getItem('liass-ohada.activeOrgId')).toBe('org-test');
  });

  it('clears user and tenant state on logout', async () => {
    vi.mocked(signOut).mockResolvedValue(undefined);
    const store = TestBed.inject(AuthStore);
    store.setTenant('org-test');

    await store.logout();

    expect(store.user()).toBeNull();
    expect(store.activeOrgId()).toBeNull();
    expect(localStorage.getItem('liass-ohada.activeOrgId')).toBeNull();
  });
});
