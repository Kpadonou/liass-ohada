import { TestBed } from '@angular/core/testing';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { HttpErrorResponse } from '@angular/common/http';
import fr from '../../../../../public/assets/i18n/fr.json';
import { RestaurantTableDeliveryComponent } from './restaurant-table-delivery.component';
import { RestaurantServicePreparationApi } from '../data-access/restaurant-service-preparation.api';
import { RestaurantOrdersApi } from '../data-access/restaurant-orders.api';
import { RestaurantsApi } from '../data-access/restaurants.api';
import {
  serviceContext as ctx,
  serviceTask,
} from '../data-access/service-preparation.test-fixture';
import { rid } from '../data-access/restaurants.test-fixture';
let client: QueryClient;
let fixture: ReturnType<typeof TestBed.createComponent<RestaurantTableDeliveryComponent>>;
const api = { page: vi.fn(), serve: vi.fn() };
const orders = { orders: vi.fn(), assertContext: vi.fn() };
let tasks: ReturnType<typeof serviceTask>[];
const row = (n: number) => ({ orderId: rid(n), status: 'SUBMITTED' });
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.componentInstance.complete()).toBe(true);
  });
  fixture.detectChanges();
};
beforeEach(async () => {
  vi.resetAllMocks();
  tasks = [serviceTask(), { ...serviceTask(23), orderId: rid(30) }];
  orders.orders.mockImplementation(async (_ctx, cursor) =>
    cursor ? { items: [row(30)] } : { items: [row(20)], nextCursor: 'orders-2' },
  );
  api.page.mockImplementation(async (_ctx, order) => ({
    items: tasks.filter((t) => t.orderId === order),
  }));
  api.serve.mockImplementation(async (_ctx, order, task) => {
    tasks = tasks.filter((t) => t.fireId !== task.fireId || t.orderId !== order);
    return { data: { ...task, state: 'SERVED' } };
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await TestBed.configureTestingModule({
    imports: [
      RestaurantTableDeliveryComponent,
      TranslocoTestingModule.forRoot({
        langs: { fr },
        translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
        preloadLangs: true,
      }),
    ],
    providers: [
      { provide: QueryClient, useValue: client },
      { provide: RestaurantServicePreparationApi, useValue: api },
      { provide: RestaurantOrdersApi, useValue: orders },
      { provide: RestaurantsApi, useValue: {} },
    ],
  }).compileComponents();
  fixture = TestBed.createComponent(RestaurantTableDeliveryComponent);
  fixture.componentRef.setInput('context', ctx);
  fixture.componentRef.setInput('enabled', true);
  fixture.componentRef.setInput('expectedOrderCount', 2);
  fixture.detectChanges();
  await settle();
});
afterEach(() => {
  fixture.destroy();
  client.clear();
  TestBed.resetTestingModule();
});
it('hydrates Orders across pages and serves a reviewed table batch serially, with one reconciliation phase', async () => {
  expect(fixture.componentInstance.ready()).toHaveLength(2);
  let active = 0,
    max = 0;
  api.serve.mockImplementation(async (_ctx, _order, task) => {
    active++;
    max = Math.max(max, active);
    await Promise.resolve();
    tasks = tasks.filter((t) => t.fireId !== task.fireId);
    active--;
  });
  const before = api.page.mock.calls.length;
  await fixture.componentInstance.serveAll();
  await settle();
  expect(max).toBe(1);
  expect(api.serve).toHaveBeenCalledTimes(2);
  expect(api.serve.mock.calls.map((c) => c[1])).toEqual([rid(20), rid(30)]);
  expect(api.serve.mock.calls[0][3]).not.toBe(api.serve.mock.calls[1][3]);
  expect(api.page.mock.calls.length - before).toBe(2);
  expect(fixture.componentInstance.ready()).toHaveLength(0);
  expect(fixture.nativeElement.textContent).toContain('2 servis, 0 restants');
});
it('serves one without a confirmation or navigation', async () => {
  await fixture.componentInstance.serve(fixture.componentInstance.ready()[0]);
  await settle();
  expect(api.serve).toHaveBeenCalledTimes(1);
  expect(fixture.componentInstance.ready()).toHaveLength(1);
});
it('hydrates every preparation page, including a later round, before enabling all', async () => {
  api.page.mockImplementation(async (_ctx, order, cursor) =>
    order === rid(30)
      ? { items: [] }
      : cursor
        ? { items: [serviceTask(24)] }
        : { items: [serviceTask()], nextCursor: 'prep-2' },
  );
  await fixture.componentInstance.refresh();
  await settle();
  expect(fixture.componentInstance.ready()).toHaveLength(2);
  expect(api.page.mock.calls.some((c) => c[2] === 'prep-2')).toBe(true);
});
it('preserves partial success and the exact ambiguous request for retry', async () => {
  api.serve
    .mockImplementationOnce(async (_ctx, _order, task) => {
      tasks = tasks.filter((t) => t.fireId !== task.fireId);
    })
    .mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
  await fixture.componentInstance.serveAll();
  await settle();
  expect(fixture.nativeElement.textContent).toContain('1 servis, 1 restants');
  const failed = api.serve.mock.calls[1];
  await fixture.componentInstance.retry();
  await settle();
  expect(api.serve.mock.calls[2][3]).toBe(failed[3]);
  expect(api.serve.mock.calls[2][2]).toEqual(failed[2]);
  expect(fixture.componentInstance.ready()).toHaveLength(0);
});
it('replays an ambiguous commit even when canonical reconciliation no longer lists it READY', async () => {
  tasks = tasks.slice(0, 1);
  await fixture.componentInstance.refresh();
  await settle();
  api.serve.mockImplementationOnce(async (_ctx, _order, task) => {
    tasks = tasks.filter((t) => t.fireId !== task.fireId);
    throw new HttpErrorResponse({ status: 0 });
  });
  await fixture.componentInstance.serve(fixture.componentInstance.ready()[0]);
  await settle();
  expect(fixture.componentInstance.unresolved()).toHaveLength(1);
  expect(fixture.nativeElement.querySelector('[data-testid=table-delivery]')).toBeNull();
  expect(fixture.nativeElement.textContent).toContain(fr.RESTAURANTS.SERVING.RETRY_BATCH);
  await fixture.componentInstance.retry();
  await settle();
  expect(api.serve.mock.calls[0][3]).toBe(api.serve.mock.calls[1][3]);
});
it('never enables all for incomplete session cardinality', async () => {
  fixture.componentRef.setInput('expectedOrderCount', 3);
  fixture.detectChanges();
  expect(fixture.componentInstance.complete()).toBe(false);
  await fixture.componentInstance.serveAll();
  expect(api.serve).not.toHaveBeenCalled();
});
it('never includes queued/in-progress work or no-station commercial lines in a batch', async () => {
  tasks.push(serviceTask(25, 'IN_PROGRESS'), serviceTask(26, 'QUEUED'));
  await fixture.componentInstance.refresh();
  await settle();
  await fixture.componentInstance.serveAll();
  expect(api.serve).toHaveBeenCalledTimes(2);
});
it('stops a frozen batch on tenant context change', async () => {
  api.serve.mockImplementationOnce(async () => {
    fixture.componentRef.setInput('enabled', false);
    fixture.detectChanges();
  });
  await fixture.componentInstance.serveAll();
  expect(api.serve).toHaveBeenCalledTimes(1);
});

it('reports three successes and two remaining without rolling back a five-task batch', async () => {
  tasks = [
    serviceTask(22),
    serviceTask(23),
    serviceTask(24),
    serviceTask(25),
    { ...serviceTask(26), orderId: rid(30) },
  ];
  await fixture.componentInstance.refresh();
  await settle();
  let count = 0;
  api.serve.mockImplementation(async (_ctx, _order, task) => {
    if (++count === 4) throw new HttpErrorResponse({ status: 0 });
    tasks = tasks.filter((t) => t.fireId !== task.fireId);
  });
  await fixture.componentInstance.serveAll();
  await settle();
  expect(api.serve).toHaveBeenCalledTimes(4);
  expect(fixture.nativeElement.textContent).toContain('3 servis, 2 restants');
  expect(fixture.componentInstance.ready()).toHaveLength(2);
  await fixture.componentInstance.retry();
  await settle();
  expect(fixture.componentInstance.ready()).toHaveLength(0);
});

it('hides the empty action panel while keeping canonical readers available for new ready items', async () => {
  tasks = [];
  await fixture.componentInstance.refresh();
  await settle();
  expect(fixture.nativeElement.querySelector('[data-testid="table-delivery"]')).toBeNull();
  expect(fixture.nativeElement.querySelectorAll('liass-order-delivery-reader')).toHaveLength(2);
  tasks = [serviceTask()];
  await fixture.componentInstance.refresh();
  await settle();
  expect(fixture.nativeElement.querySelector('[data-testid="table-delivery"]')).toBeTruthy();
  expect(fixture.nativeElement.textContent).toContain('À servir');
});
