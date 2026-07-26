import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CabinetRole } from '@liass-ohada/shared/shared';
import { vi } from 'vitest';

import { AuthStore } from './auth.store';
import { CabinetDashboardApi } from './cabinet-dashboard.api';
import { CabinetDashboardQueries } from './cabinet-dashboard.queries';

describe('CabinetDashboardQueries', () => {
  const activeWorkspaceOrgId = signal<string | null>('org-cabinet-a');
  const activeDossierOrgId = signal<string | null>(null);
  const activeWorkspaceType = signal<'ACCOUNTING_FIRM' | 'COMPANY' | null>('ACCOUNTING_FIRM');
  const activeCabinetRole = signal<CabinetRole | null>('CABINET_ADMIN');

  beforeEach(() => {
    activeWorkspaceOrgId.set('org-cabinet-a');
    activeDossierOrgId.set(null);
    activeWorkspaceType.set('ACCOUNTING_FIRM');
    activeCabinetRole.set('CABINET_ADMIN');
    TestBed.configureTestingModule({
      providers: [
        CabinetDashboardQueries,
        { provide: CabinetDashboardApi, useValue: { getCabinetDashboard: vi.fn() } },
        {
          provide: AuthStore,
          useValue: {
            activeWorkspaceOrgId,
            activeDossierOrgId,
            activeWorkspaceType,
            activeCabinetRole
          }
        }
      ]
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('keys dashboard data by active cabinet workspace only', () => {
    const queries = TestBed.inject(CabinetDashboardQueries);

    expect(queries.detail().queryKey).toEqual(['cabinet-dashboard', 'org-cabinet-a', 'detail']);

    activeDossierOrgId.set('org-client-1');
    expect(queries.detail().queryKey).toEqual(['cabinet-dashboard', 'org-cabinet-a', 'detail']);

    activeWorkspaceOrgId.set('org-cabinet-b');
    expect(queries.detail().queryKey).toEqual(['cabinet-dashboard', 'org-cabinet-b', 'detail']);
  });

  it('disables dashboard loading outside an active cabinet context', () => {
    const queries = TestBed.inject(CabinetDashboardQueries);

    activeWorkspaceType.set('COMPANY');
    expect(queries.detail().enabled).toBe(false);

    activeWorkspaceType.set('ACCOUNTING_FIRM');
    activeCabinetRole.set(null);
    expect(queries.detail().enabled).toBe(false);
  });
});
