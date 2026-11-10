import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { FiscalityApi, fiscalityKey, fiscalProfileKey } from './fiscality.api';
import { AuthStore } from './auth.store';

const org = signal('org-a'),
  user = signal('owner'),
  revision = signal(1);
const connectionId = '1e2d42ac-a53b-4b18-bc6b-e33773097932';
const connection = {
  connectionId,
  label: 'Test',
  environment: 'TEST',
  version: 2,
  credentialStatus: 'STORED_UNVERIFIED',
  updatedAt: '2026-11-07T12:00:00.000Z',
};
let api: FiscalityApi, http: HttpTestingController;
beforeEach(() => {
  org.set('org-a');
  user.set('owner');
  revision.set(1);
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: AuthStore,
        useValue: {
          effectiveOrgId: org,
          currentUserId: user,
          contextRevision: revision,
          activeWorkspace: () => ({
            orgId: org(),
            status: 'ACTIVE',
            workspaceType: 'COMPANY',
            country: 'BJ',
            accessSource: 'DIRECT',
          }),
        },
      },
    ],
  });
  api = TestBed.inject(FiscalityApi);
  http = TestBed.inject(HttpTestingController);
});
afterEach(() => {
  http.verify();
  TestBed.resetTestingModule();
});
it('submits credential only to its scoped command and accepts only masked result', async () => {
  const input = {
    environment: 'TEST',
    connectionId,
    expectedVersion: 1,
    commandId: crypto.randomUUID(),
    token: 'a.b.synthetic',
  };
  const promise = api.change(api.context(), 'STORE_CREDENTIAL', input);
  const request = http.expectOne((req) => req.url.endsWith('/credential'));
  expect(request.request.method).toBe('PUT');
  expect(request.request.body.token).toBe(input.token);
  request.flush({ data: connection, message: { code: 'SAVED', message: 'Saved' } });
  const result = await promise;
  expect(JSON.stringify(result)).not.toContain(input.token);
});
it('rejects credentials in ordinary read responses', async () => {
  const promise = api.approval(api.context());
  const assertion = expect(promise).rejects.toBeDefined();
  http
    .expectOne((req) => req.url.endsWith('/sfe-approval'))
    .flush({ data: { status: 'UNAVAILABLE', approval: null, token: 'private' } });
  await assertion;
});
it('reads and selects only validated platform-governed fiscal regimes', async () => {
  const profile = {
    country: 'BJ',
    selected: null,
    regimes: [
      { id: 'ORDINARY_VAT', version: 1, taxRateBasisPoints: 1800, basis: 'NET_SALE' },
    ],
    canManage: true,
  };
  const read = api.profile(api.context());
  http.expectOne((req) => req.url.endsWith('/profile') && req.method === 'GET').flush({ data: profile });
  await expect(read).resolves.toEqual(profile);
  const saved = api.selectProfile(api.context(), { regime: 'ORDINARY_VAT' });
  const request = http.expectOne((req) => req.url.endsWith('/profile') && req.method === 'PUT');
  expect(request.request.body).toEqual({ regime: 'ORDINARY_VAT' });
  request.flush({
    data: {
      country: 'BJ',
      rule: profile.regimes[0],
      revision: 'ccf2d6e4-9124-4b75-a130-b5acac809195',
    },
  });
  await expect(saved).resolves.toMatchObject({ rule: { id: 'ORDINARY_VAT' } });
  await expect(
    api.selectProfile(api.context(), { regime: 'ORDINARY_VAT', taxRateBasisPoints: 0 }),
  ).rejects.toBeDefined();
  http.expectNone((req) => req.url.endsWith('/profile'));
});
it('rejects oversized token before HTTP', async () => {
  await expect(
    api.change(api.context(), 'STORE_CREDENTIAL', {
      environment: 'TEST',
      connectionId,
      expectedVersion: 1,
      commandId: crypto.randomUUID(),
      token: 'a'.repeat(4096) + '.b.c',
    }),
  ).rejects.toBeDefined();
  http.expectNone((req) => req.url.includes('/fiscality'));
});
it.each(['org', 'user', 'revision'])(
  'rejects stale %s before exposing a late response',
  async (dimension) => {
    const context = api.context(),
      promise = api.approval(context);
    const assertion = expect(promise).rejects.toBeDefined();
    const request = http.expectOne((req) => req.url.endsWith('/sfe-approval'));
    if (dimension === 'org') org.set('org-b');
    else if (dimension === 'user') user.set('second');
    else revision.set(2);
    request.flush({ data: { status: 'UNAVAILABLE', approval: null } });
    await assertion;
  },
);
it('query keys isolate principal, organization, revision and environment without secrets', () => {
  const first = fiscalityKey(api.context(), 'TEST');
  expect(fiscalityKey(api.context(), 'PRODUCTION')).not.toEqual(first);
  revision.set(2);
  expect(fiscalityKey(api.context(), 'TEST')).not.toEqual(first);
  expect(first).toEqual(['identity', 'fiscality', 'org-a', 'owner', 1, 'TEST']);
  expect(fiscalProfileKey(api.context())).toEqual([
    'identity',
    'fiscality',
    'org-a',
    'owner',
    2,
    'profile',
  ]);
});
it('verification sends only the typed command and rejects endpoint or tenant overrides before HTTP', async () => {
  const request = {
    connectionId,
    environment: 'TEST',
    expectedVersion: 2,
    commandId: crypto.randomUUID(),
  };
  await expect(
    api.verify(api.context(), { ...request, baseUrl: 'https://attacker.example' }),
  ).rejects.toBeDefined();
  await expect(api.verify(api.context(), { ...request, orgId: 'foreign' })).rejects.toBeDefined();
  http.expectNone((req) => req.url.endsWith('/verification'));
  const promise = api.verify(api.context(), request);
  const response = http.expectOne((req) => req.url.endsWith('/verification'));
  expect(response.request.body).toEqual({
    environment: 'TEST',
    expectedVersion: 2,
    commandId: request.commandId,
  });
  const assertion = expect(promise).rejects.toBeDefined();
  response.flush({ data: { token: 'must-not-escape' } });
  await assertion;
});
