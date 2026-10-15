import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantsApi } from './restaurants.api';
import { rid } from './restaurants.test-fixture';
const org = signal('org'),
  user = signal('user');
let api: RestaurantsApi, http: HttpTestingController;
beforeEach(() => {
  org.set('org');
  user.set('user');
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthStore, useValue: { effectiveOrgId: org, currentUserId: user } },
    ],
  });
  api = TestBed.inject(RestaurantsApi);
  http = TestBed.inject(HttpTestingController);
});
afterEach(() => {
  http.verify();
  TestBed.resetTestingModule();
});
it('uses only the authenticated self route, bounded limit and opaque cursor', async () => {
  const p = api.myOutlets('org', 'user', 'opaque');
  const r = http.expectOne((r) => r.url.endsWith('/restaurants/me/outlets'));
  expect(r.request.method).toBe('GET');
  expect(r.request.params.get('limit')).toBe('50');
  expect(r.request.params.get('cursor')).toBe('opaque');
  expect(r.request.params.has('userId')).toBe(false);
  r.flush({ items: [{ outletId: rid(2), name: 'Agla' }], nextCursor: 'next' });
  expect(await p).toEqual({ items: [{ outletId: rid(2), name: 'Agla' }], nextCursor: 'next' });
});
it.each([
  { items: [{ outletId: 'bad', name: 'Agla' }] },
  { items: [{ outletId: rid(2), name: 'Agla', userId: 'secret' }] },
  {
    items: [
      { outletId: rid(2), name: 'Agla' },
      { outletId: rid(2), name: 'Agla' },
    ],
  },
  { items: [], nextCursor: 'same' },
])('rejects malformed, leaking, duplicate or cyclic context %s', async (response) => {
  const p = api.myOutlets('org', 'user', 'same');
  const reject = expect(p).rejects.toBeDefined();
  http.expectOne((r) => r.url.endsWith('/restaurants/me/outlets')).flush(response);
  await reject;
});
it.each(['org', 'user'])('rejects %s changes while self context is in flight', async (kind) => {
  const p = api.myOutlets('org', 'user');
  const reject = expect(p).rejects.toBeDefined();
  const r = http.expectOne((r) => r.url.endsWith('/restaurants/me/outlets'));
  if (kind === 'org') org.set('other');
  else user.set('other');
  r.flush({ items: [{ outletId: rid(2), name: 'Agla' }] });
  await reject;
});
it('does not request mismatched tenant or account context', async () => {
  await expect(api.myOutlets('other', 'user')).rejects.toBeDefined();
  await expect(api.myOutlets('org', 'other')).rejects.toBeDefined();
  http.expectNone((r) => r.url.endsWith('/restaurants/me/outlets'));
});
it('propagates network failure without fabricating empty assignments', async () => {
  const p = api.myOutlets('org', 'user');
  const reject = expect(p).rejects.toBeInstanceOf(HttpErrorResponse);
  http
    .expectOne((r) => r.url.endsWith('/restaurants/me/outlets'))
    .error(new ProgressEvent('error'));
  await reject;
});
