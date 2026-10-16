import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantsApi } from './restaurants.api';
import { rid } from './restaurants.test-fixture';
import { sessionFixture } from './responsible-staff.test-fixture';
const org = signal('org'),
  user = signal('owner'),
  revision = signal(1);
let api: RestaurantsApi, http: HttpTestingController;
beforeEach(() => {
  org.set('org');
  user.set('owner');
  revision.set(1);
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: AuthStore,
        useValue: { effectiveOrgId: org, currentUserId: user, contextRevision: revision },
      },
    ],
  });
  api = TestBed.inject(RestaurantsApi);
  http = TestBed.inject(HttpTestingController);
});
afterEach(() => {
  http.verify();
  TestBed.resetTestingModule();
});
it('reads the canonical session route and validates responsibility presentation', async () => {
  const promise = api.guestSession('org', rid(2), rid(9));
  const data = sessionFixture({
    responsibleStaff: { staffId: 'member', displayName: 'Aïssatou S.', available: false },
  });
  const request = http.expectOne((r) => r.url.endsWith(`/outlets/${rid(2)}/sessions/${rid(9)}`));
  expect(request.request.method).toBe('GET');
  request.flush({ data });
  expect(await promise).toEqual(data);
});
it.each(['member', null])(
  'sends the exact replace/clear command with staff %s',
  async (staffId) => {
    const input = { clientRequestId: rid(80), expectedVersion: 7, staffId };
    const promise = api.replaceResponsibleStaff('org', rid(2), rid(9), input);
    const request = http.expectOne((r) => r.url.endsWith(`/sessions/${rid(9)}/responsible-staff`));
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual(input);
    request.flush({
      data: sessionFixture({
        version: 8,
        ...(staffId
          ? { responsibleStaff: { staffId, displayName: 'Aïssatou S.', available: true } }
          : {}),
      }),
    });
    expect((await promise).data.version).toBe(8);
  },
);
it.each([
  { orgId: 'other' },
  { outletId: rid(77) },
  { guestSessionId: rid(88) },
  { responsibleStaff: { staffId: 'member', displayName: 42, available: true } },
])('rejects foreign or malformed response %j', async (changes) => {
  const promise = api.guestSession('org', rid(2), rid(9));
  const rejected = expect(promise).rejects.toBeInstanceOf(Error);
  http
    .expectOne((r) => r.url.includes(`/sessions/${rid(9)}`))
    .flush({ data: { ...sessionFixture(), ...changes } });
  await rejected;
});
it('rejects stale organization both before and after response and rejects forged request fields', async () => {
  org.set('other');
  await expect(api.guestSession('org', rid(2), rid(9))).rejects.toMatchObject({ status: 409 });
  http.expectNone((r) => r.url.includes('/sessions/'));
  org.set('org');
  const promise = api.guestSession('org', rid(2), rid(9));
  const rejected = expect(promise).rejects.toMatchObject({ status: 409 });
  org.set('other');
  http.expectOne((r) => r.url.includes('/sessions/')).flush({ data: sessionFixture() });
  await rejected;
  org.set('org');
  await expect(
    api.replaceResponsibleStaff('org', rid(2), rid(9), {
      clientRequestId: rid(80),
      expectedVersion: 7,
      staffId: 'member',
      orgId: 'foreign',
    }),
  ).rejects.toBeInstanceOf(Error);
});

it.each(['principal', 'revision'])(
  'rejects late keyed response after %s change',
  async (change) => {
    const promise = api.guestSession('org', rid(2), rid(9));
    const rejected = expect(promise).rejects.toMatchObject({ status: 409 });
    if (change === 'principal') user.set('Chrys');
    else revision.update((v) => v + 2);
    http.expectOne((r) => r.url.includes('/sessions/')).flush({ data: sessionFixture() });
    await rejected;
  },
);
