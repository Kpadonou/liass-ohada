import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AuthStore } from '../../identity/data-access/auth.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { RestaurantOutletContext } from './restaurant-outlet-context';
import { RestaurantsCapabilities } from './restaurants-capabilities';
import { RestaurantInventoryApi } from './restaurant-inventory.api';
import { inventoryContext as ctx, stockItem, stockMovement } from './inventory.test-fixture';
describe('Inventory HTTP contracts and context isolation', () => {
  const org = signal(ctx.org),
    user = signal(ctx.user),
    revision = signal(ctx.revision),
    outlet = signal(ctx.outlet),
    identity = signal(ctx.identity),
    allowed = signal(true);
  let api: RestaurantInventoryApi, http: HttpTestingController;
  beforeEach(() => {
    org.set(ctx.org);
    user.set(ctx.user);
    revision.set(ctx.revision);
    outlet.set(ctx.outlet);
    identity.set(ctx.identity);
    allowed.set(true);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthStore,
          useValue: { effectiveOrgId: org, currentUserId: user, contextRevision: revision },
        },
        { provide: RestaurantOutletContext, useValue: { id: outlet, identity } },
        { provide: RestaurantsCapabilities, useValue: { canManageInventory: allowed } },
        { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
      ],
    });
    api = TestBed.inject(RestaurantInventoryApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });
  it('requests bounded cursor pages and parses shared item contracts', async () => {
    const result = api.items(ctx, 'opaque');
    const req = http.expectOne((r) => r.url.endsWith('/inventory/items'));
    expect(req.request.params.get('limit')).toBe('50');
    expect(req.request.params.get('cursor')).toBe('opaque');
    req.flush({ items: [stockItem()] });
    expect((await result).items[0].balanceMilli).toBe(12000);
  });
  it('rejects internal/invalid response fields before exposure', async () => {
    const result = api.items(ctx);
    const assertion = expect(result).rejects.toThrow();
    http.expectOne(() => true).flush({ items: [{ ...stockItem(), PK: 'private' }] });
    await assertion;
  });
  it('sends narrow creation/PATCH/movement payloads and no initial balance', async () => {
    const create = api.create(ctx, { name: 'Water', unit: 'BOTTLE' });
    let req = http.expectOne(() => true);
    expect(req.request.body).toEqual({ name: 'Water', unit: 'BOTTLE' });
    req.flush({ data: stockItem({ balanceMilli: 0 }) });
    await create;
    const update = api.update(ctx, stockItem().id, {
      expectedVersion: 1,
      name: 'Other',
      isActive: false,
    });
    req = http.expectOne(() => true);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.unit).toBeUndefined();
    req.flush({ data: stockItem({ name: 'Other', isActive: false }) });
    await update;
    const input = { clientRequestId: crypto.randomUUID(), type: 'LOSS' as const, quantity: '2' };
    const move = api.movement(ctx, stockItem().id, input);
    req = http.expectOne((r) => r.url.endsWith('/movements'));
    expect(req.request.body).toEqual(input);
    req.flush({
      data: stockMovement({
        type: 'LOSS',
        deltaMilli: -2000,
        resultingBalanceMilli: -1000,
        isNegativeStock: true,
      }),
    });
    expect((await move).data.isNegativeStock).toBe(true);
  });
  it.each(['org', 'user', 'revision', 'outlet', 'identity', 'permission'])(
    'rejects stale %s results',
    async (field) => {
      const result = api.item(ctx, stockItem().id);
      const assertion = expect(result).rejects.toMatchObject({ status: 409 });
      const req = http.expectOne(() => true);
      if (field === 'org') org.set('other');
      if (field === 'user') user.set('other');
      if (field === 'revision') revision.set(2);
      if (field === 'outlet') outlet.set(crypto.randomUUID());
      if (field === 'identity') identity.set('other');
      if (field === 'permission') allowed.set(false);
      req.flush({ data: stockItem() });
      await assertion;
    },
  );
  it('does not issue a request after permission revocation', async () => {
    allowed.set(false);
    await expect(api.items(ctx)).rejects.toMatchObject({ status: 409 });
    http.expectNone(() => true);
  });
  it('reads and changes tracking in the explicit configuration outlet with strict shared contracts', async () => {
    const configuration = api.context(crypto.randomUUID());
    const categoryId = crypto.randomUUID(),
      menuItemId = crypto.randomUUID();
    const response = { data: { menuItemId, version: 0, stockItem: null } };
    const read = api.tracking(configuration, categoryId, menuItemId);
    let req = http.expectOne((r) => r.url.endsWith(`/inventory/menu-items/${menuItemId}/tracking`));
    expect(req.request.params.get('categoryId')).toBe(categoryId);
    expect(req.request.url).toContain(configuration.outlet);
    req.flush(response);
    await read;
    const command = {
      categoryId,
      expectedVersion: 0,
      clientRequestId: crypto.randomUUID(),
      mode: 'CREATE' as const,
      unit: 'BOTTLE' as const,
    };
    const save = api.tracking(configuration, categoryId, menuItemId, command);
    req = http.expectOne(() => true);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(command);
    req.flush(response);
    await save;
    const remove = { categoryId, expectedVersion: 1, clientRequestId: crypto.randomUUID() };
    const removal = api.tracking(configuration, categoryId, menuItemId, remove);
    req = http.expectOne(() => true);
    expect(req.request.method).toBe('DELETE');
    req.flush(response);
    await removal;
  });
  it('rejects a tracking response after the authenticated context changes', async () => {
    const categoryId = crypto.randomUUID(),
      menuItemId = crypto.randomUUID();
    const response = api.tracking(api.context(ctx.outlet), categoryId, menuItemId);
    const rejected = expect(response).rejects.toMatchObject({ status: 409 });
    const req = http.expectOne(() => true);
    revision.set(revision() + 1);
    req.flush({ data: { menuItemId, version: 0, stockItem: null } });
    await rejected;
  });
});
