import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { MenuItem } from '@liass-ohada/shared/restaurants';
import fr from '../../../../../public/assets/i18n/fr.json';
import en from '../../../../../public/assets/i18n/en.json';
import { AuthStore } from '../../identity/data-access/auth.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { NotificationService } from '../../../core/notifications/notification.service';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { RestaurantOutletContext } from '../data-access/restaurant-outlet-context';
import { RestaurantInventoryApi } from '../data-access/restaurant-inventory.api';
import { inventoryKeys } from '../data-access/restaurant-inventory.queries';
import { stockItem } from '../data-access/inventory.test-fixture';
import { context, row } from '../data-access/restaurants.test-fixture';
import { RestaurantEditorComponent } from './restaurant-editor.component';

// Real editor + tracking child + query helpers + both HTTP clients. Only transport is replaced.
describe('MenuItem save followed by inventory tracking HTTP orchestration', () => {
  let client: QueryClient, http: HttpTestingController;
  const close = vi.fn(),
    changed = vi.fn().mockResolvedValue(undefined);
  const saved: MenuItem = {
    ...(row('item') as MenuItem),
    preparationStationId: undefined,
    version: 7,
  };
  beforeEach(() => {
    vi.clearAllMocks();
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60_000 } } });
  });
  afterEach(() => {
    try {
      http.verify();
    } finally {
      client.clear();
      TestBed.resetTestingModule();
    }
  });
  async function setup(existing = false) {
    TestBed.configureTestingModule({
      imports: [
        RestaurantEditorComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr, en },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['fr', 'en'], defaultLang: 'fr' },
        }),
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            org: 'org',
            kind: 'item',
            context: { ...context },
            currency: 'XOF',
            ...(existing ? { entity: { ...saved, version: 6 } } : {}),
          },
        },
        { provide: MatDialogRef, useValue: { close } },
        { provide: QueryClient, useValue: client },
        {
          provide: AuthStore,
          useValue: {
            effectiveOrgId: () => 'org',
            currentUserId: () => 'owner',
            contextRevision: () => 1,
          },
        },
        {
          provide: RestaurantOutletContext,
          useValue: { id: () => context.outletId, identity: () => 'active-outlet' },
        },
        {
          provide: RestaurantsCapabilities,
          useValue: {
            canManageMenu: () => true,
            canManageSetup: () => true,
            canManageInventory: () => true,
          },
        },
        { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
        {
          provide: RestaurantsQueries,
          useValue: {
            scope: () => 'org',
            userScope: () => 'owner',
            changed,
            confirmed: changed,
            pendingCreationKey: () => ['pending-editor'],
            beginInteraction: vi.fn(() => ({ success: vi.fn(), failure: vi.fn() })),
            denied: vi.fn(),
            detail: () => ({
              queryKey: ['disabled-station'],
              queryFn: async () => null,
              enabled: false,
            }),
            list: () => ({
              queryKey: ['disabled-stations'],
              queryFn: async () => ({ items: [] }),
              initialPageParam: undefined,
              getNextPageParam: () => undefined,
              enabled: false,
            }),
          },
        },
      ],
    });
    await TestBed.compileComponents();
    http = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(RestaurantEditorComponent);
    f.detectChanges();
    if (existing) {
      http
        .expectOne((r) => r.url.endsWith('/tracking'))
        .flush({ data: { menuItemId: saved.id, version: 2, stockItem: null } });
      await vi.waitFor(() => {
        f.detectChanges();
        expect(f.componentInstance.tracking()!.query.isSuccess()).toBe(true);
      });
    }
    f.componentInstance.form.patchValue({ name: 'PILS 66', price: '5000', station: null });
    return f;
  }
  it.each(['CREATE', 'LINK'] as const)(
    'creates MenuItem then sends exactly one %s PUT with its canonical identity',
    async (mode) => {
      const f = await setup();
      const tracking = f.componentInstance.tracking()!;
      tracking.form.patchValue({ enabled: true, mode, unit: 'BOTTLE' });
      f.detectChanges();
      if (mode === 'LINK') {
        http.expectOne((r) => r.url.endsWith('/inventory/items')).flush({ items: [stockItem()] });
        await vi.waitFor(() => {
          f.detectChanges();
          expect(tracking.items.isSuccess()).toBe(true);
        });
        tracking.form.controls.stockItemId.setValue(stockItem().id);
      }
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      const persist = vi.spyOn(tracking, 'persist');
      const submitting = f.componentInstance.submit();
      const menu = http.expectOne((r) => r.method === 'POST');
      http.expectNone((r) => r.method === 'PUT');
      menu.flush({ data: saved });
      await vi.waitFor(() =>
        expect(persist).toHaveBeenCalledWith(
          saved,
          expect.objectContaining({
            categoryId: saved.categoryId,
            context: expect.objectContaining({ outlet: saved.outletId }),
            mode,
          }),
        ),
      );
      const put = http.expectOne((r) => r.method === 'PUT');
      expect(put.request.url).toContain(`/menu-items/${saved.id}/tracking`);
      expect(put.request.body).toMatchObject({
        mode,
        expectedVersion: 0,
        categoryId: saved.categoryId,
      });
      expect(f.componentInstance.version()).toBe(7);
      const result = {
        menuItemId: saved.id,
        version: 1,
        stockItem: stockItem({ balanceMilli: 0 }),
      };
      put.flush({ data: result });
      await submitting;
      const ctx = TestBed.inject(RestaurantInventoryApi).context(context.outletId);
      expect(client.getQueryData(inventoryKeys.tracking(ctx, saved.categoryId, saved.id))).toEqual(
        result,
      );
      expect(
        invalidate.mock.calls.some(
          ([filter]) =>
            JSON.stringify(filter?.queryKey) ===
            JSON.stringify(inventoryKeys.tracking(ctx, saved.categoryId, saved.id)),
        ),
      ).toBe(false);
      expect(changed).toHaveBeenCalledWith('org', 'item', context, saved, true, expect.anything());
      expect(close).toHaveBeenCalledWith(saved);
      expect(tracking.uncertain()).toBe(false);
      http.expectNone((r) => r.method === 'PUT');
    },
  );
  it('uses the post-save MenuItem and preserves the distinct relationship version on edit', async () => {
    const f = await setup(true);
    const tracking = f.componentInstance.tracking()!;
    tracking.form.controls.enabled.setValue(true);
    const persist = vi.spyOn(tracking, 'persist');
    const submitting = f.componentInstance.submit();
    const patch = http.expectOne((r) => r.method === 'PATCH');
    expect(patch.request.body.expectedVersion).toBe(6);
    patch.flush({ data: saved });
    await vi.waitFor(() =>
      expect(persist).toHaveBeenCalledWith(saved, expect.objectContaining({ expectedVersion: 2 })),
    );
    const put = http.expectOne((r) => r.method === 'PUT');
    expect(put.request.body.expectedVersion).toBe(2); // Tracking concurrency token, not MenuItem version 7.
    put.flush({ data: { menuItemId: saved.id, version: 3, stockItem: stockItem() } });
    // The canonical PUT response replaces the relationship without a second GET.
    await vi.waitFor(() => expect(tracking.query.data()?.version).toBe(3));
    http.expectNone((r) => r.url.endsWith('/tracking') && r.method === 'GET');
    await submitting;
  });
  it('retains saved MenuItem before refresh failures and retries tracking without another Menu write', async () => {
    const f = await setup();
    const tracking = f.componentInstance.tracking()!;
    tracking.form.controls.enabled.setValue(true);
    const api = TestBed.inject(RestaurantInventoryApi);
    const call = api.tracking.bind(api);
    const dispatch = vi.spyOn(api, 'tracking').mockRejectedValueOnce(new Error('Local failure'));
    const first = f.componentInstance.submit();
    http.expectOne((r) => r.method === 'POST').flush({ data: saved });
    await first;
    expect(f.componentInstance.savedItemId()).toBe(saved.id);
    expect(tracking.uncertain()).toBe(false);
    expect(f.componentInstance.error()).toBe(fr.RESTAURANTS_TRACKING.SAVE_ERROR);
    http.expectNone((r) => r.method === 'PUT');
    dispatch.mockImplementation(call);
    const retry = f.componentInstance.submit();
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith(saved.id)).flush({ data: saved });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
    const put = http.expectOne((r) => r.method === 'PUT');
    expect(put.request.body.clientRequestId).toBe(dispatch.mock.calls[0][3]!.clientRequestId);
    put.flush({
      data: { menuItemId: saved.id, version: 1, stockItem: stockItem({ balanceMilli: 0 }) },
    });
    await retry;
    http.expectNone((r) => r.method === 'POST' || r.method === 'PATCH');
    expect(close).toHaveBeenCalledWith(saved);
  });
  it('retries a dispatched uncertain PUT with the same request identity and completes normally', async () => {
    const f = await setup();
    const tracking = f.componentInstance.tracking()!;
    tracking.form.controls.enabled.setValue(true);
    const first = f.componentInstance.submit();
    http.expectOne((r) => r.method === 'POST').flush({ data: saved });
    await vi.waitFor(() => expect(f.componentInstance.savedItemId()).toBe(saved.id));
    const put = http.expectOne((r) => r.method === 'PUT');
    const requestId = put.request.body.clientRequestId;
    put.error(new ProgressEvent('error'));
    await first;
    expect(tracking.uncertain()).toBe(true);
    expect(close).not.toHaveBeenCalled();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain(fr.RESTAURANTS_TRACKING.UNCERTAIN);
    expect(f.nativeElement.textContent).not.toContain(fr.RESTAURANTS_INVENTORY.UNCERTAIN);
    const retry = f.componentInstance.submit();
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith(saved.id)).flush({ data: saved });
    await vi.waitFor(() => expect(tracking.pending()).toBe(true));
    const repeated = http.expectOne((r) => r.method === 'PUT');
    expect(repeated.request.body.clientRequestId).toBe(requestId);
    repeated.flush({
      data: { menuItemId: saved.id, version: 1, stockItem: stockItem({ balanceMilli: 0 }) },
    });
    await retry;
    expect(tracking.uncertain()).toBe(false);
    expect(tracking.error()).toBeNull();
    expect(close).toHaveBeenCalledWith(saved);
    http.expectNone((r) => r.method === 'POST' || r.method === 'PATCH' || r.method === 'PUT');
  });
  it('saves an untracked MenuItem without a tracking write', async () => {
    const f = await setup();
    const submitting = f.componentInstance.submit();
    http.expectOne((r) => r.method === 'POST').flush({ data: saved });
    await submitting;
    http.expectNone((r) => r.method === 'PUT' || r.method === 'DELETE');
    expect(close).toHaveBeenCalledWith(saved);
  });
  it.each(['CREATE', 'LINK'] as const)(
    'retains submitted %s context across reactive resets and delays collection refresh until after PUT success',
    async (mode) => {
      const f = await setup();
      const tracking = f.componentInstance.tracking()!;
      tracking.form.patchValue({ enabled: true, unit: 'BOTTLE', mode });
      f.detectChanges();
      if (mode === 'LINK') {
        http.expectOne((r) => r.url.endsWith('/inventory/items')).flush({ items: [stockItem()] });
        await vi.waitFor(() => {
          f.detectChanges();
          expect(tracking.items.isSuccess()).toBe(true);
        });
        tracking.form.controls.stockItemId.setValue(stockItem().id);
      }
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      let finishRefresh!: () => void;
      changed.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishRefresh = resolve;
          }),
      );
      const submitting = f.componentInstance.submit();
      const menu = http.expectOne((r) => r.method === 'POST');
      // Changes after commit must not be consulted to reconstruct the pending command.
      tracking.form.reset();
      const editorData = TestBed.inject(MAT_DIALOG_DATA);
      editorData.context.outletId = '';
      editorData.context.categoryId = '';
      f.detectChanges();
      expect(invalidate).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
      menu.flush({ data: saved });
      await vi.waitFor(() => expect(tracking.pending()).toBe(true));
      const put = http.expectOne((r) => r.method === 'PUT');
      expect(put.request.url).toContain(
        `/outlets/${saved.outletId}/inventory/menu-items/${saved.id}/tracking`,
      );
      expect(put.request.body).toMatchObject({
        categoryId: saved.categoryId,
        mode,
        ...(mode === 'CREATE' ? { unit: 'BOTTLE' } : { stockItemId: stockItem().id }),
        expectedVersion: 0,
      });
      expect(invalidate).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
      put.flush({
        data: { menuItemId: saved.id, version: 1, stockItem: stockItem({ balanceMilli: 0 }) },
      });
      await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
      expect(close).not.toHaveBeenCalled();
      finishRefresh();
      await submitting;
      expect(close).toHaveBeenCalledWith(saved);
    },
  );
  it('recaptures edited tracking choices when Menu persistence itself is rejected', async () => {
    const f = await setup();
    const tracking = f.componentInstance.tracking()!;
    tracking.form.patchValue({ enabled: true, unit: 'BOTTLE' });
    const first = f.componentInstance.submit();
    http
      .expectOne((r) => r.method === 'POST')
      .flush({}, { status: 400, statusText: 'Invalid metadata' });
    await first;
    expect(f.componentInstance.savedItemId()).toBeNull();
    tracking.form.controls.unit.setValue('CAN');
    const retry = f.componentInstance.submit();
    http.expectOne((r) => r.method === 'POST').flush({ data: saved });
    await vi.waitFor(() => expect(tracking.pending()).toBe(true));
    const put = http.expectOne((r) => r.method === 'PUT');
    expect(put.request.body.unit).toBe('CAN');
    put.flush({
      data: {
        menuItemId: saved.id,
        version: 1,
        stockItem: stockItem({ unit: 'CAN', balanceMilli: 0 }),
      },
    });
    await retry;
    expect(close).toHaveBeenCalledWith(saved);
  });
  it('allows a corrected tracking proposal after a definitive rejection while retaining the saved MenuItem', async () => {
    const f = await setup();
    const tracking = f.componentInstance.tracking()!;
    tracking.form.patchValue({ enabled: true, unit: 'BOTTLE' });
    const first = f.componentInstance.submit();
    http.expectOne((r) => r.method === 'POST').flush({ data: saved });
    await vi.waitFor(() => expect(tracking.pending()).toBe(true));
    const rejected = http.expectOne((r) => r.method === 'PUT');
    const requestId = rejected.request.body.clientRequestId;
    rejected.flush({}, { status: 400, statusText: 'Configuration rejected' });
    await first;
    expect(tracking.uncertain()).toBe(false);
    tracking.form.controls.unit.setValue('CAN');
    const retry = f.componentInstance.submit();
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith(saved.id)).flush({ data: saved });
    await vi.waitFor(() => expect(tracking.pending()).toBe(true));
    const corrected = http.expectOne((r) => r.method === 'PUT');
    expect(corrected.request.body.unit).toBe('CAN');
    expect(corrected.request.body.clientRequestId).not.toBe(requestId);
    corrected.flush({
      data: {
        menuItemId: saved.id,
        version: 1,
        stockItem: stockItem({ unit: 'CAN', balanceMilli: 0 }),
      },
    });
    await retry;
    http.expectNone((r) => r.method === 'POST' || r.method === 'PATCH');
    expect(close).toHaveBeenCalledWith(saved);
  });
});
