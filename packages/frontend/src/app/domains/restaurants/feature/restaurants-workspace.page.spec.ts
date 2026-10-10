import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthStore } from '../../identity/data-access/auth.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { NotificationService } from '../../../core/notifications/notification.service';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { RestaurantKind } from '../data-access/restaurants-model';
import { context, row, rid } from '../data-access/restaurants.test-fixture';
import { RestaurantsWorkspacePage } from './restaurants-workspace.page';
import { RestaurantEditorComponent } from './restaurant-editor.component';
import { RestaurantQrDialogComponent } from './restaurant-qr-dialog.component';
const translations = {
  RESTAURANTS: {
    ACCESS: { DENIED: 'Access unavailable' },
    UI: {
      WELCOME: 'Welcome',
      EMPTY_RESTAURANT: 'Set up your restaurant',
      START: 'Start setup',
      READ_ONLY: 'Read only',
      LOADING: 'Loading restaurant',
      AVAILABLE: 'Available',
      UNAVAILABLE: 'Unavailable',
      QR_PREPARED: 'QR identity prepared',
      KINDS: {
        restaurant: 'Restaurant',
        outlet: 'Locations',
        area: 'Dining areas',
        table: 'Tables',
        station: 'Kitchen & bar',
        item: 'Items',
      },
      EMPTY: {
        outlet: 'Add your first location',
        area: 'Add your first dining area',
        table: 'Add your tables',
        station: 'Add your kitchen station',
        category: 'Add a category',
        item: 'Add your first item',
      },
      POLICIES: { STAFF_APPROVAL: 'Staff approval' },
      ERRORS: { NETWORK: 'Check your connection', CONFLICT: 'Refresh and review changes' },
    },
  },
};
describe('Liass-Resto frontend setup/menu surfaces', () => {
  const scope = signal('org'),
    manage = signal(true),
    access = signal('AVAILABLE');
  const api = { get: vi.fn(), list: vi.fn(), deactivate: vi.fn(), availability: vi.fn() };
  const dialog = { open: vi.fn() };
  let client: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    scope.set('org');
    manage.set(true);
    access.set('AVAILABLE');
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.get.mockImplementation(async (_org: string, kind: RestaurantKind) => row(kind));
    api.list.mockImplementation(async (_org: string, kind: RestaurantKind) => ({
      items: [row(kind)],
    }));
    api.deactivate.mockResolvedValue({ data: row('outlet'), message: 'Deactivated' });
    api.availability.mockResolvedValue({ data: row('item'), message: 'Saved' });
    dialog.open.mockReturnValue({ afterClosed: () => of(undefined) });
  });
  afterEach(() => {
    client.clear();
    TestBed.resetTestingModule();
  });
  async function create(mode = 'setup') {
    TestBed.configureTestingModule({
      imports: [
        RestaurantsWorkspacePage,
        TranslocoTestingModule.forRoot({
          langs: { en: translations },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
        }),
      ],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { restaurantPage: mode } } } },
        { provide: QueryClient, useValue: client },
        { provide: AuthStore, useValue: { effectiveOrgId: scope } },
        { provide: ProductAccessState, useValue: { availability: access } },
        {
          provide: RestaurantsCapabilities,
          useValue: {
            canRead: () => true,
            canReadMenu: () => true,
            canManageSetup: manage,
            canManageMenu: manage,
          },
        },
        { provide: RestaurantsApi, useValue: api },
        { provide: MatDialog, useValue: dialog },
        { provide: NotificationService, useValue: { success: vi.fn() } },
      ],
    });
    await TestBed.compileComponents();
    const f = TestBed.createComponent(RestaurantsWorkspacePage);
    f.detectChanges();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.root.isSuccess()).toBe(true);
    });
    return f;
  }
  it('renders natural first-time setup and opens Restaurant create dialog', async () => {
    api.get.mockResolvedValue(null);
    const f = await create();
    expect(f.nativeElement.textContent).toContain('Set up your restaurant');
    f.nativeElement.querySelector('button').click();
    expect(dialog.open).toHaveBeenCalledWith(
      RestaurantEditorComponent,
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'restaurant', org: 'org' }),
      }),
    );
  });
  it('renders policy and restaurant, suppressing management for read-only staff', async () => {
    manage.set(false);
    const f = await create();
    expect(f.nativeElement.textContent).toContain('Héritage Bistro');
    expect(f.nativeElement.textContent).toContain('Staff approval');
    expect(f.nativeElement.textContent).toContain('Read only');
    f.componentInstance.open('restaurant', row('restaurant'));
    expect(dialog.open).not.toHaveBeenCalled();
  });
  it.each(['outlet', 'area', 'table', 'station'] as const)(
    'renders %s within its parent and opens its scoped editor',
    async (kind) => {
      const f = await create();
      f.componentInstance.section.set(kind);
      await vi.waitFor(() => {
        f.detectChanges();
        expect(f.componentInstance.rows().length).toBe(1);
      });
      expect(f.nativeElement.textContent).toContain(kind === 'table' ? 'T01' : row(kind).name);
      f.componentInstance.open(kind, row(kind));
      expect(dialog.open).toHaveBeenCalledWith(
        RestaurantEditorComponent,
        expect.objectContaining({ data: expect.objectContaining({ kind, entity: row(kind) }) }),
      );
      expect(f.nativeElement.textContent).not.toContain(rid(1));
      expect(f.nativeElement.textContent).not.toContain('ORG#');
    },
  );
  it('initializes menu naturally when the singleton does not exist', async () => {
    api.get.mockImplementation(async (_org: string, kind: RestaurantKind) =>
      kind === 'menu' ? null : row(kind),
    );
    const f = await create('menu');
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.menu.isSuccess()).toBe(true);
    });
    f.componentInstance.open('menu');
    expect(dialog.open).toHaveBeenCalledWith(
      RestaurantEditorComponent,
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'menu', entity: undefined }),
      }),
    );
  });
  it('shows fixture menu/category/item, exact price, availability and reorder configuration', async () => {
    const f = await create('menu');
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.items.isSuccess()).toBe(true);
    });
    expect(f.nativeElement.textContent).toContain('Agla Menu');
    expect(f.nativeElement.textContent).toContain('Drinks');
    expect(f.nativeElement.textContent).toContain('Beer');
    expect(f.nativeElement.textContent).toContain('1,000 XOF');
    expect(f.componentInstance.reorder(row('item'))).toBe(true);
    await f.componentInstance.toggleAvailability(row('item'));
    expect(api.availability).toHaveBeenCalledWith(
      'org',
      expect.objectContaining({ categoryId: context.categoryId }),
      rid(8),
      1,
      'UNAVAILABLE',
    );
  });
  it('requires confirmation for deactivation, with expectedVersion and original context', async () => {
    const f = await create();
    f.componentInstance.section.set('outlet');
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.rows().length).toBe(1);
    });
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    f.componentInstance.deactivate(row('outlet'), 'outlet');
    await vi.waitFor(() =>
      expect(api.deactivate).toHaveBeenCalledWith('org', 'outlet', {}, rid(2), 1),
    );
  });
  it('allows management QR only and never displays internal IDs', async () => {
    const f = await create();
    f.componentInstance.section.set('table');
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.tables.isSuccess()).toBe(true);
    });
    manage.set(false);
    f.componentInstance.showQr(row('table'));
    expect(dialog.open).not.toHaveBeenCalled();
    manage.set(true);
    f.componentInstance.showQr(row('table'));
    expect(dialog.open).toHaveBeenCalledWith(
      RestaurantQrDialogComponent,
      expect.objectContaining({ data: expect.objectContaining({ name: 'T01' }) }),
    );
  });
  it('keeps network error separate from empty state and hides content after access loss', async () => {
    api.list.mockRejectedValue(new HttpErrorResponse({ status: 403 }));
    const f = await create();
    f.componentInstance.section.set('outlet');
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.locations.isError()).toBe(true);
    });
    expect(f.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(f.nativeElement.textContent).not.toContain('Add your first location');
    access.set('UNAVAILABLE');
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Access unavailable');
    expect(f.nativeElement.textContent).not.toContain('Héritage Bistro');
  });
  it('represents the complete Héritage Bistro configuration without persistence identifiers', async () => {
    const categories = ['Main Dishes', 'Drinks', 'Desserts'].map((name, index) => ({
      ...row('category'),
      id: rid(20 + index),
      name,
    }));
    const fixtures = [
      ['Grilled Chicken', 20, false],
      ['Fried Plantain', 20, false],
      ['Bottled Water', 21, true],
      ['Beer', 21, true],
      ['Chocolate Cake', 22, false],
    ] as const;
    api.list.mockImplementation(
      async (
        _org: string,
        kind: RestaurantKind,
        ctx: { categoryId?: string; areaId?: string },
      ) => ({
        items:
          kind === 'category'
            ? categories
            : kind === 'station'
              ? ['KITCHEN', 'BAR'].map((name) => ({ ...row('station'), name }))
              : kind === 'area'
                ? ['Main Room', 'Terrace'].map((name, index) => ({
                    ...row('area'),
                    id: rid(10 + index),
                    name,
                  }))
                : kind === 'table'
                  ? (ctx.areaId === rid(10) ? ['T01', 'T02'] : ['T03', 'T04']).map((code) => ({
                      ...row('table'),
                      code,
                    }))
                  : kind === 'item'
                    ? fixtures
                        .filter(([, category]) => rid(category) === ctx.categoryId)
                        .map(([name, category, reorder], index) => ({
                          ...row('item'),
                          id: rid(40 + index),
                          name,
                          categoryId: rid(category),
                          guestReorderEnabled: reorder,
                        }))
                    : [row(kind)],
      }),
    );
    const f = await create('menu');
    for (const category of categories) {
      f.componentInstance.categoryId.set(category.id);
      await vi.waitFor(() => {
        f.detectChanges();
        expect(f.componentInstance.items.isSuccess()).toBe(true);
      });
      for (const [name, id, reorder] of fixtures.filter(([, id]) => rid(id) === category.id)) {
        expect(f.nativeElement.textContent).toContain(name);
        expect(
          f.componentInstance.items.data()?.pages[0].items.find((item) => item.name === name)
            ?.guestReorderEnabled,
        ).toBe(reorder);
      }
    }
    expect(f.nativeElement.textContent).toContain('Agla Menu');
    expect(f.nativeElement.textContent).not.toContain(rid(2));
    f.destroy();
    TestBed.resetTestingModule();
    client.clear();
    const setup = await create();
    expect(setup.nativeElement.textContent).toContain('Héritage Bistro');
    setup.componentInstance.section.set('area');
    await vi.waitFor(() => {
      setup.detectChanges();
      expect(setup.componentInstance.areaRows()).toHaveLength(2);
    });
    expect(setup.nativeElement.textContent).toContain('Terrace');
    setup.componentInstance.section.set('table');
    for (const [area, codes] of [
      [10, ['T01', 'T02']],
      [11, ['T03', 'T04']],
    ] as const) {
      setup.componentInstance.areaId.set(rid(area));
      await vi.waitFor(() => {
        setup.detectChanges();
        expect(setup.componentInstance.tables.isSuccess()).toBe(true);
      });
      codes.forEach((code) => expect(setup.nativeElement.textContent).toContain(code));
    }
    setup.componentInstance.section.set('station');
    await vi.waitFor(() => {
      setup.detectChanges();
      expect(setup.componentInstance.stationRows()).toHaveLength(2);
    });
    expect(setup.nativeElement.textContent).toContain('KITCHEN');
    expect(setup.nativeElement.textContent).toContain('BAR');
  });

  it('clears local selections and previous data on workspace changes', async () => {
    const f = await create();
    f.componentInstance.section.set('outlet');
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.outletId()).toBe(rid(2));
    });
    api.get.mockResolvedValue(null);
    scope.set('other');
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.root.isSuccess()).toBe(true);
      expect(f.componentInstance.root.data()).toBeNull();
    });
    expect(f.componentInstance.outletId()).toBeNull();
    expect(f.componentInstance.categoryId()).toBeNull();
    expect(f.nativeElement.textContent).not.toContain('Héritage Bistro');
  });
});
