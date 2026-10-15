import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { ZodError } from 'zod';
import { OrganizationMembersApi, canAdministerCompanyMembers } from './organization-members.api';
import { organizationMemberKeys, OrganizationMembersQueries } from './organization-members.queries';
import { AuthStore } from './auth.store';
import { environment } from '../../../../environments/environment';
const org = signal('org'),
  user = signal('owner');
const base = environment.apiBaseUrl.replace(/\/$/, '');
let api: OrganizationMembersApi, http: HttpTestingController;
beforeEach(() => {
  org.set('org');
  user.set('owner');
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthStore, useValue: { effectiveOrgId: org, currentUserId: user } },
      { provide: QueryClient, useValue: new QueryClient() },
    ],
  });
  api = TestBed.inject(OrganizationMembersApi);
  http = TestBed.inject(HttpTestingController);
});
afterEach(() => {
  http.verify();
  TestBed.resetTestingModule();
});
it('reads bounded pages including empty items with nextCursor', async () => {
  const promise = api.members('org', 'owner', 'opaque');
  const request = http.expectOne((req) => req.url.endsWith('/me/organization/members'));
  expect(request.request.params.get('limit')).toBe('50');
  expect(request.request.params.get('cursor')).toBe('opaque');
  request.flush({ items: [], nextCursor: 'next' });
  await expect(promise).resolves.toEqual({ items: [], nextCursor: 'next' });
});
it('sends only canonical initial-role body and validates target/result', async () => {
  const body = { role: 'WAITER', clientRequestId: crypto.randomUUID() };
  const promise = api.assignInitialRole('org', 'owner', 'member', body);
  const request = http.expectOne(
    base + '/me/organization/members/member/product-roles/RESTAURANTS',
  );
  expect(request.request.method).toBe('PUT');
  expect(request.request.body).toEqual(body);
  request.flush({ userId: 'member', productCode: 'RESTAURANTS', role: 'WAITER' });
  await expect(promise).resolves.toMatchObject({ userId: 'member' });
});
it.each(['OWNER', 'ACCOUNTANT'])(
  'rejects unsupported initial role %s without HTTP',
  async (role) => {
    await expect(
      api.assignInitialRole('org', 'owner', 'member', {
        role,
        clientRequestId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ZodError);
    http.expectNone((req) => req.url.includes('product-roles'));
  },
);
it('rejects malformed directory and private fields', async () => {
  const promise = api.members('org', 'owner');
  const assertion = expect(promise).rejects.toBeInstanceOf(ZodError);
  http
    .expectOne((req) => req.url.includes('organization/members'))
    .flush({ items: [{ userId: 'member', status: 'ACTIVE', sub: 'private' }] });
  await assertion;
});
it.each(['org', 'user'])('fails closed if %s changes during a response', async (kind) => {
  const promise = api.members('org', 'owner');
  const assertion = expect(promise).rejects.toBeDefined();
  const request = http.expectOne((req) => req.url.includes('organization/members'));
  if (kind === 'org') org.set('other');
  else user.set('other');
  request.flush({ items: [] });
  await assertion;
});
it('isolates directory query keys by both organization and actor without placeholder data', () => {
  const queries = TestBed.inject(OrganizationMembersQueries);
  expect(queries.members().queryKey).toEqual(organizationMemberKeys.directory('org', 'owner'));
  user.set('second');
  expect(queries.members().queryKey).toEqual(organizationMemberKeys.directory('org', 'second'));
  org.set('next');
  expect(queries.members().queryKey).toEqual(organizationMemberKeys.directory('next', 'second'));
  expect(queries.members().placeholderData).toBeUndefined();
});
it('administration follows active direct COMPANY OWNER membership, never a product role', () => {
  const workspace = { orgId: 'org', role: 'OWNER', status: 'ACTIVE' as const };
  expect(canAdministerCompanyMembers(workspace, 'COMPANY', 'org')).toBe(true);
  expect(
    canAdministerCompanyMembers(
      { ...workspace, role: 'MEMBER', productRoles: { RESTAURANTS: 'OWNER' } },
      'COMPANY',
      'org',
    ),
  ).toBe(false);
  expect(
    canAdministerCompanyMembers({ ...workspace, accessSource: 'CABINET' }, 'COMPANY', 'org'),
  ).toBe(false);
  expect(canAdministerCompanyMembers({ ...workspace, status: undefined }, 'COMPANY', 'org')).toBe(
    false,
  );
});
