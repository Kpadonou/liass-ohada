import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { NotificationService } from '../../../core/notifications/notification.service';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { RestaurantKind } from '../data-access/restaurants-model';
import { context, row } from '../data-access/restaurants.test-fixture';
import { RestaurantEditorComponent, RestaurantEditorData } from './restaurant-editor.component';
import { RestaurantInventoryApi } from '../data-access/restaurant-inventory.api';
const langs = {
  en: {
    RESTAURANTS: {
      UI: {
        NAME: 'Name',
        SAVE: 'Save',
        CONFLICT_REVIEW: 'Review preserved changes',
        RETRY_SAVE: 'Save reviewed changes',
        ERRORS: {
          CONFLICT: 'Changed or duplicate code: review and retry.',
          VALIDATION: 'Check entered values',
          ACCESS: 'Access changed',
        },
      },
    },
  },
};
describe('Restaurant configuration dialogs', () => {
  const api = { save: vi.fn(), get: vi.fn(), list: vi.fn() },
    org = signal('org'),
    user = signal('owner'),
    manage = signal(true);
  const ref = { close: vi.fn() },
    notification = { success: vi.fn() },
    changed = vi.fn().mockResolvedValue(undefined),
    denied = vi.fn().mockResolvedValue(undefined);
  let client: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    org.set('org');
    user.set('owner');
    manage.set(true);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.list.mockResolvedValue({ items: [row('station')] });
    api.get.mockResolvedValue(row('restaurant'));
    api.save.mockResolvedValue({ data: row('restaurant'), message: 'Saved.' });
  });
  afterEach(() => {
    client.clear();
    TestBed.resetTestingModule();
  });
  async function create(data: RestaurantEditorData) {
    TestBed.configureTestingModule({
      imports: [
        RestaurantEditorComponent,
        TranslocoTestingModule.forRoot({
          langs,
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
        }),
      ],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: ref },
        { provide: QueryClient, useValue: client },
        { provide: RestaurantsApi, useValue: api },
        {
          provide: RestaurantInventoryApi,
          useValue: {
            context: (outlet: string) => ({
              org: 'org',
              user: 'owner',
              outlet,
              revision: 1,
              identity: 'configuration',
            }),
            isCurrent: () => true,
            assertCurrent: () => undefined,
            tracking: () => Promise.resolve({ menuItemId: 'item', version: 0, stockItem: null }),
            items: () => Promise.resolve({ items: [] }),
          },
        },
        {
          provide: RestaurantsQueries,
          useValue: {
            scope: org,
            userScope: user,
            changed,
            confirmed: changed,
            denied,
            detail: () => ({
              queryKey: ['station-selected', org()],
              queryFn: () => Promise.resolve(row('station')),
              enabled: false,
            }),
            list: () => ({
              queryKey: ['stations', org()],
              initialPageParam: undefined,
              queryFn: () => api.list(),
              getNextPageParam: () => undefined,
              enabled: manage(),
            }),
          },
        },
        {
          provide: RestaurantsCapabilities,
          useValue: { canManageSetup: manage, canManageMenu: manage },
        },
        { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
        { provide: NotificationService, useValue: notification },
      ],
    });
    await TestBed.compileComponents();
    const f = TestBed.createComponent(RestaurantEditorComponent);
    f.detectChanges();
    if (data.kind === 'item' && data.entity)
      await vi.waitFor(() => {
        f.detectChanges();
        expect(f.componentInstance.tracking()?.query.isSuccess()).toBe(true);
      });
    return f;
  }
  it('retries tracking after a MenuItem save without duplicating Menu creation or metadata updates', async () => {
    const f = await create({ org: 'org', kind: 'item', context, currency: 'XOF' });
    f.componentInstance.form.patchValue({ name: row('item').name, price: '5000', station: null });
    api.save.mockResolvedValue({ data: row('item'), message: 'Saved.' });
    api.get.mockResolvedValue(row('item'));
    const persist = vi
      .spyOn(f.componentInstance.tracking()!, 'persist')
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }))
      .mockResolvedValueOnce(undefined);
    await f.componentInstance.submit();
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(ref.close).not.toHaveBeenCalled();
    await f.componentInstance.submit();
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(ref.close).toHaveBeenCalledWith(row('item'));
  });
  it.each([
    'restaurant',
    'outlet',
    'area',
    'table',
    'station',
    'menu',
    'category',
    'item',
  ] as const)('creates %s using shared contracts and preserved request identity', async (kind) => {
    api.save.mockResolvedValue({ data: row(kind), message: 'Saved.' });
    const f = await create({ org: 'org', kind, context, currency: 'XOF' });
    f.componentInstance.form.patchValue({
      name: row(kind).name,
      code: 't01',
      price: '5 000',
      station: null,
      reorder: true,
      policy: 'STAFF_APPROVAL',
    });
    await f.componentInstance.submit();
    expect(api.save).toHaveBeenCalledWith(
      'org',
      kind,
      context,
      expect.objectContaining({ clientRequestId: expect.any(String), name: row(kind).name }),
      undefined,
    );
    const payload = api.save.mock.calls[0][3];
    expect(payload).not.toHaveProperty('orgId');
    expect(payload).not.toHaveProperty('expectedVersion');
    if (kind === 'table') {
      expect(payload.code).toBe('T01');
      expect(payload).not.toHaveProperty('capacity');
    }
    if (kind === 'menu') expect(payload.currency).toBe('XOF');
    if (kind === 'item') {
      expect(payload.price).toEqual({ amountMinor: 5000, currency: 'XOF' });
      expect(payload.guestReorderEnabled).toBe(true);
      expect(payload).not.toHaveProperty('preparationStationId');
    }
    expect(changed).toHaveBeenCalledWith('org', kind, context, row(kind), true, expect.anything());
    expect(notification.success).toHaveBeenCalledWith('Saved.');
    expect(ref.close).toHaveBeenCalled();
  });
  it.each([
    'restaurant',
    'outlet',
    'area',
    'table',
    'station',
    'menu',
    'category',
    'item',
  ] as const)('edits %s without changing its parent or currency', async (kind) => {
    api.save.mockResolvedValue({ data: row(kind), message: 'Saved.' });
    const entity = row(kind),
      f = await create({ org: 'org', kind, context, entity, currency: 'XOF' });
    f.componentInstance.form.controls.name.setValue('Updated');
    await f.componentInstance.submit();
    const payload = api.save.mock.calls[0][3];
    expect(payload.expectedVersion).toBe(1);
    expect(payload).not.toHaveProperty('clientRequestId');
    expect(payload).not.toHaveProperty('outletId');
    expect(payload).not.toHaveProperty('currency');
    if (kind === 'table') expect(payload.capacity).toBeNull();
    if (kind === 'item')
      expect(payload.preparationStationId).toBe(
        context.outletId === undefined ? null : row('station').id,
      );
  });
  it('uses typed Reactive Forms with Material selects and form-saved checkboxes', async () => {
    const root = await create({
      org: 'org',
      kind: 'restaurant',
      context: {},
      entity: row('restaurant'),
    });
    expect(root.nativeElement.querySelector('mat-select[formControlName="policy"]')).not.toBeNull();
    expect(
      root.nativeElement.querySelector('mat-checkbox[formControlName="active"]'),
    ).not.toBeNull();
    root.destroy();
    TestBed.resetTestingModule();
    const item = await create({ org: 'org', kind: 'item', context, currency: 'XOF' });
    expect(item.nativeElement.querySelector('liass-searchable-select mat-select')).not.toBeNull();
    expect(
      item.nativeElement.querySelector('mat-checkbox[formControlName="reorder"]'),
    ).not.toBeNull();
    item.componentInstance.form.controls.price.setValue('-1');
    expect(item.componentInstance.form.controls.price.invalid).toBe(true);
    item.componentInstance.form.controls.price.markAsTouched();
    item.detectChanges();
    await item.whenStable();
    item.detectChanges();
    const price = item.nativeElement.querySelector('input[formControlName="price"]');
    const error = price.closest('mat-form-field').querySelector('mat-error');
    expect(error).not.toBeNull();
    expect(price.getAttribute('aria-describedby')).toContain(error.id);
  });

  it('keeps create table input usable after a duplicate code error and retries the same intent', async () => {
    const f = await create({ org: 'org', kind: 'table', context });
    f.componentInstance.form.patchValue({ name: 'Terrace 1', code: 'T01' });
    api.save.mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }));
    await f.componentInstance.submit();
    expect(ref.close).not.toHaveBeenCalled();
    expect(f.componentInstance.form.controls.code.value).toBe('T01');
    const id = api.save.mock.calls[0][3].clientRequestId;
    f.componentInstance.form.controls.code.setValue('T02');
    api.save.mockResolvedValueOnce({ data: row('table'), message: null });
    await f.componentInstance.submit();
    expect(api.save.mock.calls[1][3].clientRequestId).toBe(id);
    expect(ref.close).toHaveBeenCalled();
  });
  it('preserves edit input, refreshes authoritative version and requires explicit reviewed retry', async () => {
    const f = await create({
      org: 'org',
      kind: 'restaurant',
      context: {},
      entity: row('restaurant'),
    });
    f.componentInstance.form.patchValue({ name: 'New name', policy: 'DIRECT' });
    api.save.mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }));
    api.get.mockResolvedValueOnce({ ...row('restaurant'), version: 5 });
    await f.componentInstance.submit();
    expect(ref.close).not.toHaveBeenCalled();
    expect(f.componentInstance.form.controls.name.value).toBe('New name');
    expect(f.componentInstance.conflict()).toBe(true);
    expect(f.componentInstance.version()).toBe(5);
    expect(api.save).toHaveBeenCalledTimes(1);
    await f.componentInstance.submit();
    expect(api.save.mock.calls[1][3]).toMatchObject({
      expectedVersion: 5,
      name: 'New name',
      guestOrderingPolicy: 'DIRECT',
    });
  });
  it('rejects invalid price/capacity inline without persistence', async () => {
    const f = await create({ org: 'org', kind: 'item', context, currency: 'XOF' });
    f.componentInstance.form.patchValue({ name: 'Beer', price: '1.5' });
    await f.componentInstance.submit();
    expect(f.componentInstance.form.controls.price.invalid).toBe(true);
    expect(api.save).not.toHaveBeenCalled();
  });
  it('suppresses submission for read-only roles and closes on workspace change', async () => {
    const f = await create({ org: 'org', kind: 'outlet', context: {} });
    manage.set(false);
    f.componentInstance.form.controls.name.setValue('Agla');
    await f.componentInstance.submit();
    expect(api.save).not.toHaveBeenCalled();
    org.set('other');
    f.detectChanges();
    expect(ref.close).toHaveBeenCalled();
  });
  it('blocks further management after permission loss while preserving the form', async () => {
    const f = await create({ org: 'org', kind: 'outlet', context: {}, entity: row('outlet') });
    api.save.mockRejectedValueOnce(new HttpErrorResponse({ status: 403 }));
    await f.componentInstance.submit();
    expect(f.componentInstance.canManage()).toBe(false);
    expect(denied).toHaveBeenCalledWith('org');
    expect(ref.close).not.toHaveBeenCalled();
  });
  it('rejects an intent prepared by another account in the same organization', async () => {
    const f = await create({ org: 'org', kind: 'restaurant', context: {} });
    f.componentInstance.form.controls.name.setValue('Prepared by owner');
    user.set('chrys');
    // Submission is denied even before the closing effect runs.
    await f.componentInstance.submit();
    expect(api.save).not.toHaveBeenCalled();
    f.detectChanges();
    expect(ref.close).toHaveBeenCalled();
  });
  it.each(['DISABLED', 'DIRECT', 'STAFF_APPROVAL'] as const)(
    'displays and saves existing %s through the restaurant settings path',
    async (policy) => {
      const f = await create({
        org: 'org',
        kind: 'restaurant',
        context: {},
        entity: { ...row('restaurant'), guestOrderingPolicy: policy },
      });
      expect(f.componentInstance.form.controls.policy.value).toBe(policy);
      await f.componentInstance.submit();
      expect(api.save.mock.calls[0][3]).toMatchObject({ guestOrderingPolicy: policy });
    },
  );
  it('recommends DIRECT for an intentional new configuration without changing existing DISABLED', async () => {
    const f = await create({ org: 'org', kind: 'restaurant', context: {} });
    expect(f.componentInstance.form.controls.policy.value).toBe('DIRECT');
  });
});
