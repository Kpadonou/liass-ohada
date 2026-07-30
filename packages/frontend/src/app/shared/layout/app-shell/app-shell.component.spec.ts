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
    signOut: vi.fn(),
  };

  return globalScope.__liassAmplifyAuthMock;
});

describe('pageFromUrl', () => {
  it('maps direct cabinet URLs to their cabinet shell pages', () => {
    expect(pageFromUrl('/cabinet/team')).toBe('cabinet.team');
    expect(pageFromUrl('/cabinet/team?tab=members')).toBe('cabinet.team');
    expect(pageFromUrl('/cabinet/dashboard')).toBe('cabinet.dashboard');
    expect(pageFromUrl('/cabinet/dossiers')).toBe('cabinet.dossiers');
    expect(pageFromUrl('/cabinet/settings')).toBe('cabinet.settings');
  });

  it('maps direct accounting child URLs to their shell page', () => {
    expect(pageFromUrl('/accounting/auxiliary-balance')).toBe('accounting.auxiliaryBalance');
    expect(pageFromUrl('/accounting/auxiliary-balance?status=ACTIVE')).toBe(
      'accounting.auxiliaryBalance',
    );
    expect(pageFromUrl('/accounting/auxiliary-ledger')).toBe('accounting.auxiliaryLedger');
    expect(pageFromUrl('/accounting/reports/simplified')).toBe('accounting.overview');
    expect(pageFromUrl('/accounting/reports/simplified?fiscalYear=2026')).toBe(
      'accounting.overview',
    );
    expect(pageFromUrl('/accounting')).toBe('accounting.overview');
  });
});
