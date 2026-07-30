import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AuthStore } from './auth.store';
import { CabinetSettingsCapabilities } from './cabinet-settings-capabilities';

describe('CabinetSettingsCapabilities', () => {
  const workspace = signal<{
    workspaceType: 'ACCOUNTING_FIRM' | 'COMPANY';
    status?: 'ACTIVE';
    cabinetRole?: 'CABINET_ADMIN' | 'SUPERVISOR' | 'COLLABORATOR' | 'READER';
  } | null>(null);

  beforeEach(() => {
    workspace.set(null);
    TestBed.configureTestingModule({
      providers: [
        CabinetSettingsCapabilities,
        { provide: AuthStore, useValue: { activeWorkspace: workspace } }
      ]
    });
  });

  it('allows every active Cabinet Administrator without owner checks', () => {
    workspace.set({
      workspaceType: 'ACCOUNTING_FIRM',
      status: 'ACTIVE',
      cabinetRole: 'CABINET_ADMIN'
    });
    expect(TestBed.inject(CabinetSettingsCapabilities).canManageCabinetSettings()).toBe(true);
  });

  it.each(['SUPERVISOR', 'COLLABORATOR', 'READER'] as const)(
    'denies the %s Cabinet role',
    (cabinetRole) => {
      workspace.set({ workspaceType: 'ACCOUNTING_FIRM', status: 'ACTIVE', cabinetRole });
      expect(TestBed.inject(CabinetSettingsCapabilities).canManageCabinetSettings()).toBe(false);
    }
  );

  it('denies direct Company context', () => {
    workspace.set({ workspaceType: 'COMPANY', status: 'ACTIVE' });
    expect(TestBed.inject(CabinetSettingsCapabilities).canManageCabinetSettings()).toBe(false);
  });
});
