import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, BehaviorSubject } from 'rxjs';
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
    UX: {
      CONFIGURATION: 'Configuration',
      PAGES: {
        overview: {
          TITLE: 'Dashboard',
          DESCRIPTION: 'Review your restaurant configuration and menu.',
        },
        restaurant: {
          TITLE: 'Restaurant configuration',
          DESCRIPTION: 'Manage your restaurant identity and guest ordering preference.',
        },
        outlet: {
          TITLE: 'Locations',
          DESCRIPTION: 'Manage the locations that welcome your guests.',
        },
        area: {
          TITLE: 'Dining areas',
          DESCRIPTION: 'Organize the dining areas of the selected location.',
        },
        table: {
          TITLE: 'Tables',
          DESCRIPTION: 'Manage table codes, capacity and QR identities in each dining area.',
        },
        station: {
          TITLE: 'Kitchen & bar stations',
          DESCRIPTION: 'Configure the preparation stations of the selected location.',
        },
        menu: {
          TITLE: 'Menu',
          DESCRIPTION: 'Organize categories and items for the selected location.',
        },
      },
      ADD: {
        outlet: 'Add location',
        area: 'Add dining area',
        table: 'Add table',
        station: 'Add station',
        item: 'Add item',
      },
      NAV: {
        restaurant: 'Restaurant',
        outlet: 'Locations',
        area: 'Dining areas',
        table: 'Tables',
        station: 'Preparation stations',
        menu: 'Menu',
        MENU_SECTION: 'Menu',
      },
      EMPTY: {
        outlet: {
          TITLE: 'No locations yet',
          DESCRIPTION:
            'Add your first location to start configuring its dining areas, tables, and preparation stations.',
        },
        area: {
          TITLE: 'No dining areas yet',
          DESCRIPTION: 'Add the first dining area to this location to organize its tables.',
        },
        table: {
          TITLE: 'No tables yet',
          DESCRIPTION: 'Add the first tables to this dining area and set their capacity.',
        },
        station: {
          TITLE: 'No preparation stations yet',
          DESCRIPTION: 'Add the first station to organize preparation at this location.',
        },
        category: {
          TITLE: 'No categories yet',
          DESCRIPTION: 'Add the first category to organize your menu items.',
        },
        item: {
          TITLE: 'No items yet',
          DESCRIPTION: 'Add the first item to this category to complete your menu.',
        },
      },
    },
    ACCESS: { DENIED: 'Access unavailable', CHECKING: 'Checking product access' },
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
      ERRORS: {
        ACCESS: 'Restaurant permissions required',
        NETWORK: 'Check your connection',
        CONFLICT: 'Refresh and review changes',
      },
    },
  },
};
describe('Liass-Resto frontend setup/menu surfaces', () => {
  const scope = signal('org'),
    manage = signal(true),
    access = signal('AVAILABLE'),
    read = signal(true);
  const api = { get: vi.fn(), list: vi.fn(), deactivate: vi.fn(), availability: vi.fn() };
  const dialog = { open: vi.fn() };
  let client: QueryClient;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  beforeEach(() => {
    vi.clearAllMocks();
    params = new BehaviorSubject(convertToParamMap({}));
    scope.set('org');
    manage.set(true);
    access.set('AVAILABLE');
    read.set(true);
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
  async function create(mode = 'setup', restaurantSection = 'restaurant') {
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
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { data: { restaurantPage: mode, restaurantSection } },
            queryParamMap: params.asObservable(),
          },
        },
        { provide: QueryClient, useValue: client },
        { provide: AuthStore, useValue: { effectiveOrgId: scope } },
        { provide: ProductAccessState, useValue: { availability: access } },
        {
          provide: RestaurantsCapabilities,
          useValue: {
            canRead: read,
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
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
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
    expect(f.nativeElement.querySelector('a')?.getAttribute('href')).toBe(
      '/restaurants/setup/locations',
    );
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
    expect(
      Array.from(f.nativeElement.querySelectorAll('h2')).some(
        (node) => (node as HTMLElement).textContent?.trim() === 'Drinks',
      ),
    ).toBe(true);
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
    expect(f.nativeElement.querySelector('[data-testid="collection-empty-state"]')).toBeNull();
    expect(
      f.nativeElement.querySelector('liass-page-header [data-testid="page-actions"]'),
    ).toBeNull();
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
  it('keeps ACTIVE product availability separate from missing read permissions', async () => {
    const f = await create('overview');
    read.set(false);
    f.detectChanges();
    expect(f.componentInstance.availability()).toBe('AVAILABLE');
    expect(f.nativeElement.textContent).toContain('Restaurant permissions required');
    expect(f.nativeElement.textContent).not.toContain('Access unavailable');
    api.get.mockClear();
    await f.componentInstance.refresh();
    expect(api.get).not.toHaveBeenCalled();
    read.set(true);
    f.detectChanges();
    expect(f.nativeElement.textContent).not.toContain('Restaurant permissions required');
  });
  it('shows loading rather than denial and reacts to restored product access', async () => {
    const f = await create('overview');
    access.set('UNKNOWN');
    f.detectChanges();
    expect(f.nativeElement.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(f.nativeElement.textContent).not.toContain('Access unavailable');
    access.set('UNAVAILABLE');
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Access unavailable');
    access.set('AVAILABLE');
    f.detectChanges();
    expect(f.nativeElement.textContent).not.toContain('Access unavailable');
  });
  it.each(['restaurant', 'outlet', 'area', 'table', 'station'] as const)(
    'opens the %s deep link without local navigation tabs',
    async (kind) => {
      const f = await create('setup', kind);
      expect(f.componentInstance.section()).toBe(kind);
      expect(f.nativeElement.querySelector('[role="tablist"]')).toBeNull();
      expect(f.nativeElement.querySelector('liass-page-header')).not.toBeNull();
      if (kind !== 'restaurant')
        await vi.waitFor(() => {
          f.detectChanges();
          expect(f.componentInstance.rows()).toHaveLength(1);
        });
      scope.set('org-new');
      f.detectChanges();
      expect(f.componentInstance.section()).toBe(kind);
    },
  );
  it.each(['outlet', 'area', 'table', 'station', 'item'] as const)(
    'places the only primary %s create action in its empty state',
    async (kind) => {
      api.list.mockImplementation(async (_org: string, requested: RestaurantKind) => ({
        items: requested === kind ? [] : [row(requested)],
      }));
      const f = await create(kind === 'item' ? 'menu' : 'setup', kind);
      await vi.waitFor(() => {
        f.detectChanges();
        expect(
          f.nativeElement.querySelector('[data-testid="collection-empty-state"]'),
        ).not.toBeNull();
      });
      const empty = f.nativeElement.querySelector('[data-testid="collection-empty-state"]');
      expect(empty.querySelector('h2').textContent.trim()).toBe(
        translations.RESTAURANTS.UX.EMPTY[kind].TITLE,
      );
      expect(empty.textContent).toContain(translations.RESTAURANTS.UX.EMPTY[kind].DESCRIPTION);
      expect(
        f.nativeElement.querySelector('liass-page-header [data-testid="page-actions"]'),
      ).toBeNull();
      expect(f.nativeElement.querySelector('[role="tablist"]')).toBeNull();
      if (kind === 'outlet')
        expect(
          Array.from(f.nativeElement.querySelectorAll('h1,h2')).map((node) =>
            (node as HTMLElement).textContent?.trim(),
          ),
        ).toEqual(['Locations', 'No locations yet']);
      empty.querySelector('liass-button button').click();
      expect(dialog.open).toHaveBeenCalledWith(
        RestaurantEditorComponent,
        expect.objectContaining({ data: expect.objectContaining({ kind }) }),
      );
      manage.set(false);
      f.detectChanges();
      expect(empty.querySelector('liass-button')).toBeNull();
    },
  );

  it('keeps Add location in the header for populated collections without a duplicate collection heading', async () => {
    const f = await create('setup', 'outlet');
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.rows()).toHaveLength(1);
    });
    expect(f.nativeElement.querySelector('[data-testid="collection-empty-state"]')).toBeNull();
    expect(f.nativeElement.querySelectorAll('h1')).toHaveLength(1);
    expect(f.nativeElement.querySelectorAll('h2')).toHaveLength(0);
    const button = f.nativeElement.querySelector(
      'liass-page-header [data-testid="page-actions"] button',
    );
    expect(button.textContent).toContain('Add location');
    button.click();
    expect(dialog.open).toHaveBeenCalledWith(
      RestaurantEditorComponent,
      expect.objectContaining({ data: expect.objectContaining({ kind: 'outlet' }) }),
    );
  });

  it('uses one category empty-state action and preserves meaningful selected category headings', async () => {
    api.list.mockImplementation(async (_org: string, kind: RestaurantKind) => ({
      items: kind === 'category' ? [] : [row(kind)],
    }));
    const f = await create('menu');
    await vi.waitFor(() => {
      f.detectChanges();
      expect(
        f.nativeElement.querySelector('[data-testid="category-empty-state"] liass-button'),
      ).not.toBeNull();
    });
    const empty = f.nativeElement.querySelector('[data-testid="category-empty-state"]');
    expect(empty.textContent).toContain('No categories yet');
    expect(
      f.nativeElement.querySelector('liass-page-header [data-testid="page-actions"]'),
    ).toBeNull();
    empty.querySelector('button').click();
    expect(dialog.open).toHaveBeenCalledWith(
      RestaurantEditorComponent,
      expect.objectContaining({ data: expect.objectContaining({ kind: 'category' }) }),
    );
  });
  it('uses canonical dashboard shortcuts and preserves bounded counts without a test heading', async () => {
    const f = await create('overview');
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.stations.isSuccess()).toBe(true);
    });
    const links = [...f.nativeElement.querySelectorAll('a')] as HTMLAnchorElement[];
    expect(links.map((link) => link.getAttribute('href')?.split('?')[0])).toEqual(
      expect.arrayContaining([
        '/restaurants/setup',
        '/restaurants/setup/locations',
        '/restaurants/setup/areas',
        '/restaurants/setup/stations',
        '/restaurants/menu',
      ]),
    );
    expect(f.nativeElement.querySelector('liass-page-header').textContent).toContain('Dashboard');
    expect(f.nativeElement.textContent).not.toContain('RESTAURANTS.UI.SITE_COUNTS');
    expect(f.nativeElement.textContent).not.toContain('Configuration de test');
    expect(f.nativeElement.textContent).not.toContain('Vue d’ensemble');
    for (const kind of ['outlet', 'area', 'station']) {
      const link = f.nativeElement.querySelector(
        'a[aria-label="' +
          translations.RESTAURANTS.UX.NAV[kind as 'outlet' | 'area' | 'station'] +
          '"]',
      );
      expect(link.querySelector('p').textContent.trim()).toBe('1');
      expect(link.querySelector('mat-icon').getAttribute('aria-hidden')).toBe('true');
    }
  });
  it('inherits outlet/area context from a deep link and follows back/forward parameter changes', async () => {
    params.next(convertToParamMap({ outlet: rid(2), area: rid(3) }));
    const f = await create('setup', 'table');
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.tables.isSuccess()).toBe(true);
    });
    expect(f.componentInstance.outlet()?.name).toBe('Agla');
    expect(f.componentInstance.area()?.name).toBe('Main Room');
    expect(f.nativeElement.querySelector('[data-testid="table-context"]').textContent).toContain(
      'Main Room',
    );
    const router = TestBed.inject(Router);
    Object.defineProperty(router, 'url', { get: () => '/restaurants/setup/tables' });
    f.componentInstance.selectArea(rid(3));
    expect(router.navigateByUrl).toHaveBeenCalledWith(
      '/restaurants/setup/tables?outlet=' + rid(2) + '&area=' + rid(3),
    );
    params.next(convertToParamMap({ outlet: rid(2), area: 'not-a-loaded-area' }));
    f.detectChanges();
    expect(f.componentInstance.area()).toBeUndefined();
    expect(f.componentInstance.contextUnavailable()).toBe(true);
    params.next(convertToParamMap({ outlet: rid(2), area: rid(3) }));
    f.detectChanges();
    expect(f.componentInstance.area()?.name).toBe('Main Room');
  });
  it('does not query a supplied outlet until it belongs to the current loaded organization data', async () => {
    params.next(convertToParamMap({ outlet: 'foreign-outlet' }));
    const f = await create('setup', 'table');
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.locations.isSuccess()).toBe(true);
    });
    expect(f.componentInstance.outlet()).toBeUndefined();
    expect(f.componentInstance.contextUnavailable()).toBe(true);
    expect(api.list.mock.calls.map((call) => call[1])).toEqual(['outlet']);
    expect(f.nativeElement.textContent).toContain('RESTAURANTS.IA.CONTEXT_UNAVAILABLE');
    f.componentInstance.selectOutlet(null);
    f.detectChanges();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.outlet()?.id).toBe(rid(2));
    });
  });
  it('offers outlet child links and area-to-table links even to read-only staff', async () => {
    manage.set(false);
    const f = await create('setup', 'outlet');
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.locations.isSuccess()).toBe(true);
    });
    const destinations = [...f.nativeElement.querySelectorAll('a')].map((link: unknown) =>
      (link as HTMLAnchorElement).getAttribute('href'),
    );
    expect(destinations).toContain('/restaurants/setup/tables?outlet=' + rid(2));
    expect(destinations).toContain('/restaurants/setup/areas?outlet=' + rid(2));
    expect(destinations).toContain('/restaurants/setup/stations?outlet=' + rid(2));
    expect(destinations).toContain('/restaurants/menu?outlet=' + rid(2));
    expect(f.nativeElement.querySelector('button[aria-label="Actions for Agla"]')).toBeNull();
    expect(f.nativeElement.querySelector('[data-testid="restaurant-context"]')).toBeNull();
  });
  it('shows area parent and a scoped Tables destination without aggregate requests', async () => {
    const f = await create('setup', 'area');
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.areas.isSuccess()).toBe(true);
    });
    const destinations = [...f.nativeElement.querySelectorAll('a')].map((link: unknown) =>
      (link as HTMLAnchorElement).getAttribute('href'),
    );
    expect(destinations).toContain(
      '/restaurants/setup/tables?outlet=' + rid(2) + '&area=' + rid(3),
    );
    expect(api.list.mock.calls.map((call) => call[1])).not.toContain('table');
    expect(f.nativeElement.querySelector('[data-testid="restaurant-context"]')?.tagName).toBe(
      'SECTION',
    );
  });
});
