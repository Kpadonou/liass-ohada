import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantPreparationApi, KitchenContext } from './restaurant-preparation.api';
import { rid } from './restaurants.test-fixture';
const org = signal('org'),
  user = signal('cook'),
  revision = signal(1);
const ctx: KitchenContext = { org: 'org', user: 'cook', revision: 1, outlet: rid(2) };
let api: RestaurantPreparationApi, http: HttpTestingController;
const task = () => ({
  orgId: 'org',
  outletId: rid(2),
  schemaVersion: 1 as const,
  orderId: rid(20),
  itemId: rid(21),
  fireId: rid(22),
  submissionId: rid(23),
  stationId: rid(3),
  stationVersion: 1,
  generation: 1,
  name: 'Poulet',
  quantity: 2,
  state: 'QUEUED' as const,
  queuedAt: '2026-10-18T10:00:00.000Z',
  queuedBy: 'cook',
  version: 1,
  serviceContext: { mode: 'DINE_IN' as const, tableName: 'Terrasse jardin' },
});
beforeEach(() => {
  org.set('org');
  user.set('cook');
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
  api = TestBed.inject(RestaurantPreparationApi);
  http = TestBed.inject(HttpTestingController);
});
afterEach(() => {
  http.verify();
  TestBed.resetTestingModule();
});
it('parses the accepted read contract and uses bounded station/state pagination', async () => {
  const pending = api.queue(ctx, rid(3), 'QUEUED', 'next');
  const req = http.expectOne((r) => r.url.endsWith('/work/QUEUED'));
  expect(req.request.params.get('limit')).toBe('50');
  expect(req.request.params.get('cursor')).toBe('next');
  req.flush({ items: [task()], nextCursor: 'later' });
  expect((await pending).items[0].serviceContext).toEqual({
    mode: 'DINE_IN',
    tableName: 'Terrasse jardin',
  });
});
it.each(['organization', 'principal', 'revision'])(
  'rejects a late %s response even for an empty page',
  async (mode) => {
    const pending = api.queue(ctx, rid(3), 'QUEUED');
    const checked = expect(pending).rejects.toThrow();
    const req = http.expectOne((r) => r.url.endsWith('/work/QUEUED'));
    if (mode === 'organization') org.set('other');
    else if (mode === 'principal') user.set('other');
    else revision.set(2);
    req.flush({ items: [] });
    await checked;
  },
);
it.each(['tenant', 'outlet', 'station', 'state'])(
  'rejects foreign/mismatched %s task responses',
  async (mode) => {
    const pending = api.queue(ctx, rid(3), 'QUEUED');
    const checked = expect(pending).rejects.toThrow();
    const req = http.expectOne((r) => r.url.endsWith('/work/QUEUED'));
    const value = task();
    if (mode === 'tenant') value.orgId = 'other';
    if (mode === 'outlet') value.outletId = rid(12);
    if (mode === 'station') value.stationId = rid(4);
    if (mode === 'state')
      Object.assign(value, { state: 'IN_PROGRESS', startedAt: value.queuedAt, startedBy: 'cook' });
    req.flush({ items: [value] });
    await checked;
  },
);
it('START sends canonical version and stable idempotency identity without reading Orders/sessions', async () => {
  const value = task();
  const pending = api.command(ctx, value, 'start', rid(90));
  const req = http.expectOne((r) => r.url.endsWith('/start'));
  expect(req.request.body).toEqual({ clientRequestId: rid(90), expectedVersion: 1 });
  const { serviceContext, ...data } = value;
  req.flush({
    data: {
      ...data,
      state: 'IN_PROGRESS',
      version: 2,
      startedAt: value.queuedAt,
      startedBy: 'cook',
    },
  });
  expect((await pending).data.state).toBe('IN_PROGRESS');
});
it('refuses missing DINE_IN names rather than using an ID fallback', async () => {
  const pending = api.queue(ctx, rid(3), 'QUEUED');
  const checked = expect(pending).rejects.toThrow();
  http
    .expectOne((r) => r.url.endsWith('/work/QUEUED'))
    .flush({ items: [{ ...task(), serviceContext: { mode: 'DINE_IN' } }] });
  await checked;
});
