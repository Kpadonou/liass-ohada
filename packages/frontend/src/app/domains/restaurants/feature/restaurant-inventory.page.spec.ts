import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { of } from 'rxjs';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import fr from '../../../../../public/assets/i18n/fr.json';
import en from '../../../../../public/assets/i18n/en.json';
import { RestaurantInventoryPage } from './restaurant-inventory.page';
import { RestaurantStockItemDialog } from './restaurant-stock-item.dialog';
import { RestaurantStockMovementDialog } from './restaurant-stock-movement.dialog';
import {
  RestaurantInventoryQueries,
  inventoryKeys,
} from '../data-access/restaurant-inventory.queries';
import { RestaurantInventoryApi } from '../data-access/restaurant-inventory.api';
import { RestaurantInventoryIntent } from '../data-access/restaurant-inventory-intent';
import {
  inventoryContext as ctx,
  stockItem,
  stockMovement,
} from '../data-access/inventory.test-fixture';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { RestaurantOutletContext } from '../data-access/restaurant-outlet-context';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { NotificationService } from '../../../core/notifications/notification.service';

const allowed = signal(true),
  outlet = signal(ctx.outlet);
let client: QueryClient;
const api = {
  context: () => ({ ...ctx, outlet: outlet() }),
  isCurrent: () => allowed(),
  assertCurrent: vi.fn(),
  items: vi.fn(),
  item: vi.fn(),
  history: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  movement: vi.fn(),
};
const ref = { close: vi.fn(), disableClose: false };
const notification = { success: vi.fn() };
let data: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  allowed.set(true);
  outlet.set(ctx.outlet);
  sessionStorage.clear();
  api.items.mockResolvedValue({
    items: [stockItem({ balanceMilli: -2000, isNegativeStock: true, isActive: false })],
  });
  api.item.mockResolvedValue(stockItem());
  api.history.mockResolvedValue({ items: [] });
  api.create.mockResolvedValue({ data: stockItem({ balanceMilli: 0 }), message: null });
  api.update.mockResolvedValue({
    data: stockItem({ name: 'Changed', isActive: false, version: 2 }),
    message: null,
  });
  api.movement.mockResolvedValue({
    data: stockMovement({ deltaMilli: -2000, resultingBalanceMilli: -2000, isNegativeStock: true }),
    message: null,
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  data = { ctx };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: { fr, en },
        translocoConfig: { availableLangs: ['fr', 'en'], defaultLang: 'fr' },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([]),
      { provide: QueryClient, useValue: client },
      { provide: RestaurantInventoryApi, useValue: api },
      { provide: RestaurantsCapabilities, useValue: { canManageInventory: allowed } },
      { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
      {
        provide: RestaurantOutletContext,
        useValue: {
          id: outlet,
          identity: () => 'context',
          use: vi.fn(),
          outlet: () => ({ name: 'Agla' }),
          outlets: () => [],
          source: () => ({
            isPending: () => false,
            isError: () => false,
            hasNextPage: () => false,
          }),
        },
      },
      { provide: MAT_DIALOG_DATA, useFactory: () => data },
      { provide: MatDialogRef, useValue: ref },
      {
        provide: MatDialog,
        useValue: { open: vi.fn(() => ({ afterClosed: () => of(undefined) })) },
      },
      { provide: NotificationService, useValue: notification },
    ],
  });
});
afterEach(() => {
  client.clear();
  sessionStorage.clear();
  TestBed.resetTestingModule();
});
describe('Inventory collection and detail', () => {
  it('renders a bounded table/compact records with business quantity, negative and inactive states', async () => {
    const f = TestBed.createComponent(RestaurantInventoryPage);
    f.detectChanges();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.itemsQuery.isSuccess()).toBe(true);
    });
    f.detectChanges();
    expect(f.nativeElement.querySelector('table')).toBeTruthy();
    expect(f.nativeElement.textContent).toContain('−2');
    expect(f.nativeElement.textContent).toContain('Stock négatif');
    expect(f.nativeElement.textContent).toContain('Inactif');
    expect(f.nativeElement.textContent).not.toContain('balanceMilli');
    expect(f.nativeElement.querySelector('table th:last-child').textContent).toContain('Actions');
    f.componentInstance.selected.set(stockItem().id);
    f.detectChanges();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.historyQuery.isSuccess()).toBe(true);
    });
    f.detectChanges();
    expect(api.item).toHaveBeenCalled();
    expect(api.history).toHaveBeenCalled();
  });
  it('shows one contextual empty state instead of an empty table', async () => {
    api.items.mockResolvedValue({ items: [] });
    const f = TestBed.createComponent(RestaurantInventoryPage);
    f.detectChanges();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.itemsQuery.isSuccess()).toBe(true);
    });
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Aucun article de stock');
    expect(f.nativeElement.querySelector('table')).toBeNull();
  });
  it('preserves explicit cursor continuation and immutable history display', async () => {
    api.items
      .mockResolvedValueOnce({ items: [stockItem()], nextCursor: 'items-next' })
      .mockResolvedValue({ items: [stockItem({ id: crypto.randomUUID() })] });
    api.history
      .mockResolvedValueOnce({
        items: [
          stockMovement({
            type: 'LOSS',
            deltaMilli: -2000,
            resultingBalanceMilli: -1000,
            isNegativeStock: true,
          }),
        ],
        nextCursor: 'history-next',
      })
      .mockResolvedValue({
        items: [
          stockMovement({
            id: crypto.randomUUID(),
            type: 'SALE_REVERSAL',
            createdAt: '2026-10-26T10:00:00.000Z',
          }),
        ],
      });
    const f = TestBed.createComponent(RestaurantInventoryPage);
    f.detectChanges();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.itemsQuery.hasNextPage()).toBe(true);
    });
    await f.componentInstance.itemsQuery.fetchNextPage();
    expect(api.items).toHaveBeenLastCalledWith(
      expect.objectContaining({ outlet: ctx.outlet }),
      'items-next',
    );
    f.componentInstance.selected.set(stockItem().id);
    f.detectChanges();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.historyQuery.hasNextPage()).toBe(true);
    });
    await f.componentInstance.historyQuery.fetchNextPage();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.movements()).toHaveLength(2);
    });
    expect(api.history).toHaveBeenLastCalledWith(expect.anything(), stockItem().id, 'history-next');
    expect(f.componentInstance.movements()[0].type).toBe('LOSS');
    expect(f.nativeElement.textContent).toContain('−2');
    expect(f.nativeElement.textContent).toContain('Stock après mouvement');
    expect(f.nativeElement.textContent).toContain('Annulation de vente');
    expect(f.nativeElement.querySelector('ol input')).toBeNull();
  });
  it('shows loading/access errors and clears selection when context changes', async () => {
    api.items.mockReturnValue(new Promise(() => {}));
    const f = TestBed.createComponent(RestaurantInventoryPage);
    f.detectChanges();
    expect(f.nativeElement.querySelector('[aria-busy="true"]')).toBeTruthy();
    f.componentInstance.selected.set(stockItem().id);
    outlet.set(crypto.randomUUID());
    f.detectChanges();
    expect(f.componentInstance.selected()).toBeNull();
    allowed.set(false);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain(fr.RESTAURANTS_INVENTORY.ERRORS.FORBIDDEN);
  });
});
describe('Stock item reactive editor', () => {
  it('offers all eight units and zero-stock guidance without a balance control', async () => {
    const f = TestBed.createComponent(RestaurantStockItemDialog);
    f.detectChanges();
    expect(f.componentInstance.units).toHaveLength(8);
    expect(f.nativeElement.textContent).toContain('stock initial est de 0');
    expect(Object.keys(f.componentInstance.form.controls)).not.toContain('balance');
    f.componentInstance.form.controls.name.setValue('Water');
    await f.componentInstance.save();
    expect(api.create).toHaveBeenCalledWith(ctx, { name: 'Water', unit: 'UNIT' });
    expect(ref.close).toHaveBeenCalledWith(expect.objectContaining({ balanceMilli: 0 }));
  });
  it('only updates name/active with expectedVersion and refreshes conflicts without overwrite', async () => {
    data = { ctx, item: stockItem() };
    const f = TestBed.createComponent(RestaurantStockItemDialog);
    f.detectChanges();
    expect(f.componentInstance.form.controls.unit.disabled).toBe(true);
    f.componentInstance.form.controls.name.setValue('Changed');
    f.componentInstance.form.controls.isActive.setValue(false);
    const invalidation = vi.spyOn(client, 'invalidateQueries');
    api.update.mockRejectedValue(new HttpErrorResponse({ status: 409 }));
    await f.componentInstance.save();
    f.detectChanges();
    expect(api.update).toHaveBeenCalledWith(ctx, stockItem().id, {
      expectedVersion: 1,
      name: 'Changed',
      isActive: false,
    });
    expect(f.componentInstance.conflict()).toBe(true);
    expect(ref.close).not.toHaveBeenCalled();
    expect(invalidation).toHaveBeenCalledWith({
      queryKey: inventoryKeys.item(ctx, stockItem().id),
      exact: true,
    });
    expect(f.nativeElement.textContent).toContain(fr.RESTAURANTS_INVENTORY.CONFLICT_REOPEN);
  });
});
describe('Focused movement forms', () => {
  it.each([
    ['RECEIPT', 'INCREASE', '3'],
    ['LOSS', 'INCREASE', '3'],
    ['ADJUSTMENT', 'INCREASE', '3'],
    ['ADJUSTMENT', 'DECREASE', '-3'],
  ] as const)(
    '%s %s submits positive business entry with domain direction',
    async (type, direction, expected) => {
      data = { ctx, item: stockItem(), type };
      const f = TestBed.createComponent(RestaurantStockMovementDialog);
      f.detectChanges();
      f.componentInstance.form.controls.quantity.setValue('3');
      f.componentInstance.form.controls.direction.setValue(direction);
      await f.componentInstance.submit();
      expect(api.movement).toHaveBeenCalledWith(
        ctx,
        stockItem().id,
        expect.objectContaining({ type, quantity: expected, clientRequestId: expect.any(String) }),
      );
      expect(ref.close).toHaveBeenCalledWith(expect.objectContaining({ isNegativeStock: true }));
    },
  );
  it('validates discrete/continuous precision and uses translated inline feedback', () => {
    data = { ctx, item: stockItem(), type: 'LOSS' };
    const f = TestBed.createComponent(RestaurantStockMovementDialog);
    f.componentInstance.form.controls.quantity.setValue('1.5');
    f.componentInstance.form.markAllAsTouched();
    f.detectChanges();
    expect(f.componentInstance.form.invalid).toBe(true);
    expect(f.nativeElement.textContent).toContain(fr.RESTAURANTS_INVENTORY.ERRORS.WHOLE);
  });
  it('accepts continuous milli input and retains the exact request across uncertain retry', async () => {
    data = { ctx, item: stockItem({ unit: 'KG' }), type: 'ADJUSTMENT' };
    const f = TestBed.createComponent(RestaurantStockMovementDialog);
    f.detectChanges();
    f.componentInstance.form.controls.quantity.setValue('1,251');
    api.movement.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await f.componentInstance.submit();
    expect(f.componentInstance.uncertain()).toBe(true);
    expect(f.componentInstance.form.disabled).toBe(true);
    const request = api.movement.mock.calls[0][2];
    await f.componentInstance.submit();
    expect(api.movement.mock.calls[1][2]).toEqual(request);
    expect(request.quantity).toBe('1.251');
    expect(notification.success).toHaveBeenCalled();
  });
});
