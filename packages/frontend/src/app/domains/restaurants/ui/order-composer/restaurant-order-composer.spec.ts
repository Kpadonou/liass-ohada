import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import * as c from '@liass-ohada/shared/restaurants';
import fr from '../../../../../../public/assets/i18n/fr.json';
import { RestaurantOrderComposer } from './restaurant-order-composer';
import { RestaurantOrdersApi } from '../../data-access/restaurant-orders.api';
import { RestaurantsApi } from '../../data-access/restaurants.api';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { rid, row } from '../../data-access/restaurants.test-fixture';
import { sessionFixture } from '../../data-access/responsible-staff.test-fixture';
import { restaurantKeys } from '../../data-access/restaurants.queries';
let orders: c.RestaurantOrder[], lines: c.RestaurantOrderItem[], seq: number;
const org = signal('org'),
  user = signal('waiter'),
  revision = signal(0);
const item = () => c.MenuItemSchema.parse(row('item'));
const orderFixture = (id = rid(20), status: c.RestaurantOrder['status'] = 'DRAFT') =>
  c.RestaurantOrderSchema.parse({
    orgId: 'org',
    outletId: rid(2),
    schemaVersion: 1,
    orderId: id,
    guestSessionId: rid(9),
    tableId: rid(5),
    orderType: 'DINE_IN',
    status,
    currency: 'XOF',
    createdAt: '2026-10-16T12:00:00.000Z',
    createdBy: 'waiter',
    version: 1,
    financialRevision: 0,
    lineCount: 0,
    acceptedLineCount: 0,
    draftLineCount: 0,
    dueMinor: 0,
    paidMinor: 0,
    reservedMinor: 0,
    pendingPaymentCount: 0,
  });
const api = {
  assertContext: vi.fn(),
  orders: vi.fn(),
  order: vi.fn(),
  items: vi.fn(),
  command: vi.fn(),
};
const menu = { get: vi.fn(), list: vi.fn() };
let client: QueryClient,
  fixture: ReturnType<typeof TestBed.createComponent<RestaurantOrderComposer>>,
  page: RestaurantOrderComposer;
const tick = async () => {
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.ordersQuery.isSuccess()).toBe(true);
  });
};
const settle = async () => {
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.ready()).toBeTruthy();
    expect(page.orders()).toHaveLength(orders.length);
    if (page.selectedId()) {
      expect(page.order()?.version).toBe(
        orders.find((o) => o.orderId === page.selectedId())?.version,
      );
      expect(page.lines()).toHaveLength(
        lines.filter((l) => l.orderId === page.selectedId()).length,
      );
    }
  });
};
beforeEach(async () => {
  vi.clearAllMocks();
  orders = [];
  lines = [];
  seq = 30;
  org.set('org');
  user.set('waiter');
  revision.set(0);
  sessionStorage.clear();
  api.orders.mockImplementation(async () => ({ items: [...orders] }));
  api.order.mockImplementation(async (_ctx, id) => ({ ...orders.find((o) => o.orderId === id)! }));
  api.items.mockImplementation(async (_ctx, id) => ({
    items: lines.filter((line) => line.orderId === id).map((line) => ({ ...line })),
  }));
  menu.get.mockImplementation(async (_org, kind) => row(kind));
  menu.list.mockImplementation(async (_org, kind) => ({ items: [row(kind)] }));
  api.command.mockImplementation(async (_ctx, kind, input, orderId, itemId) => {
    if (kind === 'create') {
      const created = orderFixture(rid(++seq));
      orders.push(created);
      return { ...created };
    }
    const order = orders.find((o) => o.orderId === orderId)!;
    if (kind === 'add') {
      const line = c.RestaurantOrderItemSchema.parse({
        orgId: 'org',
        outletId: rid(2),
        schemaVersion: 1,
        orderId,
        itemId: rid(++seq),
        menuItemId: input.menuItemId,
        categoryId: input.categoryId,
        expectedMenuItemVersion: input.expectedMenuItemVersion,
        quantity: input.quantity,
        status: 'DRAFT',
        version: 1,
        createdAt: '2026-10-16T12:01:00.000Z',
      });
      lines.push(line);
      order.version++;
      order.lineCount++;
      order.draftLineCount++;
      return { ...line };
    }
    if (kind === 'edit' || kind === 'remove') {
      const line = lines.find((line) => line.itemId === itemId)!;
      line.version++;
      order.version++;
      if (kind === 'edit') line.quantity = input.quantity;
      else {
        line.status = 'CANCELLED';
        order.draftLineCount--;
      }
      return { ...line };
    }
    if (kind === 'submit') {
      const submissionId = rid(++seq);
      for (const selected of input.items) {
        const line = lines.find((line) => line.itemId === selected.itemId)!;
        line.status = 'ACCEPTED';
        line.version++;
        line.snapshot = c.AcceptedSaleSnapshotSchema.parse({
          menuItemId: line.menuItemId,
          categoryId: line.categoryId,
          menuId: rid(7),
          itemVersion: 1,
          categoryVersion: 1,
          menuVersion: 1,
          name: 'Nom figé',
          quantity: line.quantity,
          unitPriceMinor: 1000,
          grossMinor: line.quantity * 1000,
          subtotalMinor: line.quantity * 1000,
          discountMinor: 0,
          taxMinor: 0,
          lineTotalMinor: line.quantity * 1000,
          currency: 'XOF',
          acceptedAt: `2026-10-16T12:${seq}:00.000Z`,
          acceptedBy: 'waiter',
          submissionId,
        });
      }
      order.status = 'SUBMITTED';
      order.version++;
      order.draftLineCount = 0;
      return { ...order };
    }
    throw Error('Unexpected command');
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await TestBed.configureTestingModule({
    imports: [
      RestaurantOrderComposer,
      TranslocoTestingModule.forRoot({
        langs: { fr },
        translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
        preloadLangs: true,
      }),
    ],
    providers: [
      { provide: QueryClient, useValue: client },
      {
        provide: AuthStore,
        useValue: { effectiveOrgId: org, currentUserId: user, contextRevision: revision },
      },
      { provide: RestaurantsApi, useValue: menu },
      { provide: RestaurantOrdersApi, useValue: api },
      { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
    ],
  }).compileComponents();
  fixture = TestBed.createComponent(RestaurantOrderComposer);
  page = fixture.componentInstance;
  fixture.componentRef.setInput('outletId', rid(2));
  fixture.componentRef.setInput('sessionId', rid(9));
  fixture.componentRef.setInput('session', sessionFixture());
  fixture.detectChanges();
  await tick();
});
afterEach(() => {
  fixture.destroy();
  client.clear();
  TestBed.resetTestingModule();
});
it('does not create on load; lazily creates once then reuses the same Order across rounds', async () => {
  expect(api.command).not.toHaveBeenCalled();
  await settle();
  await page.add(item());
  await settle();
  expect(orders).toHaveLength(1);
  expect(lines).toHaveLength(1);
  await page.quantity(lines[0], 1);
  await settle();
  expect(lines[0].quantity).toBe(2);
  await page.submit();
  await settle();
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelectorAll('[data-testid="accepted-round"]')).toHaveLength(1);
  expect(fixture.nativeElement.textContent).toContain('Nom figé');
  const snapshot = { ...lines[0].snapshot };
  await page.add(item());
  await settle();
  await page.submit();
  await settle();
  fixture.detectChanges();
  expect(orders).toHaveLength(1);
  expect(fixture.nativeElement.querySelectorAll('[data-testid="accepted-round"]')).toHaveLength(2);
  expect(lines[0].snapshot).toEqual(snapshot);
  expect(
    fixture.nativeElement.querySelectorAll('[data-testid="accepted-round"] button'),
  ).toHaveLength(0);
});
it('increments equivalent drafts, removes drafts only and enforces 12 distinct lines', async () => {
  await settle();
  await page.add(item());
  await settle();
  await page.add(item());
  await settle();
  expect(lines).toHaveLength(1);
  expect(lines[0].quantity).toBe(2);
  await page.remove(lines[0]);
  await settle();
  expect(page.drafts()).toHaveLength(0);
  for (let i = 0; i < 12; i++) {
    await page.add({ ...item(), id: rid(100 + i) });
    await settle();
  }
  expect(page.drafts()).toHaveLength(12);
  expect(page.canAdd()).toBe(false);
  expect(page.canSubmit()).toBe(true);
  await page.add({ ...item(), id: rid(200) });
  expect(page.drafts()).toHaveLength(12);
  expect(page.canAddItem({ ...item(), id: rid(100) })).toBe(true);
});
it('recovers create success + add failure without another Order', async () => {
  const command = api.command.getMockImplementation()!;
  api.command.mockImplementation(async (...args) => {
    if (args[1] === 'add') throw new HttpErrorResponse({ status: 409 });
    return command(...args);
  });
  await settle();
  await page.add(item());
  fixture.detectChanges();
  expect(orders).toHaveLength(1);
  expect(page.message()).toBe('PARTIAL_CREATE');
  api.command.mockImplementation(command);
  await settle();
  await page.add(item());
  await settle();
  expect(orders).toHaveLength(1);
  expect(lines).toHaveLength(1);
});
it('holds an ambiguous create identity and reconciles before replay', async () => {
  api.command.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
  await settle();
  await page.add(item());
  const intent = page.pending()!;
  expect(intent.kind).toBe('create');
  expect(page.canAdd()).toBe(false);
  await page.retry();
  fixture.detectChanges();
  expect(api.command.mock.calls[1][2].clientRequestId).toBe(intent.input['clientRequestId']);
});
it('requires explicit selection for multiple current Orders and excludes terminal Orders', async () => {
  orders.push(orderFixture(), orderFixture(rid(21)), orderFixture(rid(22), 'CLOSED'));
  await page.ordersQuery.refetch();
  await settle();
  expect(page.selectedId()).toBe('');
  expect(page.canAdd()).toBe(false);
  page.choose(rid(21));
  await settle();
  expect(page.order()?.orderId).toBe(rid(21));
  page.choose(rid(22));
  await settle();
  expect(page.canAdd()).toBe(false);
  expect(page.canSubmit()).toBe(false);
});
it('searches loaded names with accents, hides unavailable Add and retains explicit pagination', async () => {
  menu.list.mockImplementation(async (_org, kind) => ({
    items:
      kind === 'item' ? [{ ...item(), name: 'Café', availability: 'UNAVAILABLE' }] : [row(kind)],
    nextCursor: kind === 'item' ? 'page2' : undefined,
  }));
  await page.menuItemsQuery.refetch();
  page.search.setValue('cafe');
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.menuItems()).toHaveLength(1);
  });
  const before = api.command.mock.calls.length;
  await page.add(page.menuItems()[0]);
  expect(api.command).toHaveBeenCalledTimes(before);
  expect(page.menuItemsQuery.hasNextPage()).toBe(true);
  expect(menu.list.mock.calls.filter((call) => call[3] === 'page2')).toHaveLength(0);
});
it.each(['organization', 'principal', 'revision', 'session'])(
  'drops stale mutation completions on %s change',
  async (dimension) => {
    orders.push(orderFixture());
    await page.ordersQuery.refetch();
    await settle();
    let resolve!: (value: c.RestaurantOrderItem) => void;
    api.command.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
    const pending = page.add(item());
    await vi.waitFor(() => expect(page.busy()).toBe(true));
    if (dimension === 'organization') org.set('foreign');
    if (dimension === 'principal') user.set('other');
    if (dimension === 'revision') revision.update((value) => value + 1);
    if (dimension === 'session') fixture.componentRef.setInput('sessionId', rid(99));
    fixture.detectChanges();
    resolve({} as c.RestaurantOrderItem);
    await pending;
    fixture.detectChanges();
    expect(page.pending()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Nom figé');
  },
);
it('removes the complete composer for CLOSED sessions', () => {
  fixture.componentRef.setInput('session', sessionFixture({ status: 'CLOSED' }));
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('[data-testid="order-taking"]')).toBeNull();
});
it('invalidates captured session and exact outlet floor on submission', async () => {
  await settle();
  await page.add(item());
  await settle();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await page.submit();
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: restaurantKeys.floor('org', rid(2)),
    exact: true,
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: restaurantKeys.session('org', rid(2), rid(9), 'waiter'),
    exact: true,
  });
});
it('lazily creates when only terminal Orders exist and keeps terminal content read-only', async () => {
  orders.push(orderFixture(rid(20), 'CLOSED'));
  await page.ordersQuery.refetch();
  await settle();
  expect(page.order()?.status).toBe('CLOSED');
  expect(page.canAdd()).toBe(true);
  await page.add(item());
  await settle();
  expect(orders).toHaveLength(2);
  expect(page.order()?.status).toBe('DRAFT');
});
it('surfaces a version conflict and refreshes without rewriting the command against new versions', async () => {
  await settle();
  await page.add(item());
  await settle();
  api.command.mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }));
  const before = api.command.mock.calls.length;
  await page.quantity(lines[0], 1);
  fixture.detectChanges();
  expect(page.message()).toBe('CONFLICT');
  expect(page.pending()).toBeNull();
  expect(api.command).toHaveBeenCalledTimes(before + 1);
});
it('blocks repeated submit clicks and preserves the original request identity after an ambiguous result', async () => {
  await settle();
  await page.add(item());
  await settle();
  let reject!: (reason: unknown) => void;
  api.command.mockImplementationOnce(() => new Promise((_resolve, fail) => (reject = fail)));
  const before = api.command.mock.calls.length;
  const first = page.submit();
  await page.submit();
  expect(api.command).toHaveBeenCalledTimes(before + 1);
  reject(new HttpErrorResponse({ status: 0 }));
  await first;
  fixture.detectChanges();
  const intent = page.pending()!;
  expect(intent.kind).toBe('submit');
  await page.retry();
  await settle();
  expect(api.command.mock.calls.at(-1)![2]).toEqual(intent.input);
});
it('persists only unresolved command intent and clears it on principal switch', async () => {
  await settle();
  api.command.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
  await page.add(item());
  const keys = Object.keys(sessionStorage).filter((k) => k.startsWith('liass-order-intent:'));
  expect(keys).toHaveLength(1);
  expect(JSON.parse(sessionStorage.getItem(keys[0])!).kind).toBe('create');
  user.set('different');
  fixture.detectChanges();
  expect(sessionStorage.getItem(keys[0])).toBeNull();
  expect(page.pending()).toBeNull();
});
it('does not auto-load additional Order or item pages and blocks incomplete draft decisions', async () => {
  api.orders.mockResolvedValueOnce({ items: [], nextCursor: 'orders-next' });
  await page.ordersQuery.refetch();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.ordersQuery.hasNextPage()).toBe(true);
  });
  expect(page.canAdd()).toBe(false);
  expect(api.orders.mock.calls.some((call) => call[1] === 'orders-next')).toBe(false);
});
it('restores keyboard focus to the surviving draft control after a quantity mutation', async () => {
  await settle();
  await page.add(item());
  await settle();
  fixture.detectChanges();
  const increase = fixture.nativeElement.querySelector(
    'button[aria-label^="Augmenter"]',
  ) as HTMLButtonElement;
  increase.focus();
  expect(document.activeElement).toBe(increase);
  await page.quantity(lines[0], 1);
  await settle();
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(document.activeElement?.getAttribute('aria-label')).toContain('Augmenter');
  });
});
it('keeps noted drafts distinct and preserves supported notes during quantity edits', async () => {
  await settle();
  await page.add(item());
  await settle();
  lines[0].notes = 'Sans sucre';
  lines[0].version++;
  orders[0].version++;
  await Promise.all([page.orderQuery.refetch(), page.itemsQuery.refetch()]);
  await settle();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.drafts()[0].notes).toBe('Sans sucre');
  });
  await page.add(item());
  await settle();
  expect(page.drafts()).toHaveLength(2);
  await page.quantity(page.drafts().find((line) => line.notes)!, 1);
  await settle();
  expect(api.command.mock.calls.at(-1)![2]).toMatchObject({ notes: 'Sans sucre', quantity: 2 });
});
it('recovers an unresolved create identity after component reload without issuing a new command', async () => {
  await settle();
  api.command.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
  await page.add(item());
  const original = page.pending()!.input['clientRequestId'];
  const before = api.command.mock.calls.length;
  fixture.destroy();
  fixture = TestBed.createComponent(RestaurantOrderComposer);
  page = fixture.componentInstance;
  fixture.componentRef.setInput('outletId', rid(2));
  fixture.componentRef.setInput('sessionId', rid(9));
  fixture.componentRef.setInput('session', sessionFixture());
  fixture.detectChanges();
  await tick();
  expect(page.pending()!.input['clientRequestId']).toBe(original);
  expect(page.canAdd()).toBe(false);
  expect(api.command).toHaveBeenCalledTimes(before);
});
it('never exposes the former Order items when a late selected-Order read resolves', async () => {
  orders.push(orderFixture(), orderFixture(rid(21)));
  await page.ordersQuery.refetch();
  await settle();
  let finish!: (value: { items: c.RestaurantOrderItem[] }) => void;
  api.items.mockImplementationOnce(() => new Promise((done) => (finish = done)));
  page.choose(rid(20));
  fixture.detectChanges();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  page.choose(rid(21));
  await settle();
  finish({
    items: [
      {
        orgId: 'org',
        outletId: rid(2),
        schemaVersion: 1,
        orderId: rid(20),
        itemId: rid(55),
        menuItemId: rid(8),
        categoryId: rid(6),
        quantity: 99,
        expectedMenuItemVersion: 1,
        status: 'DRAFT',
        version: 1,
        createdAt: '2026-10-16T12:00:00.000Z',
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  expect(page.selectedId()).toBe(rid(21));
  expect(page.drafts()).toHaveLength(0);
});
it('hides the former outlet and clears unresolved intents on outlet change', async () => {
  await settle();
  api.command.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
  await page.add(item());
  fixture.componentRef.setInput('outletId', rid(99));
  fixture.detectChanges();
  expect(page.pending()).toBeNull();
  expect(page.live()).toBe(false);
  expect(fixture.nativeElement.querySelector('[data-testid="order-taking"]')).toBeNull();
});
it('requires explicit item-page loading before any draft mutation', async () => {
  orders.push(orderFixture());
  api.items.mockResolvedValueOnce({ items: [], nextCursor: 'more-lines' });
  await page.ordersQuery.refetch();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.itemsQuery.hasNextPage()).toBe(true);
  });
  expect(page.canAdd()).toBe(false);
  expect(page.canSubmit()).toBe(false);
  expect(api.items.mock.calls.some((call) => call[2] === 'more-lines')).toBe(false);
});
it('refetches configuration on reviewed-menu conflict and does not silently reprice the draft', async () => {
  await settle();
  await page.add(item());
  await settle();
  api.command.mockRejectedValueOnce(
    new HttpErrorResponse({
      status: 409,
      error: { error: { code: 'RESTAURANTS_CONFIGURATION_CHANGED' } },
    }),
  );
  const before = menu.get.mock.calls.length;
  await page.submit();
  fixture.detectChanges();
  expect(page.message()).toBe('MENU_CONFLICT');
  expect(menu.get.mock.calls.length).toBeGreaterThan(before);
  expect(lines[0].status).toBe('DRAFT');
  expect(lines[0].expectedMenuItemVersion).toBe(1);
});
it('keeps local section navigation out of browser history and focuses the destination heading', async () => {
  await settle();
  const heading = fixture.nativeElement.querySelector('#draft-title') as HTMLElement;
  heading.scrollIntoView = vi.fn();
  const hash = location.hash;
  page.jump('draft-title');
  expect(heading.scrollIntoView).toHaveBeenCalled();
  expect(location.hash).toBe(hash);
  expect(document.activeElement).toBe(heading);
});
it('cannot replay an old intent after a context switch during retry reconciliation', async () => {
  await settle();
  api.command.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
  await page.add(item());
  let finish!: () => void;
  vi.spyOn(page.queries, 'changed').mockImplementationOnce(
    () => new Promise<void>((done) => (finish = done)),
  );
  const before = api.command.mock.calls.length;
  const retry = page.retry();
  user.set('new-principal');
  fixture.detectChanges();
  finish();
  await retry;
  expect(api.command).toHaveBeenCalledTimes(before);
  expect(page.pending()).toBeNull();
  expect(page.busy()).toBe(false);
});
