import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { OnboardingApi } from './onboarding.api';
const timestamp = '2026-10-10T00:00:00.000Z';
const request = {
  workspaceType: 'COMPANY' as const,
  organizationName: 'Héritage Bistro',
  country: 'BJ' as const,
  products: ['RESTAURANTS' as const]
};
const result = {
  organization: {
    orgId: 'org-created',
    name: 'Héritage Bistro',
    country: 'BJ',
    workspaceType: 'COMPANY',
    status: 'ACTIVE',
    createdAt: timestamp,
    updatedAt: timestamp
  },
  workspace: {
    orgId: 'org-created',
    role: 'OWNER',
    workspaceType: 'COMPANY',
    productRoles: { RESTAURANTS: 'OWNER' }
  },
  cabinet: null,
  activeOrgId: 'org-created',
  productAccess: [
    {
      orgId: 'org-created',
      productCode: 'RESTAURANTS',
      status: 'ACTIVE',
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ]
};
describe('OnboardingApi', () => {
  let http: HttpTestingController, api: OnboardingApi;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    api = TestBed.inject(OnboardingApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('posts the validated RESTAURANTS-only request without any Accounting configuration', async () => {
    const pending = api.createInitialWorkspace(request);
    const call = http.expectOne((req) => req.url.endsWith('/me/workspaces'));
    expect(call.request.method).toBe('POST');
    expect(call.request.body).toEqual(request);
    expect(call.request.body).not.toHaveProperty('accountingFramework');
    call.flush(result);
    expect(await pending).toEqual(result);
  });
  it('rejects empty product selection before sending a request', async () => {
    await expect(api.createInitialWorkspace({ ...request, products: [] })).rejects.toThrow();
    http.expectNone((req) => req.url.endsWith('/me/workspaces'));
  });
  it.each([
    { activeOrgId: 'foreign' },
    { productAccess: [{ ...result.productAccess[0], orgId: 'foreign' }] },
    { organization: { ...result.organization, PK: 'physical-key' } },
    { organization: null }
  ])('rejects malformed/incoherent creation responses (%j)', async (override) => {
    const pending = api.createInitialWorkspace(request);
    const rejected = expect(pending).rejects.toThrow();
    http.expectOne((req) => req.url.endsWith('/me/workspaces')).flush({ ...result, ...override });
    await rejected;
  });
});
