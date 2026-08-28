import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AuthStore } from '../../identity/data-access/auth.store';
import { SalesCapabilities } from './sales-capabilities';

describe('SalesCapabilities', () => {
  const effectiveOrgId = signal<string | null>(null);
  const workspaceType = signal<'COMPANY' | 'ACCOUNTING_FIRM' | undefined>(undefined);
  const workspace = signal<{ role?: string } | null>(null);

  beforeEach(() => {
    effectiveOrgId.set(null);
    workspaceType.set(undefined);
    workspace.set(null);
    TestBed.configureTestingModule({
      providers: [
        SalesCapabilities,
        {
          provide: AuthStore,
          useValue: {
            activeWorkspace: workspace,
            activeWorkspaceType: workspaceType,
            effectiveOrgId
          }
        }
      ]
    });
  });

  it('maps the current direct OWNER projection to SALES_READ and SALES_WRITE', () => {
    effectiveOrgId.set('org-sales');
    workspaceType.set('COMPANY');
    workspace.set({ role: 'OWNER' });

    const capabilities = TestBed.inject(SalesCapabilities);
    expect(capabilities.canRead()).toBe(true);
    expect(capabilities.canWrite()).toBe(true);
  });

  it('does not infer SALES permissions from a non-owner direct role', () => {
    effectiveOrgId.set('org-sales');
    workspaceType.set('COMPANY');
    workspace.set({ role: 'MEMBER' });

    const capabilities = TestBed.inject(SalesCapabilities);
    expect(capabilities.canRead()).toBe(false);
    expect(capabilities.canWrite()).toBe(false);
  });

  it('does not introduce a Cabinet SALES permission bypass', () => {
    effectiveOrgId.set('org-client');
    workspaceType.set('ACCOUNTING_FIRM');
    workspace.set({ role: 'OWNER' });

    const capabilities = TestBed.inject(SalesCapabilities);
    expect(capabilities.canRead()).toBe(false);
    expect(capabilities.canWrite()).toBe(false);
  });
});
