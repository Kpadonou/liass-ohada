import { describe, expect, it, vi } from 'vitest';

import { pageFromUrl } from './app-shell.component';

vi.mock('aws-amplify/auth', () => {
  const globalScope = globalThis as unknown as {
    __liassAmplifyAuthMock?: Record<string, ReturnType<typeof vi.fn>>;
  };
  globalScope.__liassAmplifyAuthMock ??= {
    confirmSignIn: vi.fn(),
    fetchAuthSession: vi.fn(),
    fetchUserAttributes: vi.fn(),
    getCurrentUser: vi.fn(),
    signIn: vi.fn(),
    signInWithRedirect: vi.fn(),
    signOut: vi.fn()
  };

  return globalScope.__liassAmplifyAuthMock;
});

describe('pageFromUrl', () => {
  it('maps direct accounting child URLs to their shell page', () => {
    expect(pageFromUrl('/accounting/auxiliary-balance')).toBe('accounting.auxiliaryBalance');
    expect(pageFromUrl('/accounting/auxiliary-balance?status=ACTIVE')).toBe(
      'accounting.auxiliaryBalance'
    );
    expect(pageFromUrl('/accounting/auxiliary-ledger')).toBe('accounting.auxiliaryLedger');
    expect(pageFromUrl('/accounting')).toBe('accounting.overview');
  });
});
