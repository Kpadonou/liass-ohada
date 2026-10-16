import { signal } from '@angular/core';
import type { WorkspaceSummary } from '@liass-ohada/shared/shared';
import { AuthStore } from './auth.store';
import { RestaurantsCapabilities } from '../../restaurants/data-access/restaurants-capabilities';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { WorkspacesApi } from './workspaces.api';

describe('WorkspacesApi', () => {
  it('maps a legacy accounting-firm owner to Cabinet Administrator', async () => {
    TestBed.configureTestingModule({
      providers: [WorkspacesApi, provideHttpClient(), provideHttpClientTesting()],
    });
    const api = TestBed.inject(WorkspacesApi);
    const http = TestBed.inject(HttpTestingController);

    const response = api.listWorkspaces();
    http
      .expectOne((request) => request.url.endsWith('/me/workspaces'))
      .flush({
        workspaces: [
          {
            orgId: 'org-cabinet',
            role: 'OWNER',
            workspaceType: 'ACCOUNTING_FIRM',
            status: 'ACTIVE',
          },
        ],
      });

    await expect(response).resolves.toEqual([
      expect.objectContaining({
        orgId: 'org-cabinet',
        cabinetRole: 'CABINET_ADMIN',
      }),
    ]);
    http.verify();
  });

  it('does not grant a Cabinet role to a non-owner legacy member', async () => {
    TestBed.configureTestingModule({
      providers: [WorkspacesApi, provideHttpClient(), provideHttpClientTesting()],
    });
    const api = TestBed.inject(WorkspacesApi);
    const http = TestBed.inject(HttpTestingController);

    const response = api.listWorkspaces();
    http
      .expectOne((request) => request.url.endsWith('/me/workspaces'))
      .flush({
        workspaces: [
          {
            orgId: 'org-cabinet',
            role: 'MEMBER',
            workspaceType: 'ACCOUNTING_FIRM',
            status: 'ACTIVE',
          },
        ],
      });

    await expect(response).resolves.toEqual([expect.objectContaining({ cabinetRole: undefined })]);
    http.verify();
  });
});

describe('workspace product-role discovery', () => {
  it.each(['OWNER', 'MANAGER', 'WAITER', 'CASHIER', 'KITCHEN'])(
    'preserves the server-assigned RESTAURANTS %s role',
    async (role) => {
      TestBed.configureTestingModule({
        providers: [WorkspacesApi, provideHttpClient(), provideHttpClientTesting()],
      });
      const response = TestBed.inject(WorkspacesApi).listWorkspaces();
      const http = TestBed.inject(HttpTestingController);
      http
        .expectOne((request) => request.url.endsWith('/me/workspaces'))
        .flush({
          workspaces: [
            {
              orgId: 'beta',
              workspaceType: 'COMPANY',
              accessSource: 'DIRECT',
              productRoles: { RESTAURANTS: role },
            },
          ],
        });
      await expect(response).resolves.toEqual([
        expect.objectContaining({ productRoles: { RESTAURANTS: role } }),
      ]);
      http.verify();
    },
  );
  it.each([undefined, { RESTAURANTS: 'INVALID' }, { RESTAURANTS: ['OWNER'] }])(
    'distinguishes absent roles from malformed authorization data: %j',
    async (productRoles) => {
      TestBed.configureTestingModule({
        providers: [WorkspacesApi, provideHttpClient(), provideHttpClientTesting()],
      });
      const response = TestBed.inject(WorkspacesApi).listWorkspaces();
      const http = TestBed.inject(HttpTestingController);
      http
        .expectOne((request) => request.url.endsWith('/me/workspaces'))
        .flush({
          workspaces: [{ orgId: 'beta', workspaceType: 'COMPANY', role: 'OWNER', productRoles }],
        });
      if (productRoles === undefined)
        await expect(response).resolves.toEqual([
          expect.objectContaining({ productRoles: undefined }),
        ]);
      else await expect(response).rejects.toThrow();
      http.verify();
    },
  );
});

describe('discovered workspace restaurant permissions', () => {
  it('retains OWNER capabilities after discovery instead of dropping the onboarding role', async () => {
    const workspace = signal<WorkspaceSummary | undefined>(undefined);
    TestBed.configureTestingModule({
      providers: [
        WorkspacesApi,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthStore,
          useValue: {
            activeWorkspace: workspace,
            activeWorkspaceType: () => workspace()?.workspaceType,
            effectiveOrgId: () => workspace()?.orgId,
          },
        },
      ],
    });
    const api = TestBed.inject(WorkspacesApi),
      http = TestBed.inject(HttpTestingController);
    const capabilities = TestBed.inject(RestaurantsCapabilities);
    const pending = api.listWorkspaces();
    http
      .expectOne((request) => request.url.endsWith('/me/workspaces'))
      .flush({
        workspaces: [
          {
            orgId: 'beta',
            workspaceType: 'COMPANY',
            accessSource: 'DIRECT',
            role: 'OWNER',
            productRoles: { RESTAURANTS: 'OWNER' },
          },
        ],
      });
    workspace.set((await pending)[0]);
    expect(capabilities.canRead()).toBe(true);
    expect(capabilities.canReadMenu()).toBe(true);
    expect(capabilities.canManageSetup()).toBe(true);
    expect(capabilities.canManageMenu()).toBe(true);
    http.verify();
  });
});
