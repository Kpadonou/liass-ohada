import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  provideHttpClient,
  withInterceptors,
  HttpInterceptorFn,
  HttpErrorResponse,
} from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { throwError } from 'rxjs';
import { AuthStore } from '../../identity/data-access/auth.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { NotificationService } from '../../../core/notifications/notification.service';
import { RestaurantOutletContext } from '../data-access/restaurant-outlet-context';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import {
  RestaurantInventoryQueries,
  inventoryKeys,
} from '../data-access/restaurant-inventory.queries';
import { RestaurantsQueries, restaurantKeys } from '../data-access/restaurants.queries';
import { inventoryContext as ctx, stockItem } from '../data-access/inventory.test-fixture';
import { row, rid } from '../data-access/restaurants.test-fixture';
import { RestaurantStockItemDialog } from './restaurant-stock-item.dialog';
import { RestaurantEditorComponent } from './restaurant-editor.component';
import { RestaurantPendingCreationComponent } from '../ui/restaurant-pending-creation.component';
import fr from '../../../../../public/assets/i18n/fr.json';

let client: QueryClient, http: HttpTestingController;
let data: unknown, calls: string[];
const org = signal(ctx.org),
  user = signal(ctx.user),
  revision = signal(ctx.revision),
  outlet = signal(ctx.outlet),
  identity = signal(ctx.identity);
const close = vi.fn(),
  open = vi.fn();
const notification = { success: vi.fn(), error: vi.fn() };
let rejectBeforeDispatch = false;
const pages = (items: unknown[]) => ({ pages: [{ items }], pageParams: [undefined] });
beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  rejectBeforeDispatch = false;
  org.set(ctx.org);
  user.set(ctx.user);
  revision.set(ctx.revision);
  outlet.set(ctx.outlet);
  identity.set(ctx.identity);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  data = { ctx, item: stockItem() };
  const count: HttpInterceptorFn = (request, next) => {
    calls.push(request.method);
    return rejectBeforeDispatch
      ? throwError(() => new HttpErrorResponse({ status: 400 }))
      : next(request);
  };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: { fr },
        preloadLangs: true,
        translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
      }),
    ],
    providers: [
      provideHttpClient(withInterceptors([count])),
      provideHttpClientTesting(),
      { provide: QueryClient, useValue: client },
      { provide: MAT_DIALOG_DATA, useFactory: () => data },
      { provide: MatDialogRef, useValue: { close, disableClose: false } },
      { provide: MatDialog, useValue: { open } },
      {
        provide: AuthStore,
        useValue: { effectiveOrgId: org, currentUserId: user, contextRevision: revision },
      },
      { provide: RestaurantOutletContext, useValue: { id: outlet, identity } },
      { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
      {
        provide: RestaurantsCapabilities,
        useValue: {
          canManageInventory: () => true,
          canManageMenu: () => true,
          canManageSetup: () => true,
        },
      },
      { provide: NotificationService, useValue: notification },
    ],
  });
  TestBed.overrideProvider(MatDialog, { useValue: { open } });
  http = TestBed.inject(HttpTestingController);
  client.setQueryData(inventoryKeys.item(ctx, stockItem().id), stockItem());
  client.setQueryData(inventoryKeys.items(ctx), pages([stockItem()]));
});
afterEach(() => {
  http.verify();
  client.clear();
  TestBed.resetTestingModule();
});
const cached = () =>
  client.getQueryData<ReturnType<typeof stockItem>>(inventoryKeys.item(ctx, stockItem().id))!;
async function stockDialog(name: string) {
  const fixture = TestBed.createComponent(RestaurantStockItemDialog);
  fixture.detectChanges();
  fixture.componentInstance.form.controls.name.setValue(name);
  const saving = fixture.componentInstance.save();
  return { fixture, saving };
}
it('Save installs the name and closes at Sent, before slow HTTP resolves, then reconciles after destruction without GET', async () => {
  const fixture = TestBed.createComponent(RestaurantStockItemDialog);
  fixture.detectChanges();
  fixture.componentInstance.form.controls.name.setValue('Changed');
  fixture.nativeElement
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const request = http.expectOne((r) => r.method === 'PATCH');
  expect(close).toHaveBeenCalledExactlyOnceWith();
  expect(cached()).toMatchObject({ name: 'Changed', version: 1, balanceMilli: 12000 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(close).toHaveBeenCalledTimes(1);
  fixture.destroy();
  request.flush({ data: stockItem({ name: 'Canonical', version: 2 }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(cached()).toEqual(stockItem({ name: 'Canonical', version: 2 }));
  expect(calls).toEqual(['PATCH']);
  expect(notification.success).not.toHaveBeenCalled();
});
it('post-close rejection rolls back and offers explicit review preserving the name with current canonical metadata', async () => {
  const { fixture, saving } = await stockDialog('Intent');
  fixture.destroy();
  http.expectOne((r) => r.method === 'PATCH').flush({}, { status: 400, statusText: 'Rejected' });
  await saving;
  expect(close).toHaveBeenCalledTimes(1);
  expect(cached()).toEqual(stockItem());
  expect(open).not.toHaveBeenCalled();
  const action = notification.error.mock.calls.at(-1)![1];
  expect(action.label).toBe(fr.RESTAURANTS.UI.REVIEW_EDIT);
  action.run();
  http
    .expectOne((r) => r.method === 'GET')
    .flush({ data: stockItem({ version: 5, isActive: false }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(open).toHaveBeenCalledWith(
    RestaurantStockItemDialog,
    expect.objectContaining({
      data: expect.objectContaining({
        item: expect.objectContaining({ version: 5 }),
        initialValues: expect.objectContaining({ name: 'Intent', isActive: false }),
      }),
    }),
  );
});
it('conflict stays closed, invalidates authoritative scope and retains an explicit review action', async () => {
  const q = TestBed.inject(RestaurantInventoryQueries),
    invalidation = vi.spyOn(client, 'invalidateQueries');
  const { saving } = await stockDialog('Conflicting intent');
  http.expectOne((r) => r.method === 'PATCH').flush({}, { status: 409, statusText: 'Conflict' });
  await saving;
  expect(cached()).toEqual(stockItem());
  expect(close).toHaveBeenCalledTimes(1);
  expect(invalidation).toHaveBeenCalledWith({
    queryKey: inventoryKeys.itemFamily(ctx, stockItem().id),
  });
  expect(notification.error.mock.calls.at(-1)![1].run).toBeTypeOf('function');
  expect(open).not.toHaveBeenCalled();
  expect(q).toBeTruthy();
});
it.each([true, false])(
  'both rapid editors close; older success=%s cannot replace later confirmation',
  async (success) => {
    const a = await stockDialog('B');
    const ar = http.expectOne((r) => r.method === 'PATCH');
    const b = await stockDialog('C');
    const br = http.expectOne((r) => r.method === 'PATCH');
    expect(close).toHaveBeenCalledTimes(2);
    expect(cached().name).toBe('C');
    br.flush({ data: stockItem({ name: 'C canonical', version: 3 }) });
    await b.saving;
    if (success) ar.flush({ data: stockItem({ name: 'B canonical', version: 2 }) });
    else ar.flush({}, { status: 400, statusText: 'Rejected' });
    await a.saving;
    expect(cached()).toEqual(stockItem({ name: 'C canonical', version: 3 }));
  },
);
it.each(['org', 'user', 'revision', 'outlet', 'identity'])(
  'detached completion remains fenced after %s switch',
  async (field) => {
    const { fixture, saving } = await stockDialog('Old');
    fixture.destroy();
    const request = http.expectOne((r) => r.method === 'PATCH');
    if (field === 'org') org.set('other');
    if (field === 'user') user.set('other');
    if (field === 'revision') revision.set(99);
    if (field === 'outlet') outlet.set(rid(99));
    if (field === 'identity') identity.set('other');
    const foreign = { ...ctx, org: 'other', outlet: rid(99) };
    client.setQueryData(
      inventoryKeys.item(foreign, stockItem().id),
      stockItem({ name: 'Foreign' }),
    );
    request.flush({ data: stockItem({ name: 'Old confirmed', version: 2 }) });
    await saving;
    expect(client.getQueryData(inventoryKeys.item(foreign, stockItem().id))).toEqual(
      stockItem({ name: 'Foreign' }),
    );
    expect(open).not.toHaveBeenCalled();
    expect(notification.success).not.toHaveBeenCalled();
  },
);
it('does not close on validation or interceptor failure before Sent', async () => {
  const f = TestBed.createComponent(RestaurantStockItemDialog);
  f.detectChanges();
  f.componentInstance.form.controls.name.setValue('');
  await f.componentInstance.save();
  expect(calls).toEqual([]);
  expect(close).not.toHaveBeenCalled();
  rejectBeforeDispatch = true;
  f.componentInstance.form.controls.name.setValue('Cannot dispatch');
  await f.componentInstance.save();
  expect(close).not.toHaveBeenCalled();
  expect(cached()).toEqual(stockItem());
});
it('keeps lifecycle edits waiting for server confirmation', async () => {
  const f = TestBed.createComponent(RestaurantStockItemDialog);
  f.detectChanges();
  f.componentInstance.form.controls.isActive.setValue(false);
  const saving = f.componentInstance.save();
  const request = http.expectOne((r) => r.method === 'PATCH');
  expect(close).not.toHaveBeenCalled();
  expect(cached().isActive).toBe(true);
  request.flush({ data: stockItem({ isActive: false, version: 2 }) });
  await saving;
  expect(close).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
});
it.each([true, false])(
  'Inventory creation closes at dispatch and a surviving preview resolves success=%s',
  async (success) => {
    data = { ctx };
    const key = TestBed.inject(RestaurantInventoryQueries).pendingCreationKey(ctx);
    const preview = TestBed.createComponent(RestaurantPendingCreationComponent);
    preview.componentRef.setInput('queryKey', key);
    preview.detectChanges();
    const { fixture, saving } = await stockDialog('New bottle');
    const request = http.expectOne((r) => r.method === 'POST');
    expect(close).toHaveBeenCalledExactlyOnceWith();
    fixture.destroy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    preview.detectChanges();
    expect(preview.nativeElement.textContent).toContain('New bottle');
    expect(preview.nativeElement.querySelector('button, a')).toBeNull();
    if (success) request.flush({ data: stockItem({ id: rid(99), name: 'New bottle' }) });
    else request.flush({}, { status: 400, statusText: 'Rejected' });
    await saving;
    await new Promise((resolve) => setTimeout(resolve, 0));
    preview.detectChanges();
    expect(preview.nativeElement.querySelector('[role="status"]')).toBeNull();
    expect(client.getQueryData(inventoryKeys.item(ctx, rid(99))) !== undefined).toBe(success);
  },
);
it.each(['restaurant', 'outlet', 'area', 'table', 'station', 'menu', 'category'] as const)(
  '%s name-only dialog closes before HTTP and reconciles after destruction',
  async (kind) => {
    const entity = row(kind),
      context =
        kind === 'restaurant' || kind === 'outlet'
          ? {}
          : { outletId: ctx.outlet, ...(kind === 'table' ? { areaId: rid(3) } : {}) };
    data = { org: ctx.org, kind, context, entity, currency: 'XOF' };
    const q = TestBed.inject(RestaurantsQueries),
      key =
        kind === 'restaurant' || kind === 'menu'
          ? restaurantKeys.collection(ctx.org, kind, context)
          : restaurantKeys.detail(ctx.org, kind, context, entity.id);
    client.setQueryData(key, entity);
    const f = TestBed.createComponent(RestaurantEditorComponent);
    f.detectChanges();
    f.componentInstance.form.controls.name.setValue('Label');
    const saving = f.componentInstance.submit();
    const request = http.expectOne((r) => r.method === 'PATCH');
    expect(close).toHaveBeenCalledExactlyOnceWith();
    f.destroy();
    request.flush({ data: { ...entity, name: 'Canonical label', version: 2 } });
    await saving;
    expect(client.getQueryData(key)).toEqual({ ...entity, name: 'Canonical label', version: 2 });
    expect(calls).toEqual(['PATCH']);
    expect(notification.success).not.toHaveBeenCalled();
    expect(q).toBeTruthy();
  },
);
it('configuration mixed policy edit and creation retain server-confirmed dialog completion', async () => {
  const entity = row('restaurant');
  data = { org: ctx.org, kind: 'restaurant', context: {}, entity };
  client.setQueryData(restaurantKeys.collection(ctx.org, 'restaurant'), entity);
  const f = TestBed.createComponent(RestaurantEditorComponent);
  f.detectChanges();
  f.componentInstance.form.patchValue({ name: 'Label', policy: 'DIRECT' });
  const saving = f.componentInstance.submit();
  const request = http.expectOne((r) => r.method === 'PATCH');
  expect(close).not.toHaveBeenCalled();
  request.flush({ data: { ...entity, name: 'Label', guestOrderingPolicy: 'DIRECT', version: 2 } });
  await saving;
  expect(close).toHaveBeenCalledWith(expect.objectContaining({ guestOrderingPolicy: 'DIRECT' }));
});
it('configuration rejection after close preserves intent for explicit review without automatically reopening', async () => {
  const entity = row('category'),
    context = { outletId: ctx.outlet };
  data = { org: ctx.org, kind: 'category', context, entity };
  const key = restaurantKeys.detail(ctx.org, 'category', context, entity.id);
  client.setQueryData(key, entity);
  const f = TestBed.createComponent(RestaurantEditorComponent);
  f.detectChanges();
  f.componentInstance.form.controls.name.setValue('Category intent');
  const saving = f.componentInstance.submit();
  f.destroy();
  http.expectOne((r) => r.method === 'PATCH').flush({}, { status: 409, statusText: 'Conflict' });
  await saving;
  expect(close).toHaveBeenCalledExactlyOnceWith();
  expect(open).not.toHaveBeenCalled();
  expect(client.getQueryData(key)).toEqual(entity);
  notification.error.mock.calls.at(-1)![1].run();
  http.expectOne((r) => r.method === 'GET').flush({ data: { ...entity, version: 5 } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(open).toHaveBeenCalledWith(
    RestaurantEditorComponent,
    expect.objectContaining({
      data: expect.objectContaining({
        initialName: 'Category intent',
        entity: expect.objectContaining({ version: 5 }),
      }),
    }),
  );
});
it('configuration creation stays open until its canonical identity is available', async () => {
  data = { org: ctx.org, kind: 'category', context: { outletId: ctx.outlet } };
  const f = TestBed.createComponent(RestaurantEditorComponent);
  f.detectChanges();
  f.componentInstance.form.controls.name.setValue('Category');
  const saving = f.componentInstance.submit();
  const request = http.expectOne((r) => r.method === 'POST');
  expect(close).not.toHaveBeenCalled();
  request.flush({ data: row('category') });
  await saving;
  expect(close).toHaveBeenCalledWith(row('category'));
});
it('MenuItem name-only edit closes after dispatch without retaining/dereferencing its destroyed tracking editor', async () => {
  const entity = row('item'),
    context = { outletId: ctx.outlet, categoryId: rid(6) };
  data = { org: ctx.org, kind: 'item', context, entity, currency: 'XOF' };
  const key = restaurantKeys.detail(ctx.org, 'item', context, entity.id);
  client.setQueryData(key, entity);
  client.setQueryData(
    restaurantKeys.collection(ctx.org, 'station', { outletId: ctx.outlet }),
    pages([row('station')]),
  );
  client.setQueryData(
    restaurantKeys.detail(ctx.org, 'station', { outletId: ctx.outlet }, rid(5)),
    row('station'),
  );
  const configCtx = { ...ctx, identity: `configuration:${ctx.outlet}` };
  client.setQueryData(inventoryKeys.tracking(configCtx, rid(6), entity.id), {
    menuItemId: entity.id,
    version: 0,
    stockItem: null,
  });
  const f = TestBed.createComponent(RestaurantEditorComponent);
  f.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  f.detectChanges();
  f.componentInstance.form.controls.name.setValue('Item label');
  const saving = f.componentInstance.submit();
  const request = http.expectOne((r) => r.method === 'PATCH');
  expect(close).toHaveBeenCalledExactlyOnceWith();
  f.destroy();
  request.flush({ data: { ...entity, name: 'Item canonical', version: 2 } });
  await saving;
  expect(client.getQueryData(key)).toEqual({ ...entity, name: 'Item canonical', version: 2 });
  expect(calls).toEqual(['PATCH']);
});
it('a retained review action becomes inert after an organization switch', async () => {
  const { fixture, saving } = await stockDialog('Intent');
  fixture.destroy();
  http.expectOne((r) => r.method === 'PATCH').flush({}, { status: 400, statusText: 'Rejected' });
  await saving;
  const action = notification.error.mock.calls.at(-1)![1];
  org.set('other');
  action.run();
  http.expectNone((r) => r.method === 'GET');
  expect(open).not.toHaveBeenCalled();
});
it('invalid resource construction cannot close the dialog or dispatch an HTTP request', async () => {
  data = { ctx, item: stockItem({ id: 'invalid-local-id' }) };
  const f = TestBed.createComponent(RestaurantStockItemDialog);
  f.detectChanges();
  f.componentInstance.form.controls.name.setValue('Valid name');
  await f.componentInstance.save();
  expect(close).not.toHaveBeenCalled();
  expect(calls).toEqual([]);
});
it('ambiguous non-idempotent Inventory creation does not offer a blind recreate action', async () => {
  data = { ctx };
  const { saving } = await stockDialog('Uncertain create');
  http.expectOne((r) => r.method === 'POST').error(new ProgressEvent('error'));
  await saving;
  expect(close).toHaveBeenCalledExactlyOnceWith();
  expect(notification.error.mock.calls.at(-1)![1]).toBeUndefined();
});
