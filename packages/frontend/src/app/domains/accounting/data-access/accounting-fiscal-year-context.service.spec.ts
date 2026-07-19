import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AuthStore } from '../../identity/data-access/auth.store';
import { AccountingFiscalYearContextService } from './accounting-fiscal-year-context.service';

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

describe('AccountingFiscalYearContextService', () => {
  let activeWorkspaceType = signal<'COMPANY' | 'ACCOUNTING_FIRM' | null>('COMPANY');
  let activeWorkspaceOrgId = signal<string | null>('org-company-1');
  let activeDossierOrgId = signal<string | null>(null);

  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    activeWorkspaceType = signal<'COMPANY' | 'ACCOUNTING_FIRM' | null>('COMPANY');
    activeWorkspaceOrgId = signal<string | null>('org-company-1');
    activeDossierOrgId = signal<string | null>(null);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthStore,
          useValue: {
            activeDossierOrgId,
            activeWorkspaceOrgId,
            activeWorkspaceType,
            effectiveAccountingOrgId: computed(() =>
              activeWorkspaceType() === 'ACCOUNTING_FIRM'
                ? activeDossierOrgId()
                : activeWorkspaceOrgId()
            )
          }
        }
      ]
    });
  });

  it('keeps the active fiscal year scoped to the active company organization', () => {
    const service = TestBed.inject(AccountingFiscalYearContextService);

    service.selectFiscalYear(openFiscalYear(2026));

    expect(service.activeYear()).toBe(2026);
    expect(service.fiscalYears().map((fiscalYear) => fiscalYear.year)).toEqual([2026]);
  });

  it('resets the active fiscal year when the accounting-firm dossier changes', async () => {
    activeWorkspaceType.set('ACCOUNTING_FIRM');
    activeWorkspaceOrgId.set('org-firm-1');
    activeDossierOrgId.set('org-client-1');
    const service = TestBed.inject(AccountingFiscalYearContextService);

    service.selectFiscalYear(openFiscalYear(2026));
    expect(service.activeYear()).toBe(2026);

    activeDossierOrgId.set('org-client-2');
    await Promise.resolve();
    TestBed.flushEffects();

    expect(service.activeYear()).toBeNull();
    expect(service.fiscalYears()).toEqual([]);
  });

  it('auto-selects the only open fiscal year known for the current scope', () => {
    localStorage.setItem(
      'liass-ohada.accounting.fiscalYearContext.org-company-1',
      JSON.stringify({
        activeYear: null,
        fiscalYears: [openFiscalYear(2026)]
      })
    );

    const service = TestBed.inject(AccountingFiscalYearContextService);
    TestBed.flushEffects();

    expect(service.activeYear()).toBe(2026);
  });

  it('does not auto-select when multiple open fiscal years are known', () => {
    localStorage.setItem(
      'liass-ohada.accounting.fiscalYearContext.org-company-1',
      JSON.stringify({
        activeYear: null,
        fiscalYears: [openFiscalYear(2026), openFiscalYear(2025)]
      })
    );

    const service = TestBed.inject(AccountingFiscalYearContextService);
    TestBed.flushEffects();

    expect(service.activeYear()).toBeNull();
    expect(service.fiscalYears().map((fiscalYear) => fiscalYear.year)).toEqual([2026, 2025]);
  });
});

function openFiscalYear(year: number) {
  return {
    accountingFramework: 'SYSCOHADA_REVISED' as const,
    endDate: `${year}-12-31`,
    fiscalYearId: `FY#${year}`,
    startDate: `${year}-01-01`,
    status: 'OPEN' as const,
    year
  };
}
