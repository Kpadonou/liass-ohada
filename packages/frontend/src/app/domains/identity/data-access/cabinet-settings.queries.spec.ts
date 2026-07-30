import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AuthStore } from './auth.store';
import { CabinetSettingsApi } from './cabinet-settings.api';
import { CabinetSettingsCapabilities } from './cabinet-settings-capabilities';
import { CabinetSettingsQueries } from './cabinet-settings.queries';

describe('CabinetSettingsQueries', () => {
  const activeWorkspaceOrgId = signal<string | null>('org-cabinet-a');
  const activeDossierOrgId = signal<string | null>(null);
  const allowed = signal(true);

  beforeEach(() => {
    activeWorkspaceOrgId.set('org-cabinet-a');
    activeDossierOrgId.set(null);
    allowed.set(true);
    TestBed.configureTestingModule({
      providers: [
        CabinetSettingsQueries,
        { provide: CabinetSettingsApi, useValue: { getCabinetSettings: vi.fn() } },
        {
          provide: CabinetSettingsCapabilities,
          useValue: { canManageCabinetSettings: allowed }
        },
        {
          provide: AuthStore,
          useValue: { activeDossierOrgId, activeWorkspaceOrgId }
        }
      ]
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('keys Settings only by the active Cabinet workspace', () => {
    const queries = TestBed.inject(CabinetSettingsQueries);
    expect(queries.detail().queryKey).toEqual(['cabinet-settings', 'org-cabinet-a', 'detail']);

    activeDossierOrgId.set('org-client');
    expect(queries.detail().queryKey).toEqual(['cabinet-settings', 'org-cabinet-a', 'detail']);

    activeWorkspaceOrgId.set('org-cabinet-b');
    expect(queries.detail().queryKey).toEqual(['cabinet-settings', 'org-cabinet-b', 'detail']);
  });

  it('disables Settings loading when the centralized capability is unavailable', () => {
    const queries = TestBed.inject(CabinetSettingsQueries);
    allowed.set(false);
    expect(queries.detail().enabled).toBe(false);
  });
});
