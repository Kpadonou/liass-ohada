import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { WorkspacesApi } from './workspaces.api';

describe('WorkspacesApi', () => {
  it('maps a legacy accounting-firm owner to Cabinet Administrator', async () => {
    TestBed.configureTestingModule({
      providers: [WorkspacesApi, provideHttpClient(), provideHttpClientTesting()]
    });
    const api = TestBed.inject(WorkspacesApi);
    const http = TestBed.inject(HttpTestingController);

    const response = api.listWorkspaces();
    http.expectOne((request) => request.url.endsWith('/me/workspaces')).flush({
      workspaces: [
        {
          orgId: 'org-cabinet',
          role: 'OWNER',
          workspaceType: 'ACCOUNTING_FIRM',
          status: 'ACTIVE'
        }
      ]
    });

    await expect(response).resolves.toEqual([
      expect.objectContaining({
        orgId: 'org-cabinet',
        cabinetRole: 'CABINET_ADMIN'
      })
    ]);
    http.verify();
  });

  it('does not grant a Cabinet role to a non-owner legacy member', async () => {
    TestBed.configureTestingModule({
      providers: [WorkspacesApi, provideHttpClient(), provideHttpClientTesting()]
    });
    const api = TestBed.inject(WorkspacesApi);
    const http = TestBed.inject(HttpTestingController);

    const response = api.listWorkspaces();
    http.expectOne((request) => request.url.endsWith('/me/workspaces')).flush({
      workspaces: [
        {
          orgId: 'org-cabinet',
          role: 'MEMBER',
          workspaceType: 'ACCOUNTING_FIRM',
          status: 'ACTIVE'
        }
      ]
    });

    await expect(response).resolves.toEqual([
      expect.objectContaining({ cabinetRole: undefined })
    ]);
    http.verify();
  });
});
