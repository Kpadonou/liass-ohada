import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { OrganizationInvitationsApi } from './organization-invitations.api';
import { AuthStore } from './auth.store';
import { ZodError } from 'zod';
const user = signal('owner'),
  org = signal('org'),
  role = signal('OWNER');
let api: OrganizationInvitationsApi, http: HttpTestingController;
beforeEach(() => {
  user.set('owner');
  org.set('org');
  role.set('OWNER');
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: AuthStore,
        useValue: {
          currentUserId: user,
          effectiveOrgId: org,
          activeWorkspaceType: () => 'COMPANY',
          activeWorkspace: () => ({
            orgId: org(),
            role: role(),
            status: 'ACTIVE',
            accessSource: 'DIRECT',
          }),
        },
      },
    ],
  });
  api = TestBed.inject(OrganizationInvitationsApi);
  http = TestBed.inject(HttpTestingController);
});
afterEach(() => {
  http.verify();
  TestBed.resetTestingModule();
});
it('normalizes email and sends only canonical invitation intent', async () => {
  const id = crypto.randomUUID();
  const promise = api.create('org', 'owner', {
    clientRequestId: id,
    email: ' Person@Example.test ',
  });
  const req = http.expectOne((r) => r.url.endsWith('/me/organization/invitations'));
  expect(req.request.body).toEqual({ clientRequestId: id, email: 'person@example.test' });
  req.flush({
    invitation: {
      invitationId: crypto.randomUUID(),
      email: 'person@example.test',
      status: 'PENDING',
      expiresAt: '2026-11-01T00:00:00Z',
    },
    deliveryMode: 'UNAVAILABLE',
  });
  await expect(promise).resolves.toMatchObject({ deliveryMode: 'UNAVAILABLE' });
});
it.each(['MEMBER', 'MANAGER', 'WAITER', 'CASHIER', 'KITCHEN'])(
  'does not grant Platform invitation authority to %s',
  async (value) => {
    role.set(value);
    await expect(api.create('org', 'owner', {})).rejects.toBeDefined();
    http.expectNone(() => true);
  },
);
it('rejects unknown request fields before HTTP', async () => {
  await expect(
    api.create('org', 'owner', {
      clientRequestId: crypto.randomUUID(),
      email: 'a@example.test',
      role: 'WAITER',
    }),
  ).rejects.toBeInstanceOf(ZodError);
});
it('accepts without tenant context and binds response to the initiating identity', async () => {
  org.set('');
  const token = 'a'.repeat(43);
  const promise = api.accept('owner', token);
  const assertion = expect(promise).rejects.toBeDefined();
  const req = http.expectOne((r) => r.url.endsWith('/invitations/accept'));
  expect(req.request.body).toEqual({ token });
  user.set('other');
  req.flush({ organizationId: 'org', membershipStatus: 'ACTIVE' });
  await assertion;
});
it('rejects malformed acceptance response', async () => {
  const promise = api.accept('owner', 'a'.repeat(43));
  const assertion = expect(promise).rejects.toBeInstanceOf(ZodError);
  http
    .expectOne((r) => r.url.endsWith('/invitations/accept'))
    .flush({
      organizationId: 'org',
      membershipStatus: 'ACTIVE',
      productRoles: { RESTAURANTS: 'WAITER' },
    });
  await assertion;
});
