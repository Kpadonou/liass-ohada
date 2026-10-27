import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import fr from '../../../../../public/assets/i18n/fr.json';
import en from '../../../../../public/assets/i18n/en.json';
import { RestaurantItemTrackingComponent } from './restaurant-item-tracking.component';
import { RestaurantInventoryApi } from '../data-access/restaurant-inventory.api';
import {
  RestaurantInventoryQueries,
  inventoryKeys,
} from '../data-access/restaurant-inventory.queries';
import { inventoryContext as ctx, stockItem } from '../data-access/inventory.test-fixture';
import { rid, row } from '../data-access/restaurants.test-fixture';
import { MenuItem } from '@liass-ohada/shared/restaurants';
const menuId = rid(10),
  category = rid(11);
const savedItem = (station?: string): MenuItem => ({
  ...(row('item') as MenuItem),
  id: menuId,
  categoryId: category,
  preparationStationId: station,
});
const api = {
  context: () => ctx,
  isCurrent: () => true,
  assertCurrent: vi.fn(),
  tracking: vi.fn(),
  items: vi.fn(),
};
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  api.tracking.mockResolvedValue({ menuItemId: menuId, version: 0, stockItem: null });
  api.items.mockResolvedValue({
    items: [
      stockItem(),
      stockItem({ id: rid(82), isActive: false }),
      stockItem({ id: rid(83), unit: 'KG' }),
    ],
  });
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: { fr, en },
        preloadLangs: true,
        translocoConfig: { availableLangs: ['fr', 'en'], defaultLang: 'fr' },
      }),
    ],
    providers: [
      { provide: QueryClient, useValue: client },
      { provide: RestaurantInventoryApi, useValue: api },
    ],
  });
});
afterEach(() => {
  client.clear();
  TestBed.resetTestingModule();
});
async function setup(existing = true, station: string | null = null) {
  const f = TestBed.createComponent(RestaurantItemTrackingComponent);
  for (const [key, value] of Object.entries({
    outlet: ctx.outlet,
    category,
    menuItemId: existing ? menuId : '',
    name: 'Menu name',
    station,
    allowed: true,
  }))
    f.componentRef.setInput(key, value);
  f.detectChanges();
  if (existing)
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.query.isSuccess()).toBe(true);
    });
  return f;
}
it('defaults to tracking off and automatic creation with four discrete units and no initial stock field', async () => {
  const f = await setup(false);
  expect(f.componentInstance.form.controls.enabled.value).toBe(false);
  expect(f.componentInstance.form.controls.mode.value).toBe('CREATE');
  expect(f.componentInstance.units).toEqual(['UNIT', 'BOTTLE', 'CAN', 'PACK']);
  f.componentInstance.form.controls.enabled.setValue(true);
  f.detectChanges();
  expect(f.nativeElement.textContent).toContain('Menu name');
  expect(f.nativeElement.querySelector('[formControlName="balanceMilli"]')).toBeNull();
  await f.componentInstance.persist(savedItem());
  expect(api.tracking).toHaveBeenCalledWith(
    ctx,
    category,
    menuId,
    expect.objectContaining({
      mode: 'CREATE',
      unit: 'UNIT',
      expectedVersion: 0,
      clientRequestId: expect.any(String),
    }),
    expect.any(Function),
  );
});
it('explains station ineligibility without exposing an enabled selector', async () => {
  const f = await setup(false, rid(12));
  expect(f.nativeElement.textContent).toContain(fr.RESTAURANTS_TRACKING.STATION_HINT);
  expect(f.nativeElement.querySelector('mat-select')).toBeNull();
  await f.componentInstance.persist(savedItem(rid(12)));
  expect(api.tracking).not.toHaveBeenCalled();
});
it('filters existing selection to loaded active discrete stock and links with canonical invalidation', async () => {
  const f = await setup();
  f.componentInstance.form.patchValue({ enabled: true, mode: 'LINK' });
  f.detectChanges();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.items.isSuccess()).toBe(true);
  });
  expect(f.componentInstance.options()).toEqual([
    { value: stockItem().id, label: 'Bottled water — Bouteille' },
  ]);
  f.componentInstance.form.controls.stockItemId.setValue(stockItem().id);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await f.componentInstance.persist(savedItem());
  expect(api.tracking).toHaveBeenCalledWith(
    ctx,
    category,
    menuId,
    expect.objectContaining({ mode: 'LINK', stockItemId: stockItem().id }),
    expect.any(Function),
  );
  expect(invalidate).toHaveBeenCalled();
});
it.each([true, false])(
  'shows linked stock independently of its lifecycle (%s), permits remove without deleting stock',
  async (isActive) => {
    const tracking = {
      menuItemId: menuId,
      version: 2,
      stockItem: stockItem({ isActive, name: 'Independent stock name' }),
    };
    api.tracking.mockResolvedValue(tracking);
    const f = await setup();
    expect(f.nativeElement.textContent).toContain('Independent stock name');
    if (!isActive) expect(f.nativeElement.textContent).toContain(fr.RESTAURANTS_TRACKING.INACTIVE);
    expect(f.nativeElement.textContent).not.toContain('Réception');
    await f.componentInstance.persist(savedItem());
    expect(api.tracking).toHaveBeenCalledTimes(1); // Unchanged metadata save preserves link.
    f.componentInstance.edit();
    f.componentInstance.form.controls.enabled.setValue(false);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain(fr.RESTAURANTS_TRACKING.PRESERVED);
    await f.componentInstance.persist(savedItem());
    expect(api.tracking).toHaveBeenCalledWith(
      ctx,
      category,
      menuId,
      expect.objectContaining({ expectedVersion: 2, clientRequestId: expect.any(String) }),
      expect.any(Function),
    );
    expect(api.tracking.mock.calls.find((call) => call.length === 5)![3]).not.toHaveProperty(
      'mode',
    );
  },
);
it('replaces one current link using canonical version', async () => {
  api.tracking.mockResolvedValue({
    menuItemId: menuId,
    version: 2,
    stockItem: stockItem({ id: rid(90) }),
  });
  const f = await setup();
  f.componentInstance.edit();
  f.detectChanges();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.items.isSuccess()).toBe(true);
  });
  f.componentInstance.form.controls.stockItemId.setValue(stockItem().id);
  await f.componentInstance.persist(savedItem());
  expect(api.tracking).toHaveBeenCalledWith(
    ctx,
    category,
    menuId,
    expect.objectContaining({ expectedVersion: 2, stockItemId: stockItem().id }),
    expect.any(Function),
  );
});
it('retains the exact automatic-create command on uncertain retry', async () => {
  const f = await setup(false);
  f.componentInstance.form.controls.enabled.setValue(true);
  api.tracking.mockImplementationOnce(async (...args) => {
    args[4]?.();
    throw new HttpErrorResponse({ status: 0 });
  });
  await expect(f.componentInstance.persist(savedItem())).rejects.toThrow();
  const command = api.tracking.mock.calls[0][3];
  expect(f.componentInstance.uncertain()).toBe(true);
  await f.componentInstance.persist(savedItem());
  expect(api.tracking.mock.calls[1][3]).toEqual(command);
  expect(f.componentInstance.uncertain()).toBe(false);
  expect(f.componentInstance.error()).toBeNull();
});
it('distinguishes pre-dispatch failure from an uncertain write and retries the same unchanged intent', async () => {
  const f = await setup(false);
  f.componentInstance.form.controls.enabled.setValue(true);
  api.tracking.mockRejectedValueOnce(new Error('Local validation failure'));
  await expect(f.componentInstance.persist(savedItem())).rejects.toThrow();
  const command = api.tracking.mock.calls[0][3];
  f.detectChanges();
  expect(f.componentInstance.uncertain()).toBe(false);
  expect(f.nativeElement.textContent).toContain(fr.RESTAURANTS_TRACKING.SAVE_ERROR);
  expect(f.nativeElement.textContent).not.toContain(fr.RESTAURANTS_TRACKING.UNCERTAIN);
  expect(f.componentInstance.form.enabled).toBe(true);
  await f.componentInstance.persist(savedItem());
  expect(api.tracking.mock.calls[1][3]).toEqual(command);
});
it('validates shared tracking contracts and provides FR/EN concepts', async () => {
  expect(fr.RESTAURANTS_TRACKING.TITLE).toBe('Suivi de stock');
  expect(en.RESTAURANTS_TRACKING.TITLE).toBe('Inventory tracking');
  expect(fr.RESTAURANTS_TRACKING.SAVE_ERROR).toContain("n'a pas pu être configuré");
  expect(en.RESTAURANTS_TRACKING.SAVE_ERROR).toContain('could not be configured');
  expect(fr.RESTAURANTS_TRACKING.UNCERTAIN).toContain('configuration du suivi');
  expect(en.RESTAURANTS_TRACKING.UNCERTAIN).toContain('tracking configuration');
  expect(fr.RESTAURANTS_TRACKING.UNCERTAIN).not.toMatch(/mouvement/i);
  expect(en.RESTAURANTS_TRACKING.UNCERTAIN).not.toMatch(/movement/i);
  const C = await import('@liass-ohada/shared/restaurants');
  expect(
    C.SaveInventoryTrackingRequestSchema.safeParse({
      categoryId: category,
      expectedVersion: 0,
      clientRequestId: crypto.randomUUID(),
      mode: 'CREATE',
      unit: 'KG',
    }).success,
  ).toBe(false);
  const f = await setup();
  expect(client.getQueryData(inventoryKeys.tracking(ctx, category, menuId))).toBeDefined();
  expect(TestBed.inject(RestaurantInventoryQueries)).toBeTruthy();
});
