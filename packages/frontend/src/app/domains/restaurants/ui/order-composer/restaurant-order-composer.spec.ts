import { RestaurantServicePreparationApi } from '../../data-access/restaurant-service-preparation.api';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import * as c from '@liass-ohada/shared/restaurants';
import fr from '../../../../../../public/assets/i18n/fr.json';
import en from '../../../../../../public/assets/i18n/en.json';
import { RestaurantOrderComposer } from './restaurant-order-composer';
import { RestaurantOrdersApi } from '../../data-access/restaurant-orders.api';
import { RestaurantsApi } from '../../data-access/restaurants.api';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { rid, row } from '../../data-access/restaurants.test-fixture';
import { sessionFixture } from '../../data-access/responsible-staff.test-fixture';
import { restaurantKeys } from '../../data-access/restaurants.queries';

function holdNextCommand() {
  const command = api.command.getMockImplementation()!;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  api.command.mockImplementationOnce(async (...args) => {
    await gate;
    return command(...args);
  });
  return () => release();
}
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
const serving = { page: vi.fn(), serve: vi.fn() };
const menu = { get: vi.fn(), list: vi.fn(), cartePage: vi.fn() };
const operational = (value = item()) => ({
  id: value.id,
  name: value.name,
  outletId: value.outletId,
  menuId: value.menuId,
  categoryId: value.categoryId,
  categoryName: 'Boissons',
  price: value.price,
  version: value.version,
  availability: value.availability,
});
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
  serving.page.mockResolvedValue({ items: [] });
  orders = [];
  lines = [];
  seq = 30;
  org.set('org');
  user.set('waiter');
  revision.set(0);
  sessionStorage.clear();
  api.orders.mockImplementation(async () => ({ items: structuredClone(orders) }));
  api.order.mockImplementation(async (_ctx, id) => ({ ...orders.find((o) => o.orderId === id)! }));
  api.items.mockImplementation(async (_ctx, id) => ({
    items: lines.filter((line) => line.orderId === id).map((line) => ({ ...line })),
  }));
  menu.cartePage.mockImplementation(async () => ({
    outletId: rid(2),
    menuId: rid(7),
    items: [operational()],
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
      {
        provide: RestaurantServicePreparationApi,
        useValue: serving,
      },
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
it('projects four rapid increments immediately, ignores intermediate/refetched values and coalesces to two writes', async () => {
  await draftInput();
  const original = page.drafts()[0];
  const release = holdNextCommand();
  const before = api.command.mock.calls.length;
  const actions = [];
  for (let i = 2; i <= 5; i++) {
    actions.push(page.quantity(original, 1));
    fixture.detectChanges();
    expect(page.drafts()[0].quantity).toBe(i);
    expect(page.quantityInput(page.drafts()[0]).value).toBe(String(i));
    expect(page.canSubmit()).toBe(true);
    expect(page.canAddItem(item())).toBe(true);
  }
  await page.itemsQuery.refetch();
  fixture.detectChanges();
  expect(page.drafts()[0].quantity).toBe(5);
  expect(api.command).toHaveBeenCalledTimes(before + 1);
  release();
  await Promise.all(actions);
  await settle();
  expect(lines[0].quantity).toBe(5);
  expect(api.command.mock.calls.slice(before).map((call) => call[2].quantity)).toEqual([2, 5]);
  expect(api.command.mock.calls.slice(before).map((call) => call[2].expectedVersion)).toEqual([
    2, 3,
  ]);
});
it('keeps the exact local row and control through Add then quantity before the Add response', async () => {
  await settle();
  orders.push(orderFixture());
  await page.ordersQuery.refetch();
  await settle();
  const release = holdNextCommand();
  const add = page.add(item());
  fixture.detectChanges();
  expect(page.drafts()).toHaveLength(1);
  const local = page.drafts()[0];
  const node = fixture.nativeElement.querySelector('[data-testid="draft-line"]');
  const plus = [page.quantity(local, 1), page.quantity(local, 1)];
  expect(page.drafts()[0].quantity).toBe(3);
  release();
  await Promise.all([add, ...plus]);
  await settle();
  fixture.detectChanges();
  expect(page.drafts()).toHaveLength(1);
  expect(lines[0].quantity).toBe(3);
  expect(fixture.nativeElement.querySelector('[data-testid="draft-line"]')).toBe(node);
});
it('does not resurrect an Add removed before its response and performs one compensating removal', async () => {
  await draftInput();
  const release = holdNextCommand();
  const before = api.command.mock.calls.length;
  const add = page.add({ ...item(), id: rid(100) });
  const local = page.drafts().find((line) => line.menuItemId === rid(100))!;
  const remove = page.remove(local);
  expect(page.drafts().some((line) => line.menuItemId === rid(100))).toBe(false);
  release();
  await Promise.all([add, remove]);
  await settle();
  expect(lines.find((line) => line.menuItemId === rid(100))?.status).toBe('CANCELLED');
  expect(api.command.mock.calls.slice(before).map((call) => call[1])).toEqual(['add', 'remove']);
});
it('drops an unsent Add/Remove locally while another row writes', async () => {
  await draftInput();
  const release = holdNextCommand();
  const before = api.command.mock.calls.length;
  const edit = page.quantity(page.drafts()[0], 1);
  const add = page.add({ ...item(), id: rid(100) });
  const remove = page.remove(page.drafts().find((line) => line.menuItemId === rid(100))!);
  release();
  await Promise.all([edit, add, remove]);
  expect(api.command.mock.calls.slice(before).map((call) => call[1])).toEqual(['edit']);
});
it('coalesces +/- reversal and direct entry, then Submit drains the frozen latest target', async () => {
  await draftInput();
  const release = holdNextCommand();
  const line = page.drafts()[0];
  const before = api.command.mock.calls.length;
  const actions = [page.quantity(line, 1), page.quantity(line, 1), page.quantity(line, -1)];
  expect(page.drafts()[0].quantity).toBe(2);
  page.beginQuantity(page.drafts()[0]);
  page.quantityInput(page.drafts()[0]).setValue('8');
  actions.push(page.commitQuantity(page.drafts()[0]));
  expect(page.drafts()[0].quantity).toBe(8);
  const submit = page.submit();
  expect(page.submitting()).toBe(true);
  await page.quantity(page.drafts()[0], 1);
  expect(page.drafts()[0].quantity).toBe(8);
  expect(api.command.mock.calls.slice(before).map((call) => call[1])).toEqual(['edit']);
  expect(page.rounds()).toHaveLength(0);
  release();
  await Promise.all([...actions, submit]);
  await settle();
  expect(api.command.mock.calls.slice(before).map((call) => call[1])).toEqual([
    'edit',
    'edit',
    'submit',
  ]);
  expect(lines[0].snapshot?.quantity).toBe(8);
});
it('keeps local intent after ambiguous sync and replays exact payload before applying newer intent', async () => {
  await draftInput();
  const command = api.command.getMockImplementation()!;
  let committed: c.RestaurantOrderItem | undefined;
  let request: unknown;
  api.command.mockImplementationOnce(async (...args) => {
    request = args[2];
    committed = await command(...args);
    throw new HttpErrorResponse({ status: 0 });
  });
  await page.quantity(page.drafts()[0], 1);
  expect(page.syncFailed()).toBe(true);
  expect(page.drafts()[0].quantity).toBe(2);
  await page.quantity(page.drafts()[0], 1);
  expect(page.drafts()[0].quantity).toBe(3);
  api.command.mockImplementationOnce(async (...args) => {
    expect(args[2]).toEqual(request);
    return committed!;
  });
  await page.retry();
  await settle();
  expect(page.syncFailed()).toBe(false);
  expect(lines[0].quantity).toBe(3);
});
it('hides and clears the optimistic overlay on access revocation before a delayed response', async () => {
  await draftInput();
  const release = holdNextCommand();
  const action = page.quantity(page.drafts()[0], 1);
  fixture.componentRef.setInput('accessValid', false);
  fixture.detectChanges();
  expect(page.draftIntents()).toHaveLength(0);
  expect(fixture.nativeElement.querySelector('[data-testid="order-taking"]')).toBeNull();
  release();
  await action;
  expect(page.draftIntents()).toHaveLength(0);
});
it('does not submit a concurrently introduced draft outside the frozen submission intent', async () => {
  await draftInput();
  const release = holdNextCommand();
  const edit = page.quantity(page.drafts()[0], 1);
  const submit = page.submit();
  lines.push({ ...lines[0], itemId: rid(101), menuItemId: rid(102) });
  release();
  await Promise.all([edit, submit]);
  expect(api.command.mock.calls.some((call) => call[1] === 'submit')).toBe(false);
  expect(page.message()).toBe('CONFLICT');
  expect(page.rounds()).toHaveLength(0);
});
it('keeps sync failures local and lets the user explicitly restore canonical draft after a rejection', async () => {
  await draftInput();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  api.command.mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }));
  await page.quantity(page.drafts()[0], 1);
  fixture.detectChanges();
  expect(page.drafts()[0].quantity).toBe(2);
  expect(page.syncFailed()).toBe(true);
  expect(invalidate).not.toHaveBeenCalledWith({
    queryKey: restaurantKeys.session('org', rid(2), rid(9), 'waiter'),
    exact: true,
  });
  expect(invalidate).not.toHaveBeenCalledWith({
    queryKey: restaurantKeys.floor('org', rid(2)),
    exact: true,
  });
  page.restoreDraft();
  expect(page.drafts()[0].quantity).toBe(1);
  expect(page.syncFailed()).toBe(false);
  expect(page.message()).toBe('CONFLICT');
});
it('keeps optimistic row position when canonical items return in a different key order', async () => {
  await draftInput();
  const release = holdNextCommand();
  const add = page.add({ ...item(), id: rid(100) });
  fixture.detectChanges();
  const positions = page.drafts().map((line) => line.menuItemId);
  const nodes = [...fixture.nativeElement.querySelectorAll('[data-testid="draft-line"]')];
  api.items.mockImplementation(async (_ctx, id) => ({
    items: lines
      .filter((line) => line.orderId === id)
      .map((line) => ({ ...line }))
      .reverse(),
  }));
  release();
  await add;
  await settle();
  fixture.detectChanges();
  expect(page.drafts().map((line) => line.menuItemId)).toEqual(positions);
  expect([...fixture.nativeElement.querySelectorAll('[data-testid="draft-line"]')]).toEqual(nodes);
});
it('retains cached siblings and local targets when post-command reconciliation fails', async () => {
  await draftInput();
  const prior = page.drafts()[0];
  await page.add({ ...item(), id: rid(100) });
  await settle();
  api.items.mockRejectedValue(new HttpErrorResponse({ status: 503 }));
  const node = fixture.nativeElement.querySelector('#draft-title');
  await page.quantity(prior, 1);
  fixture.detectChanges();
  expect(page.syncFailed()).toBe(true);
  expect(page.drafts()).toHaveLength(2);
  expect(page.drafts().find((row) => row.menuItemId === prior.menuItemId)?.quantity).toBe(2);
  expect(fixture.nativeElement.querySelector('#draft-title')).toBe(node);
  expect(fixture.nativeElement.querySelectorAll('[data-testid="draft-line"]')).toHaveLength(2);
  expect(page.canSubmit()).toBe(true);
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
  expect(page.message()).toBe('CONFLICT');
  expect(page.drafts()).toHaveLength(1);
  api.command.mockImplementation(command);
  await settle();
  await page.retry();
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
  expect(page.canAdd()).toBe(true);
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
it('searches unified loaded names with accents and preserves unavailable semantics', async () => {
  menu.cartePage.mockResolvedValue({
    outletId: rid(2),
    menuId: rid(7),
    items: [operational({ ...item(), name: 'Café', availability: 'UNAVAILABLE' })],
  });
  await page.menuItemsQuery.refetch();
  page.search.setValue('cafe');
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.menuItems()).toHaveLength(1);
  });
  const before = api.command.mock.calls.length;
  await page.add(page.menuItems()[0]);
  expect(api.command).toHaveBeenCalledTimes(before);
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
  await vi.waitFor(() => expect(api.command).toHaveBeenCalledTimes(before + 1));
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
it('hydrates additional Order pages for complete table-wide delivery', async () => {
  api.orders.mockResolvedValueOnce({ items: [], nextCursor: 'orders-next' });
  await page.ordersQuery.refetch();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(api.orders.mock.calls.some((call) => call[1] === 'orders-next')).toBe(true);
  });
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

async function draftInput() {
  await settle();
  await page.add(item());
  await settle();
  fixture.detectChanges();
  const input = fixture.nativeElement.querySelector(
    '[data-testid="draft-line"] input',
  ) as HTMLInputElement;
  input.focus();
  return input;
}
it('browses categories together without category navigation or category reads', async () => {
  menu.cartePage.mockResolvedValue({
    outletId: rid(2),
    menuId: rid(7),
    items: [
      operational(),
      {
        ...operational(),
        id: rid(88),
        categoryId: rid(16),
        categoryName: 'Plats',
        name: 'Poulet braisé',
      },
    ],
  });
  await page.menuItemsQuery.refetch();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.menuItems()).toHaveLength(2);
  });
  expect(fixture.nativeElement.querySelector('[data-testid="category-navigation"]')).toBeNull();
  expect(fixture.nativeElement.textContent).toContain('Plats');
  expect(menu.list).not.toHaveBeenCalled();
});
it('formats operational prices without redundant currency and retains an ambiguous currency suffix', async () => {
  await settle();
  expect(page.price(150000, 'XOF')).toMatch(/^150\s000$/);
  expect(page.price(1025, 'EUR')).toBe('10,25 EUR');
});
it('enables desktop stickiness only when the whole order region fits the viewport', async () => {
  await settle();
  const region = fixture.nativeElement.querySelector('[data-order-region]') as HTMLElement;
  Object.defineProperty(region, 'scrollHeight', { configurable: true, value: 2000 });
  window.dispatchEvent(new Event('resize'));
  fixture.detectChanges();
  expect(page.orderPanelFits()).toBe(false);
  expect(region.classList.contains('xl:sticky')).toBe(false);
  Object.defineProperty(region, 'scrollHeight', { configurable: true, value: 200 });
  window.dispatchEvent(new Event('resize'));
  fixture.detectChanges();
  expect(page.orderPanelFits()).toBe(true);
  expect(region.classList.contains('xl:sticky')).toBe(true);
});
function typeQuantity(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
it('edits multiple digits locally and commits one captured edit on Enter followed by blur', async () => {
  const input = await draftInput();
  expect(input.value).toBe('1');
  expect(input.inputMode).toBe('numeric');
  expect(input.getAttribute('pattern')).toBe('[0-9]*');
  expect(input.getAttribute('aria-label')).toContain('Beer');
  const before = api.command.mock.calls.length;
  typeQuantity(input, '1');
  typeQuantity(input, '12');
  expect(api.command).toHaveBeenCalledTimes(before);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  input.blur();
  await settle();
  expect(api.command).toHaveBeenCalledTimes(before + 1);
  expect(api.command.mock.calls.at(-1)![2]).toMatchObject({
    quantity: 12,
    expectedVersion: 2,
    expectedItemVersion: 1,
  });
});
it('commits on blur and leaves an unchanged value without a mutation', async () => {
  let input = await draftInput();
  const before = api.command.mock.calls.length;
  input.blur();
  expect(api.command).toHaveBeenCalledTimes(before);
  input.focus();
  typeQuantity(input, '7');
  input.blur();
  await settle();
  expect(lines[0].quantity).toBe(7);
  expect(api.command).toHaveBeenCalledTimes(before + 1);
});
it('does not repeat an Enter edit when blur happens after the refreshed value renders', async () => {
  const input = await draftInput();
  const before = api.command.mock.calls.length;
  typeQuantity(input, '9');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
  const refreshed = fixture.nativeElement.querySelector(
    '[data-testid="draft-line"] input',
  ) as HTMLInputElement;
  refreshed.focus();
  refreshed.blur();
  expect(api.command).toHaveBeenCalledTimes(before + 1);
  expect(lines[0].quantity).toBe(9);
});
it.each(['', 'abc', '-1', '0', '1.5', '9007199254740992', '1e3'])(
  'restores the canonical quantity and announces invalid input %j without a request',
  async (value) => {
    const input = await draftInput();
    const before = api.command.mock.calls.length;
    typeQuantity(input, value);
    input.blur();
    fixture.detectChanges();
    expect(input.value).toBe('1');
    expect(api.command).toHaveBeenCalledTimes(before);
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'quantité entière positive',
    );
  },
);
it('keeps captured versions on a typed conflict and refetches without rebasing', async () => {
  const input = await draftInput();
  const before = api.command.mock.calls.length;
  api.command.mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }));
  typeQuantity(input, '4');
  input.blur();
  await settle();
  expect(api.command).toHaveBeenCalledTimes(before + 1);
  expect(api.command.mock.calls.at(-1)![2]).toMatchObject({
    quantity: 4,
    expectedVersion: 2,
    expectedItemVersion: 1,
  });
  expect(page.message()).toBe('CONFLICT');
  expect(lines[0].quantity).toBe(1);
});
it('blocks other quantity changes while a typed edit has an unresolved intent', async () => {
  const input = await draftInput();
  api.command.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
  typeQuantity(input, '5');
  input.blur();
  await vi.waitFor(() => expect(page.pending()?.kind).toBe('edit'));
  await vi.waitFor(() => expect(page.busy()).toBe(false));
  const before = api.command.mock.calls.length;
  await page.quantity(lines[0], 1);
  await page.commitQuantity(lines[0]);
  expect(api.command).toHaveBeenCalledTimes(before);
});
it('uses labelled secondary Add and danger Remove controls and disables unavailable Add', async () => {
  await draftInput();
  fixture.detectChanges();
  const add = fixture.nativeElement.querySelector(
    'button[aria-label="Ajouter Beer"]',
  ) as HTMLButtonElement;
  const remove = fixture.nativeElement.querySelector(
    'button[aria-label="Retirer Beer du brouillon"]',
  ) as HTMLButtonElement;
  expect(add.querySelector('mat-icon')?.textContent).toBe('add');
  expect(add.textContent).toContain('Ajouter');
  expect(add.classList.contains('liass-action-secondary')).toBe(true);
  expect(remove.querySelector('mat-icon')?.textContent).toBe('delete_outline');
  expect(remove.textContent).toContain('Retirer');
  expect(remove.classList.contains('liass-action-danger')).toBe(true);
  add.focus();
  expect(document.activeElement).toBe(add);
  menu.cartePage.mockResolvedValue({
    outletId: rid(2),
    menuId: rid(7),
    items: [operational({ ...item(), availability: 'UNAVAILABLE' })],
  });
  await page.menuItemsQuery.refetch();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[aria-label="Ajouter Beer"]').disabled).toBe(
      true,
    );
  });
});
it.each([
  [fr, 'Aucune ligne', '1 ligne', '{{count}} lignes'],
  [en, 'No lines', '1 line', '{{count}} lines'],
])('has explicit zero, singular and plural copy in each language', (language, zero, one, many) => {
  const copy = language.RESTAURANTS.ORDER_TAKING;
  expect(copy.LINES_ZERO).toBe(zero);
  expect(copy.LINES_ONE).toBe(one);
  expect(copy.LINES_MANY).toBe(many);
  expect(page.lineCountKey(0)).toMatch(/LINES_ZERO$/);
  expect(page.lineCountKey(1)).toMatch(/LINES_ONE$/);
  expect(page.lineCountKey(2)).toMatch(/LINES_MANY$/);
});

it('retains Menu, draft and Order selection through command reconciliation without context reset', async () => {
  await draftInput();
  const menuNode = fixture.nativeElement.querySelector('#menu-title');
  const draftNode = fixture.nativeElement.querySelector('#draft-title');
  const input = fixture.nativeElement.querySelector('input[aria-label="Quantité de Beer"]');
  const selected = page.selectedId();
  const initialRevision = revision();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  api.orders.mockImplementationOnce(async () => {
    await gate;
    return { items: orders.map((o) => ({ ...o })) };
  });
  const action = page.quantity(lines[0], 1);
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.ordersQuery.isFetching()).toBe(true);
  });
  expect(page.selectedId()).toBe(selected);
  expect(page.ready()).toBe(true);
  expect(fixture.nativeElement.querySelector('#menu-title')).toBe(menuNode);
  expect(fixture.nativeElement.querySelector('#draft-title')).toBe(draftNode);
  expect(fixture.nativeElement.querySelector('input[aria-label="Quantité de Beer"]')).toBe(input);
  expect(revision()).toBe(initialRevision);
  release();
  await action;
  await settle();
  expect(fixture.componentInstance).toBe(page);
  expect(fixture.nativeElement.querySelector('#menu-title')).toBe(menuNode);
});

it('uses non-submitting controls and search Enter never commands or navigates', async () => {
  await draftInput();
  const host = fixture.nativeElement as HTMLElement;
  expect(host.querySelector('form')).toBeNull();
  for (const button of host.querySelectorAll('button')) expect(button.type).toBe('button');
  const before = api.command.mock.calls.length;
  const search =
    host.querySelector('input[formcontrolname="search"]') ??
    host.querySelector('input:not([inputmode="numeric"])');
  expect(search).not.toBeNull();
  search!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  fixture.detectChanges();
  expect(api.command).toHaveBeenCalledTimes(before);
  expect(revision()).toBe(0);
});

it.each(['lazy', 'existing'] as const)(
  'keeps %s Add immediately usable and coalesces repeated intent',
  async (mode) => {
    if (mode === 'existing') await draftInput();
    else
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(page.canAddItem(item())).toBe(true);
      });
    // Capability readiness can precede the asynchronous Carte's rendered rows.
    // Exercise pending feedback only after the actual Add action is available.
    await vi.waitFor(() => {
      fixture.detectChanges();
      const button = fixture.nativeElement.querySelector(
        'button[aria-label="Ajouter Beer"]',
      ) as HTMLButtonElement | null;
      expect(button).not.toBeNull();
      expect(button!.disabled).toBe(false);
    });
    const command = api.command.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    api.command.mockImplementationOnce(async (...args) => {
      await gate;
      return command(...args);
    });
    const menuNode = fixture.nativeElement.querySelector('#menu-title');
    const draftNode = fixture.nativeElement.querySelector('#draft-title');
    const before = api.command.mock.calls.length;
    const action = page.add(item());
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      'button[aria-label="Ajouter Beer"]',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Enregistrement en cours');
    expect(fixture.nativeElement.querySelector('#menu-title')).toBe(menuNode);
    expect(fixture.nativeElement.querySelector('#draft-title')).toBe(draftNode);
    expect(page.search.enabled).toBe(true);
    const second = page.add(item());
    expect(api.command).toHaveBeenCalledTimes(before + 1);
    release();
    await Promise.all([action, second]);
    await settle();
    expect(page.addingItem()).toBeNull();
    expect(page.drafts()[0].quantity).toBe(mode === 'existing' ? 3 : 2);
    expect(
      fixture.nativeElement
        .querySelector('button[aria-label="Ajouter Beer"]')
        .getAttribute('aria-busy'),
    ).toBeNull();
  },
);
it('restores local Add pending state after failure and retains actionable feedback', async () => {
  await draftInput();
  api.command.mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }));
  await page.add(item());
  fixture.detectChanges();
  expect(page.addingItem()).toBeNull();
  expect(page.message()).toBe('CONFLICT');
  expect(fixture.nativeElement.textContent).not.toContain('Enregistrement en cours');
  expect(page.drafts()).toHaveLength(1);
});

it.each(['organization', 'principal'] as const)(
  'rejects old reconciliation after %s switches',
  async (dimension) => {
    await draftInput();
    const oldContext = page.ctx();
    const oldOrder = page.selectedId();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    api.assertContext.mockImplementation((context) => {
      if (context.org !== org() || context.user !== user() || context.revision !== revision())
        throw new Error('Stale context');
    });
    api.orders.mockImplementationOnce(async () => {
      await gate;
      return { items: [orderFixture(oldOrder)] };
    });
    const action = page.quantity(lines[0], 1);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(page.ordersQuery.isFetching()).toBe(true);
    });
    if (dimension === 'organization') org.set('foreign');
    else user.set('other');
    // The workspace invalidates its authorized session input immediately on context change.
    fixture.componentRef.setInput('session', null);
    fixture.detectChanges();
    expect(page.ready()).toBe(false);
    expect(page.selectedId()).toBe('');
    expect(fixture.nativeElement.querySelector('[data-testid="order-taking"]')).toBeNull();
    release();
    await action;
    fixture.detectChanges();
    expect(page.selectedId()).toBe('');
    expect(page.pending()).toBeNull();
    expect(
      client.getQueryData(
        restaurantKeys.serviceOrder(
          oldContext.org,
          oldContext.user,
          oldContext.outlet,
          oldContext.session,
          oldContext.revision,
          'orders',
        ),
      ),
    ).toBeDefined();
    api.assertContext.mockReset();
  },
);

it('hydrates sequentially to the physical-page budget and continues only on request', async () => {
  let active = 0,
    maxActive = 0;
  menu.cartePage.mockImplementation(async (_ctx, cursor) => {
    active++;
    maxActive = Math.max(active, maxActive);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    const index = cursor ? Number(cursor) : 0;
    return {
      outletId: rid(2),
      menuId: rid(7),
      items: [{ ...operational(), id: rid(100 + index), name: 'Poulet braisé ' + index }],
      nextCursor: index < 24 ? String(index + 1) : undefined,
    };
  });
  menu.cartePage.mockClear();
  await page.menuItemsQuery.refetch();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.menuItemsQuery.data()?.pages).toHaveLength(20);
  });
  expect(page.budgetReached()).toBe(true);
  expect(page.incomplete()).toBe(true);
  expect(maxActive).toBe(1);
  const calls = menu.cartePage.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 30));
  fixture.detectChanges();
  expect(menu.cartePage).toHaveBeenCalledTimes(calls);
  page.continueCarte();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.incomplete()).toBe(false);
  });
  expect(page.matchingItems()).toHaveLength(25);
});
it('searches cached unrendered rows without requests and renders 50-row chunks', async () => {
  menu.cartePage.mockResolvedValue({
    outletId: rid(2),
    menuId: rid(7),
    items: Array.from({ length: 100 }, (_, i) => ({
      ...operational(),
      id: rid(100 + i),
      name: i === 99 ? 'Café crème' : 'Poulet braisé ' + i,
    })),
  });
  await page.menuItemsQuery.refetch();
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.menuItems()).toHaveLength(50);
  });
  const calls = menu.cartePage.mock.calls.length;
  page.search.setValue('cafe');
  fixture.detectChanges();
  expect(page.menuItems().map((item) => item.name)).toEqual(['Café crème']);
  expect(menu.cartePage).toHaveBeenCalledTimes(calls);
  page.search.setValue('');
  page.displayCount.set(100);
  fixture.detectChanges();
  expect(page.menuItems()).toHaveLength(100);
});
it('retains loaded DOM on later-page failure and never claims exhaustive zero matches', async () => {
  page.foreground.set(false);
  menu.cartePage
    .mockResolvedValueOnce({
      outletId: rid(2),
      menuId: rid(7),
      items: [operational()],
      nextCursor: 'next',
    })
    .mockRejectedValue(new HttpErrorResponse({ status: 503 }));
  await page.menuItemsQuery.refetch();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.incomplete()).toBe(true);
  });
  const add = fixture.nativeElement.querySelector('button[aria-label="Ajouter Beer"]');
  await page.menuItemsQuery.fetchNextPage();
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('button[aria-label="Ajouter Beer"]')).toBe(add);
  page.search.setValue('introuvable');
  fixture.detectChanges();
  expect(page.incomplete()).toBe(true);
  expect(fixture.nativeElement.textContent).not.toContain(fr.RESTAURANTS.ORDER_TAKING.NO_ITEMS);
});
it('does not hydrate while hidden/offline and resumes sequentially in foreground', async () => {
  page.foreground.set(false);
  // Resolve the canonical Menu identity before explicitly refetching its Carte;
  // otherwise the test can refetch the still-disabled placeholder key.
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.menuItemsQuery.isSuccess()).toBe(true);
  });
  menu.cartePage.mockImplementation(async (_ctx, cursor) => ({
    outletId: rid(2),
    menuId: rid(7),
    items: [],
    ...(!cursor ? { nextCursor: 'last' } : {}),
  }));
  await page.menuItemsQuery.refetch();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.menuItemsQuery.data()?.pages).toHaveLength(1);
    expect(page.incomplete()).toBe(true);
  });
  page.foreground.set(true);
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.menuItemsQuery.data()?.pages).toHaveLength(2);
  });
});

it.each(['increase', 'decrease', 'entry', 'remove'] as const)(
  'keeps %s pending local without a draft saving banner',
  async (action) => {
    await settle();
    await page.add(item());
    await settle();
    await page.quantity(page.drafts()[0], 1);
    await settle();
    const command = api.command.getMockImplementation()!;
    let release!: () => void;
    api.command.mockImplementationOnce(
      (...args) =>
        new Promise((resolve) => {
          release = () => resolve(command(...args));
        }),
    );
    const line = page.drafts()[0],
      menuNode = fixture.nativeElement.querySelector('#menu-title'),
      draftNode = fixture.nativeElement.querySelector('[data-testid="draft-line"]');
    let promise: Promise<unknown>;
    if (action === 'entry') {
      page.beginQuantity(line);
      page.quantityInput(line).setValue('12');
      promise = page.commitQuantity(line);
    } else
      promise =
        action === 'remove'
          ? page.remove(line)
          : page.quantity(line, action === 'increase' ? 1 : -1);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(page.busy()).toBe(true);
    });
    expect(fixture.nativeElement.textContent).not.toContain('Enregistrement en cours');
    expect(fixture.nativeElement.querySelector('#menu-title')).toBe(menuNode);
    expect(fixture.nativeElement.querySelector('[data-testid="draft-line"]')).toBe(
      action === 'remove' ? null : draftNode,
    );
    expect(page.search.enabled).toBe(true);
    release();
    await promise;
    await settle();
  },
);
it('aligns a compact desktop commit right and keeps mobile full width', async () => {
  await settle();
  await page.add(item());
  await settle();
  fixture.detectChanges();
  const footer = fixture.nativeElement.querySelector('[data-testid="draft-footer"]');
  const submit = fixture.nativeElement.querySelector('[data-testid="submit-round"]');
  expect(footer.classList.contains('sm:items-end')).toBe(true);
  expect(submit.classList.contains('w-full')).toBe(true);
  expect(submit.classList.contains('sm:w-auto')).toBe(true);
});
it('local search and cached chunk expansion have no network/pending affordance', async () => {
  await settle();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.menuItems().length).toBeGreaterThan(0);
  });
  const reads = menu.cartePage.mock.calls.length,
    commands = api.command.mock.calls.length;
  page.search.setValue('beer');
  page.displayCount.set(100);
  fixture.detectChanges();
  expect(menu.cartePage).toHaveBeenCalledTimes(reads);
  expect(api.command).toHaveBeenCalledTimes(commands);
  expect(page.busy()).toBe(false);
  expect(page.search.enabled).toBe(true);
  expect(fixture.nativeElement.querySelector('mat-spinner,mat-progress-spinner')).toBeNull();
});
it('keeps submit progress on its button without replacing the workspace', async () => {
  await settle();
  await page.add(item());
  await settle();
  const command = api.command.getMockImplementation()!;
  let release!: () => void;
  api.command.mockImplementationOnce(
    (...args) =>
      new Promise((resolve) => {
        release = () => resolve(command(...args));
      }),
  );
  const menuNode = fixture.nativeElement.querySelector('#menu-title');
  const promise = page.submit();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.busy()).toBe(true);
  });
  const button = fixture.nativeElement.querySelector('[data-testid="submit-round"]');
  expect(button.textContent).toContain('Validation…');
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(fixture.nativeElement.textContent).not.toContain('Enregistrement en cours');
  expect(fixture.nativeElement.querySelector('#menu-title')).toBe(menuNode);
  release();
  await promise;
  await settle();
});

it('keeps Ready DOM through draft micro-actions and refetches it only for submission', async () => {
  await page.add(item());
  await settle();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(serving.page).toHaveBeenCalledTimes(1);
  });
  const region = fixture.nativeElement.querySelector('[data-testid="table-delivery"]');
  serving.page.mockClear();
  await page.quantity(page.drafts()[0], 1);
  await settle();
  await page.remove(page.drafts()[0]);
  await settle();
  await page.add(item());
  await settle();
  expect(serving.page).not.toHaveBeenCalled();
  expect(fixture.nativeElement.querySelector('[data-testid="table-delivery"]')).toBe(region);
  await page.submit();
  await settle();
  await vi.waitFor(() => expect(serving.page).toHaveBeenCalledTimes(1));
  expect(fixture.nativeElement.querySelector('[data-testid="table-delivery"]')).toBe(region);
});

it('reconciles selected Order Preparation after an ambiguous submission result', async () => {
  await page.add(item());
  await settle();
  await vi.waitFor(() => expect(serving.page).toHaveBeenCalledTimes(1));
  serving.page.mockClear();
  api.command.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
  await page.submit();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(serving.page).toHaveBeenCalledTimes(1);
  });
  expect(page.pending()?.kind).toBe('submit');
});
