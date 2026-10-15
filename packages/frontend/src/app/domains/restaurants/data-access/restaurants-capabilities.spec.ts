import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantsCapabilities } from './restaurants-capabilities';
describe('Independent scoped RESTAURANTS permissions', () => {
  const workspace = signal<{
    orgId: string;
    role: string;
    productRoles?: { RESTAURANTS: string };
    accessSource?: string;
  }>({ orgId: 'org', role: 'OWNER' });
  const org = signal('org');
  const type = signal('COMPANY');
  beforeEach(() => {
    org.set('org');
    type.set('COMPANY');
    workspace.set({ orgId: 'org', role: 'OWNER' });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthStore,
          useValue: { activeWorkspace: workspace, effectiveOrgId: org, activeWorkspaceType: type },
        },
      ],
    });
  });
  afterEach(() => TestBed.resetTestingModule());
  it('never grants through global OWNER', () => {
    const caps = TestBed.inject(RestaurantsCapabilities);
    expect(caps.canRead()).toBe(false);
    expect(caps.canManageSetup()).toBe(false);
  });
  it.each(['OWNER', 'MANAGER', 'WAITER', 'CASHIER', 'KITCHEN'])('projects %s', (role) => {
    workspace.set({ orgId: 'org', role: 'OWNER', productRoles: { RESTAURANTS: role } });
    const caps = TestBed.inject(RestaurantsCapabilities);
    expect(caps.canRead()).toBe(true);
    expect(caps.canReadMenu()).toBe(true);
    expect(caps.canManageSetup()).toBe(['OWNER', 'MANAGER'].includes(role));
    expect(caps.canManageMenu()).toBe(caps.canManageSetup());
    expect(caps.canReadStaff()).toBe(caps.canManageSetup());
    expect(caps.canManageStaff()).toBe(caps.canManageSetup());
    expect(caps.canReadService()).toBe(['OWNER', 'MANAGER'].includes(role));
    expect(caps.canManageResponsibility()).toBe(['OWNER', 'MANAGER'].includes(role));
    expect(caps.canOpenSession()).toBe(caps.canReadService());
  });
  it('fails closed on workspace/cabinet context changes', () => {
    workspace.set({ orgId: 'org', role: 'OWNER', productRoles: { RESTAURANTS: 'OWNER' } });
    const caps = TestBed.inject(RestaurantsCapabilities);
    org.set('other');
    expect(caps.canRead()).toBe(false);
    org.set('org');
    type.set('ACCOUNTING_FIRM');
    expect(caps.canRead()).toBe(false);
    type.set('COMPANY');
    workspace.update((value) => ({ ...value, accessSource: 'CABINET_LINK' }));
    expect(caps.canRead()).toBe(false);
  });
});
