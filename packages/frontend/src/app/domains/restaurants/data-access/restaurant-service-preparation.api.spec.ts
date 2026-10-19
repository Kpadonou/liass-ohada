import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantServicePreparationApi } from './restaurant-service-preparation.api';
import { serviceContext as ctx, serviceTask } from './service-preparation.test-fixture';
import { rid } from './restaurants.test-fixture';
const org = signal('org'),
  user = signal('waiter'),
  revision = signal(1);
let api: RestaurantServicePreparationApi, http: HttpTestingController;
beforeEach(() => {
  org.set('org');
  user.set('waiter');
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
  api = TestBed.inject(RestaurantServicePreparationApi);
  http = TestBed.inject(HttpTestingController);
});
afterEach(() => {
  http.verify();
  TestBed.resetTestingModule();
});
it('reads only the keyed Order endpoint with bounded explicit pagination', async () => {
  const pending = api.page(ctx, rid(20), 'next');
  const req = http.expectOne((r) => r.url.endsWith(`/orders/${rid(20)}/preparation`));
  expect(req.request.params.get('limit')).toBe('50');
  expect(req.request.params.get('cursor')).toBe('next');
  req.flush({ items: [serviceTask()], nextCursor: 'later' });
  expect((await pending).items[0].notes).toBe('Sans piment');
});
it.each(['org', 'user', 'revision'])(
  'rejects late %s responses including empty pages',
  async (mode) => {
    const pending = api.page(ctx, rid(20));
    const checked = expect(pending).rejects.toThrow();
    const req = http.expectOne((r) => r.url.endsWith('/preparation'));
    if (mode === 'org') org.set('other');
    else if (mode === 'user') user.set('other');
    else revision.set(2);
    req.flush({ items: [] });
    await checked;
  },
);
it.each(['org', 'outlet', 'order', 'mode'])('rejects mismatched %s ownership', async (mode) => {
  const pending = api.page(ctx, rid(20));
  const checked = expect(pending).rejects.toThrow();
  const req = http.expectOne((r) => r.url.endsWith('/preparation'));
  const task = serviceTask();
  if (mode === 'org') task.orgId = 'other';
  if (mode === 'outlet') task.outletId = rid(8);
  if (mode === 'order') task.orderId = rid(8);
  const value = mode === 'mode' ? { ...task, serviceContext: { mode: 'COUNTER' } } : task;
  req.flush({ items: [value] });
  await checked;
});
it('serves using task identity and validates the canonical response', async () => {
  const task = serviceTask();
  const pending = api.serve(ctx, rid(20), task, rid(99));
  const req = http.expectOne((r) =>
    r.url.endsWith(`/orders/${task.orderId}/items/${task.itemId}/preparation/${task.fireId}/serve`),
  );
  expect(req.request.body).toEqual({ clientRequestId: rid(99), expectedVersion: 3 });
  const { serviceContext, ...served } = serviceTask(22, 'SERVED');
  req.flush({ data: { ...served, version: 4 } });
  expect((await pending).data.state).toBe('SERVED');
});
it('does not dispatch non-READY tasks', async () => {
  await expect(api.serve(ctx, rid(20), serviceTask(22, 'QUEUED'), rid(99))).rejects.toThrow();
  http.expectNone((r) => r.method === 'POST');
});
