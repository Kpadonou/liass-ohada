import { RestaurantAccessState } from '../data-access/restaurant-access-state';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { MatSelect } from '@angular/material/select';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import fr from '../../../../../public/assets/i18n/fr.json';
import { AuthStore } from '../../identity/data-access/auth.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { NotificationService } from '../../../core/notifications/notification.service';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { restaurantKeys } from '../data-access/restaurants.queries';
import { rid, row } from '../data-access/restaurants.test-fixture';
import { floorFixture } from '../data-access/service-floor.test-fixture';
import { serviceDuration } from '../utils/service-duration';
import { RestaurantServiceFloorPage } from './restaurant-service-floor.page';
const availability = signal('AVAILABLE');
const org = signal('org'),
  read = signal(true),
  write = signal(true),
  selfService = signal(false),
  user = signal('user');
const api = {
  get: vi.fn(),
  list: vi.fn(),
  serviceFloor: vi.fn(),
  openSession: vi.fn(),
  myOutlets: vi.fn(),
};
let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>, client: QueryClient;
let fixture: ReturnType<typeof TestBed.createComponent<RestaurantServiceFloorPage>>;
beforeEach(() => {
  availability.set('AVAILABLE');
  org.set('org');
  selfService.set(false);
  user.set('user');
  read.set(true);
  write.set(true);
  params = new BehaviorSubject(convertToParamMap({ outlet: rid(2) }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.myOutlets.mockReset().mockResolvedValue({ items: [{ outletId: rid(2), name: 'Agla' }] });
  api.get.mockReset().mockResolvedValue(row('restaurant'));
  api.list.mockReset().mockImplementation(async (_org, kind) => ({
    items:
      kind === 'outlet'
        ? [row('outlet')]
        : [row('area'), { ...row('area'), id: rid(7), name: 'Terrace' }],
  }));
  api.serviceFloor.mockReset().mockResolvedValue(floorFixture());
  api.openSession.mockReset().mockResolvedValue({ data: {}, message: 'Ouverte' });
});
afterEach(() => {
  fixture?.destroy();
  client.clear();
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});
async function create() {
  TestBed.configureTestingModule({
    imports: [
      RestaurantServiceFloorPage,
      TranslocoTestingModule.forRoot({
        langs: { fr },
        translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([]),
      {
        provide: RestaurantAccessState,
        useValue: { refreshing: () => false, refreshFailed: () => false, refresh: vi.fn() },
      },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { queryParamMap: params.value },
          queryParamMap: params.asObservable(),
        },
      },
      { provide: QueryClient, useValue: client },
      { provide: AuthStore, useValue: { effectiveOrgId: org, currentUserId: user } },
      {
        provide: RestaurantsCapabilities,
        useValue: {
          canReadService: read,
          usesAssignedOutlets: selfService,
          canOpenSession: write,
          canManageSetup: () => write() && !selfService(),
          canManageResponsibility: () => write() && !selfService(),
        },
      },
      { provide: RestaurantsApi, useValue: api },
      { provide: ProductAccessState, useValue: { availability } },
      { provide: NotificationService, useValue: { success: vi.fn() } },
    ],
  });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  fixture = TestBed.createComponent(RestaurantServiceFloorPage);
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(
      !read() ||
        (fixture.componentInstance.root.isSuccess() && !fixture.componentInstance.root.data()) ||
        fixture.componentInstance.locations.isSuccess() ||
        (selfService() &&
          (fixture.componentInstance.myLocations.isSuccess() ||
            fixture.componentInstance.myLocations.isError())),
    ).toBe(true);
  });
  return fixture.componentInstance;
}
async function ready() {
  const page = await create();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.floor.isSuccess()).toBe(true);
  });
  return page;
}
it('renders real summaries, free/occupied cards, optional capacity and no future data', async () => {
  await ready();
  const text = fixture.nativeElement.textContent;
  expect(text).toContain('Service en salle');
  expect(text).toContain('Libre');
  expect(text).toContain('Occupée');
  expect(text).toMatch(/12[\s\u202f\u00a0]500 XOF/);
  expect(fixture.nativeElement.querySelectorAll('[data-state="FREE"]')).toHaveLength(2);
  expect(fixture.nativeElement.querySelectorAll('[data-state="OCCUPIED"]')).toHaveLength(1);
  const absent = fixture.nativeElement.querySelectorAll('[data-state="FREE"]')[1].textContent;
  expect(absent).not.toContain('places');
  for (const forbidden of [
    'private-actor',
    'Client appelle',
    'articles à servir',
    'Voir la commande',
  ])
    expect(text).not.toContain(forbidden);
  expect(fixture.nativeElement.querySelector('[data-state="OCCUPIED"] a')).toBeNull();
});
it('keeps URL outlet/area context and filters the visible table scope', async () => {
  const page = await ready();
  page.selectArea(rid(7));
  fixture.detectChanges();
  expect(page.visibleTables()).toHaveLength(1);
  expect(page.visibleTables()[0].state).toBe('FREE');
  expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(
    [],
    expect.objectContaining({ queryParams: { outlet: rid(2), area: rid(7) } }),
  );
  params.next(convertToParamMap({ outlet: rid(2), area: rid(3) }));
  fixture.detectChanges();
  expect(page.visibleTables()).toHaveLength(2);
});
it('opens directly once, retains the request ID after ambiguous failure, then invalidates exact context', async () => {
  const page = await ready(),
    table = floorFixture().items[0];
  const invalidation = vi.spyOn(client, 'invalidateQueries');
  api.openSession.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
  await page.open(table);
  const first = api.openSession.mock.calls[0][2];
  await page.open(table);
  expect(api.openSession).toHaveBeenNthCalledWith(2, 'org', rid(2), first);
  expect(first).toMatchObject({ tableId: rid(4), areaId: rid(3) });
  expect(first.clientRequestId).toMatch(/^[a-f\d-]{36}$/);
  expect(first).not.toHaveProperty('partySize');
  expect(invalidation).toHaveBeenCalledWith({
    queryKey: restaurantKeys.floor('org', rid(2)),
    exact: true,
  });
  expect(page.busy()).toBeNull();
});
it('prevents duplicate in-flight opens without a confirmation', async () => {
  const page = await ready();
  let resolve!: (value: object) => void;
  api.openSession.mockReturnValue(new Promise((r) => (resolve = r)));
  const pending = page.open(floorFixture().items[0]);
  await page.open(floorFixture().items[0]);
  expect(api.openSession).toHaveBeenCalledTimes(1);
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('Ouverture de la table');
  resolve({ data: {} });
  await pending;
});
it('refreshes immediately after concurrent opening conflict and clears progress', async () => {
  const page = await ready();
  const spy = vi.spyOn(client, 'invalidateQueries');
  api.openSession.mockRejectedValue(new HttpErrorResponse({ status: 409 }));
  await page.open(floorFixture().items[0]);
  expect(spy).toHaveBeenCalledWith({ queryKey: restaurantKeys.floor('org', rid(2)), exact: true });
  expect(page.openingError()).toContain('changé');
  expect(page.busy()).toBeNull();
});
it('refreshes a changing read once without a conflict refetch loop', async () => {
  api.serviceFloor
    .mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }))
    .mockResolvedValue(floorFixture());
  await ready();
  expect(api.serviceFloor).toHaveBeenCalledTimes(2);
});
it('shows hydration/network failures without rendering stale/free cards', async () => {
  api.serviceFloor.mockRejectedValue(new HttpErrorResponse({ status: 503 }));
  const page = await create();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.floor.isError()).toBe(true);
  });
  expect(fixture.nativeElement.querySelector('[data-state]')).toBeNull();
  expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
});
it('does not show a definitive empty floor for an incomplete page', async () => {
  api.serviceFloor
    .mockResolvedValueOnce({ outletId: rid(2), items: [], nextCursor: 'next' })
    .mockResolvedValueOnce({ ...floorFixture(), nextCursor: 'last' });
  const page = await ready();
  expect(api.serviceFloor).toHaveBeenNthCalledWith(2, 'org', rid(2), 'next');
  expect(page.floor.hasNextPage()).toBe(true);
  expect(fixture.nativeElement.querySelector('[data-testid="floor-summary"]')).toBeNull();
  expect(fixture.nativeElement.textContent).toContain('Charger plus de tables');
});
it('distinguishes completed empty floor and empty selected area', async () => {
  api.serviceFloor.mockResolvedValue({ outletId: rid(2), items: [] });
  const page = await ready();
  expect(fixture.nativeElement.textContent).toContain('Aucune table active');
  page.selectArea(rid(7));
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('dans cet espace');
});
it('shows establishment empty state without issuing a floor request', async () => {
  api.list.mockResolvedValue({ items: [] });
  await create();
  expect(api.serviceFloor).not.toHaveBeenCalled();
  expect(fixture.nativeElement.textContent).toContain('Aucun établissement');
});
it('keeps loading explicit and denies staff even at a direct URL', async () => {
  read.set(false);
  await create();
  expect(api.serviceFloor).not.toHaveBeenCalled();
  expect(fixture.nativeElement.querySelector('[data-state]')).toBeNull();
});
it('hides opening action when capability is absent', async () => {
  write.set(false);
  const page = await ready();
  expect(fixture.nativeElement.querySelector('button[aria-label^="Ouvrir"]')).toBeNull();
  await page.open(floorFixture().items[0]);
  expect(api.openSession).not.toHaveBeenCalled();
});
it('does not leak organization data or opening feedback after a switch', async () => {
  const page = await ready();
  api.list.mockImplementation(async (scope: string) => ({
    items: scope === 'other' ? [] : [row('outlet')],
  }));
  org.set('other');
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.outlets()).toHaveLength(0);
  });
  expect(page.tables()).toHaveLength(0);
  expect(fixture.nativeElement.querySelector('[data-state]')).toBeNull();
});
it('cleans up minute timer and formats minute/hour boundaries locally', async () => {
  const clear = vi.spyOn(globalThis, 'clearInterval');
  await ready();
  const at = '2026-10-14T10:00:00Z',
    now = Date.parse(at);
  expect(serviceDuration(at, now).key).toContain('UNDER_MINUTE');
  expect(serviceDuration(at, now + 8 * 60000).values).toEqual({ minutes: 8 });
  expect(serviceDuration(at, now + 72 * 60000).values).toEqual({ hours: 1, minutes: 12 });
  fixture.destroy();
  expect(clear).toHaveBeenCalled();
});

it('offers root configuration before a restaurant exists without a floor request', async () => {
  api.get.mockResolvedValue(null);
  await create();
  expect(api.serviceFloor).not.toHaveBeenCalled();
  expect(fixture.nativeElement.querySelector('a')?.getAttribute('href')).toBe('/restaurants/setup');
});

it('shows area context only for all areas and groups occupied status with duration', async () => {
  const page = await ready();
  expect(fixture.nativeElement.querySelectorAll('[data-testid="table-area"]')).toHaveLength(3);
  const occupied = fixture.nativeElement.querySelector('[data-state="OCCUPIED"]');
  const status = occupied.querySelector('[data-testid="table-status"]');
  expect(status.textContent).toContain('Occupée');
  page.now.set(Date.parse('2026-10-14T10:26:00Z'));
  fixture.detectChanges();
  expect(status.textContent).toContain('26 min');
  expect(occupied.querySelector('[data-testid="table-amount"]').textContent).toMatch(
    /12[\s\u202f\u00a0]500 XOF/,
  );
  page.selectArea(rid(3));
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelectorAll('[data-testid="table-area"]')).toHaveLength(0);
  expect(page.visibleTables()).toHaveLength(2);
  page.selectArea(null);
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelectorAll('[data-testid="table-area"]')).toHaveLength(3);
});

it('uses matching Material selects and changes area context without refetching the floor', async () => {
  const page = await ready();
  const selects = fixture.debugElement.queryAll(By.directive(MatSelect));
  expect(selects).toHaveLength(2);
  expect(fixture.nativeElement.querySelector('mat-chip-listbox')).toBeNull();
  expect(selects[0].componentInstance.value).toBe(rid(2));
  expect(selects[1].componentInstance.value).toBe('ALL');
  expect(fixture.nativeElement.textContent).toContain('Tous les espaces');
  const calls = api.serviceFloor.mock.calls.length;
  const areaSelect = selects[1].componentInstance as MatSelect;
  areaSelect.open();
  fixture.detectChanges();
  const option = [...document.querySelectorAll('mat-option')].find((o) =>
    o.textContent?.includes('Terrace'),
  ) as HTMLElement;
  expect(option).toBeDefined();
  option.click();
  fixture.detectChanges();
  expect(page.areaId()).toBe(rid(7));
  expect(page.outletId()).toBe(rid(2));
  expect(page.visibleTables()).toHaveLength(1);
  expect(fixture.nativeElement.querySelector('[data-testid="table-area"]')).toBeNull();
  expect(TestBed.inject(Router).navigate).toHaveBeenLastCalledWith(
    [],
    expect.objectContaining({ queryParams: { outlet: rid(2), area: rid(7) } }),
  );
  areaSelect.open();
  fixture.detectChanges();
  const all = [...document.querySelectorAll('mat-option')].find((o) =>
    o.textContent?.includes('Tous les espaces'),
  ) as HTMLElement;
  all.click();
  fixture.detectChanges();
  expect(page.areaId()).toBeNull();
  expect(page.visibleTables()).toHaveLength(3);
  expect(TestBed.inject(Router).navigate).toHaveBeenLastCalledWith(
    [],
    expect.objectContaining({ queryParams: { outlet: rid(2), area: null } }),
  );
  expect(api.serviceFloor).toHaveBeenCalledTimes(calls);
});

it('restores direct URL and history context in the area select independently of establishment', async () => {
  params.next(convertToParamMap({ outlet: rid(2), area: rid(3) }));
  const page = await ready();
  const select = fixture.debugElement.queryAll(By.directive(MatSelect))[1]
    .componentInstance as MatSelect;
  expect(select.value).toBe(rid(3));
  expect(page.visibleTables()).toHaveLength(2);
  const calls = api.serviceFloor.mock.calls.length;
  params.next(convertToParamMap({ outlet: rid(2) }));
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(select.value).toBe('ALL');
  });
  expect(page.outletId()).toBe(rid(2));
  params.next(convertToParamMap({ outlet: rid(2), area: rid(7) }));
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(select.value).toBe(rid(7));
  });
  expect(api.serviceFloor).toHaveBeenCalledTimes(calls);
  page.selectOutlet(rid(2));
  fixture.detectChanges();
  expect(page.areaId()).toBeNull();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(select.value).toBe('ALL');
  });
});

it('places Material context controls after the canonical header with no KPI row', async () => {
  await ready();
  const header = fixture.nativeElement.querySelector('[data-testid="service-page-header"]');
  const context = fixture.nativeElement.querySelector('[data-testid="floor-context"]');
  expect(header.querySelector('header').classList.contains('border-b')).toBe(true);
  expect(header.querySelector('mat-select')).toBeNull();
  expect(context.querySelectorAll('mat-select')).toHaveLength(2);
  expect(header.compareDocumentPosition(context) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(fixture.nativeElement.querySelector('[data-testid="floor-summary"]')).toBeNull();
  expect(fixture.nativeElement.textContent).toContain('Tables en service');
  expect(fixture.nativeElement.textContent).not.toContain('tables au total');
});

it.each([
  [0, 0, true],
  [1, 0, false],
  [undefined, 0, false],
  [1, 12500, false],
  [0, 12500, false],
])(
  'uses canonical order count %s with amount %s for no-order presentation',
  async (orderCount, amount, noOrder) => {
    const data = floorFixture();
    const occupied = data.items[1];
    if (occupied.state !== 'OCCUPIED') throw new Error('Fixture must be occupied');
    occupied.currentAmountMinor = amount as number;
    if (orderCount !== undefined) occupied.orderCount = orderCount as number;
    api.serviceFloor.mockResolvedValue(data);
    await ready();
    const card = fixture.nativeElement.querySelector('[data-state="OCCUPIED"]');
    expect(!!card.querySelector('[data-testid="table-no-order"]')).toBe(noOrder);
    expect(!!card.querySelector('[data-testid="table-amount"]')).toBe(!noOrder);
    if (noOrder) expect(card.textContent).toContain('Aucune commande');
    else expect(card.textContent).toContain('XOF');
  },
);

it('shows canonical responsibility only on occupied cards and never uses the opener as the server', async () => {
  const data = floorFixture();
  const table = data.items[1];
  if (table.state !== 'OCCUPIED') throw new Error('Fixture');
  table.responsibleStaff = {
    staffId: 'private-member',
    displayName: 'Aïssatou S.',
    available: false,
  };
  api.serviceFloor.mockResolvedValue(data);
  await ready();
  const occupied = fixture.nativeElement.querySelector('[data-state="OCCUPIED"]');
  expect(occupied.querySelector('[data-testid="table-responsible"]').textContent).toContain(
    'Aïssatou S.',
  );
  expect(occupied.textContent).toContain('Indisponible');
  expect(
    occupied.querySelector('[data-testid="table-responsible"]').getAttribute('aria-label'),
  ).toContain('Responsable de la table : Aïssatou S.');
  expect(fixture.nativeElement.textContent).not.toMatch(/private-actor|private-member/);
  for (const free of fixture.nativeElement.querySelectorAll('[data-state="FREE"]')) {
    expect(free.querySelector('[data-testid="table-responsible"]')).toBeNull();
    expect(free.querySelector('[aria-label^="Actions de la table"]')).toBeNull();
  }
  expect(occupied.querySelector('a')).toBeNull();
});
it('offers assign for unassigned occupied cards and change/clear for assigned cards', async () => {
  await ready();
  let trigger = fixture.nativeElement.querySelector(
    'button[aria-label="Actions de la table T02"]',
  ) as HTMLButtonElement;
  trigger.click();
  fixture.detectChanges();
  expect(document.querySelector('.cdk-overlay-container')?.textContent).toContain(
    'Affecter un responsable',
  );
  expect(
    fixture.nativeElement.querySelector('[data-testid="table-responsible"]').textContent,
  ).toContain('Responsable non affecté');
});
it('keeps responsibility visible but management absent when write permission is unavailable', async () => {
  write.set(false);
  await ready();
  expect(fixture.nativeElement.querySelector('[data-testid="table-responsible"]')).not.toBeNull();
  expect(fixture.nativeElement.querySelector('[aria-label^="Actions de la table"]')).toBeNull();
});

it('exposes change/clear in the occupied card menu and restores focus after the dialog', async () => {
  const data = floorFixture(),
    table = data.items[1];
  if (table.state !== 'OCCUPIED') throw new Error('Occupied fixture');
  table.responsibleStaff = { staffId: 'member', displayName: 'Aïssatou S.', available: true };
  api.serviceFloor.mockResolvedValue(data);
  const page = await ready();
  const trigger = fixture.nativeElement.querySelector(
    'button[aria-label="Actions de la table T02"]',
  ) as HTMLButtonElement;
  trigger.click();
  fixture.detectChanges();
  const menu = document.querySelector('.cdk-overlay-container');
  expect(menu?.textContent).toContain('Changer le responsable');
  expect(menu?.textContent).toContain('Retirer l’affectation');
  const focus = vi.spyOn(trigger, 'focus');
  const open = vi
    .spyOn(TestBed.inject(MatDialog), 'open')
    .mockReturnValue({ afterClosed: () => of(true) } as unknown as ReturnType<MatDialog['open']>);
  page.manageResponsibility(table, true, trigger);
  expect(open).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      restoreFocus: false,
      data: expect.objectContaining({ clear: true, outletId: rid(2), org: 'org' }),
    }),
  );
  expect(focus).toHaveBeenCalledOnce();
});

async function waiter() {
  selfService.set(true);
  return create();
}
it('auto-selects one complete assigned outlet, reads no generic restaurant/outlet directory and hides administration', async () => {
  params.next(convertToParamMap({}));
  const page = await waiter();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.floor.isSuccess()).toBe(true);
  });
  expect(page.outletId()).toBe(rid(2));
  expect(api.myOutlets).toHaveBeenCalledWith('org', 'user', undefined);
  expect(api.get).not.toHaveBeenCalled();
  expect(
    api.list.mock.calls.every((call) => call[1] === 'area' && call[2].outletId === rid(2)),
  ).toBe(true);
  expect(fixture.nativeElement.querySelector('[data-testid="floor-grid"]')).not.toBeNull();
  expect(
    fixture.nativeElement.querySelector('button[aria-label="Ouvrir la table T01"]'),
  ).not.toBeNull();
  expect(
    fixture.nativeElement.querySelector('button[aria-label^="Actions de la table"]'),
  ).toBeNull();
});
it('waits for explicit choice with multiple outlets and switches only among self-context results', async () => {
  params.next(convertToParamMap({}));
  api.myOutlets.mockResolvedValue({
    items: [
      { outletId: rid(2), name: 'Agla' },
      { outletId: rid(8), name: 'Fidjrossè' },
    ],
  });
  const page = await waiter();
  expect(page.outletId()).toBeNull();
  expect(api.serviceFloor).not.toHaveBeenCalled();
  page.selectOutlet(rid(99));
  expect(page.outletId()).toBeNull();
  page.selectOutlet(rid(8));
  await vi.waitFor(() => expect(api.serviceFloor).toHaveBeenCalledWith('org', rid(8), undefined));
});
it('shows a dedicated no-assignment state without management CTAs', async () => {
  api.myOutlets.mockResolvedValue({ items: [] });
  const page = await waiter();
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain(
    'Aucun établissement ne vous est encore affecté',
  );
  expect(fixture.nativeElement.querySelector('a[href*="setup"]')).toBeNull();
  expect(api.serviceFloor).not.toHaveBeenCalled();
  expect(page.outlet()).toBeUndefined();
});
it('does not auto-select a partial singleton and resolves an unknown deep link only after explicit load-more', async () => {
  params.next(convertToParamMap({ outlet: rid(8) }));
  api.myOutlets.mockImplementation(async (_org, _user, cursor) =>
    cursor
      ? { items: [{ outletId: rid(8), name: 'Fidjrossè' }] }
      : { items: [{ outletId: rid(2), name: 'Agla' }], nextCursor: 'opaque' },
  );
  const page = await waiter();
  fixture.detectChanges();
  expect(api.serviceFloor).not.toHaveBeenCalled();
  expect(fixture.nativeElement.textContent).not.toContain(rid(8));
  expect(page.outletId()).toBe(rid(8));
  expect(page.myLocations.hasNextPage()).toBe(true);
  await page.myLocations.fetchNextPage();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(api.serviceFloor).toHaveBeenCalledWith('org', rid(8), undefined);
  });
  expect(api.myOutlets).toHaveBeenCalledTimes(2);
});
it('requires choice for one loaded outlet while further assignments remain', async () => {
  params.next(convertToParamMap({}));
  api.myOutlets.mockResolvedValue({
    items: [{ outletId: rid(2), name: 'Agla' }],
    nextCursor: 'more',
  });
  const page = await waiter();
  expect(page.outletId()).toBeNull();
  expect(api.serviceFloor).not.toHaveBeenCalled();
});
it('rejects an unassigned complete deep link without disclosing or reading the requested outlet', async () => {
  params.next(convertToParamMap({ outlet: rid(99) }));
  const page = await waiter();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.outletId()).toBeNull();
  });
  expect(page.contextError()).toBe(true);
  expect(api.serviceFloor).not.toHaveBeenCalled();
  expect(api.get).not.toHaveBeenCalled();
  expect(api.list).not.toHaveBeenCalled();
  expect(fixture.nativeElement.textContent).not.toContain(rid(99));
});
it.each([
  new HttpErrorResponse({ status: 0 }),
  new HttpErrorResponse({ status: 403 }),
  new Error('Invalid response'),
])('does not confuse self-context failure with zero assignments: %s', async (error) => {
  api.myOutlets.mockRejectedValue(error);
  const page = await waiter();
  fixture.detectChanges();
  expect(page.myLocations.isError()).toBe(true);
  expect(fixture.nativeElement.textContent).not.toContain(
    'Aucun établissement ne vous est encore affecté',
  );
  expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
  expect(api.serviceFloor).not.toHaveBeenCalled();
});
it('waiter opening refreshes canonical responsibility with no dialog or second assignment call', async () => {
  const page = await waiter();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.floor.isSuccess()).toBe(true);
  });
  const table = page.tables()[0];
  api.openSession.mockImplementation(async () => {
    const old = floorFixture();
    const occupied = old.items[1];
    if (occupied.state !== 'OCCUPIED') throw Error('fixture');
    api.serviceFloor.mockResolvedValue({
      ...old,
      items: [
        {
          ...occupied,
          tableId: table.tableId,
          code: table.code,
          responsibleStaff: { staffId: 'user', displayName: 'Aïssatou S.', available: true },
        },
      ],
    });
    return { data: {}, message: null };
  });
  const dialog = vi.spyOn(TestBed.inject(MatDialog), 'open');
  await page.open(table);
  fixture.detectChanges();
  expect(api.openSession.mock.calls[0][2]).toEqual({
    clientRequestId: expect.any(String),
    tableId: table.tableId,
    areaId: table.areaId,
  });
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Aïssatou S.');
  });
  expect(dialog).not.toHaveBeenCalled();
  expect(api.get).not.toHaveBeenCalled();
  expect(
    fixture.nativeElement.querySelector('button[aria-label^="Actions de la table"]'),
  ).toBeNull();
});
it.each(['floor', 'open'])(
  'revokes stale outlet after %s 403 and reloads self context without repeated floor requests',
  async (source) => {
    const page = await waiter();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(page.floor.isSuccess()).toBe(true);
    });
    api.myOutlets.mockResolvedValue({ items: [] });
    if (source === 'floor') {
      api.serviceFloor.mockRejectedValue(new HttpErrorResponse({ status: 403 }));
      await page.refresh();
    } else {
      api.openSession.mockRejectedValue(new HttpErrorResponse({ status: 403 }));
      await page.open(page.tables()[0]);
    }
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(
        'Aucun établissement ne vous est encore affecté',
      );
    });
    const count = api.serviceFloor.mock.calls.length;
    fixture.detectChanges();
    expect(page.outletId()).toBeNull();
    expect(api.myOutlets.mock.calls.length).toBeGreaterThan(1);
    expect(api.serviceFloor.mock.calls.length).toBe(count);
  },
);
it('separates self queries and local opening intents across user changes in the same organization', async () => {
  const page = await waiter();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.floor.isSuccess()).toBe(true);
  });
  let resolve!: (value: unknown) => void;
  api.myOutlets.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  user.set('other-user');
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(api.myOutlets).toHaveBeenCalledWith('org', 'other-user', undefined);
  });
  expect(page.outlet()).toBeUndefined();
  expect(page.tables().length === 0 || !page.outlet()).toBe(true);
  resolve({ items: [] });
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.myLocations.isSuccess()).toBe(true);
  });
  expect(client.getQueryData(restaurantKeys.myOutlets('org', 'user'))).toBeDefined();
  expect(client.getQueryData(restaurantKeys.myOutlets('org', 'other-user'))).not.toEqual(
    client.getQueryData(restaurantKeys.myOutlets('org', 'user')),
  );
});
it('does not show no-assignment while the self-context request is still loading', async () => {
  selfService.set(true);
  api.myOutlets.mockImplementation(() => new Promise(() => undefined));
  const pending = create();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.componentInstance.myLocations.isPending()).toBe(true);
  });
  expect(fixture.nativeElement.textContent).not.toContain(
    'Aucun établissement ne vous est encore affecté',
  );
  expect(fixture.nativeElement.querySelector('[role="status"]')).not.toBeNull();
  // Resolve the helper independently by ending access; the query itself remains deliberately pending.
  read.set(false);
  await pending;
});
it('waiter retries ambiguous opening with the same intent and never claims a conflict winner', async () => {
  const page = await waiter();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.floor.isSuccess()).toBe(true);
  });
  const table = page.tables()[0];
  api.openSession.mockRejectedValue(new HttpErrorResponse({ status: 0 }));
  await page.open(table);
  await page.open(table);
  expect(api.openSession.mock.calls[0][2]).toEqual(api.openSession.mock.calls[1][2]);
  const occupied = floorFixture().items[1];
  if (occupied.state !== 'OCCUPIED') throw Error('fixture');
  api.serviceFloor.mockResolvedValue({
    outletId: rid(2),
    items: [
      {
        ...occupied,
        tableId: table.tableId,
        responsibleStaff: { staffId: 'other', displayName: 'Binta S.', available: true },
      },
    ],
  });
  api.openSession.mockRejectedValue(new HttpErrorResponse({ status: 409 }));
  await page.open(table);
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Binta S.');
  });
  expect(fixture.nativeElement.textContent).toContain(fr.RESTAURANTS.SERVICE.OPEN_CONFLICT);
});

it('fails closed immediately when RESTAURANTS ProductAccess is removed', async () => {
  const page = await waiter();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.floor.isSuccess()).toBe(true);
  });
  availability.set('UNAVAILABLE');
  fixture.detectChanges();
  expect(page.allowed()).toBe(false);
  expect(fixture.nativeElement.querySelector('[data-testid="floor-grid"]')).toBeNull();
  const before = api.openSession.mock.calls.length;
  await page.open(page.tables()[0]);
  expect(api.openSession.mock.calls.length).toBe(before);
});
it('after revocation offers another assigned outlet without silently choosing it', async () => {
  const page = await waiter();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.floor.isSuccess()).toBe(true);
  });
  api.myOutlets.mockResolvedValue({ items: [{ outletId: rid(8), name: 'Fidjrossè' }] });
  api.openSession.mockRejectedValue(new HttpErrorResponse({ status: 403 }));
  await page.open(page.tables()[0]);
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.outlets().map((o) => o.id)).toEqual([rid(8)]);
  });
  expect(page.outletId()).toBeNull();
  expect(api.serviceFloor.mock.calls.some((call) => call[1] === rid(8))).toBe(false);
});

it('waiter empty floor offers operational guidance without configuration links or copy', async () => {
  api.serviceFloor.mockResolvedValue({ outletId: rid(2), items: [] });
  const page = await waiter();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.floor.isSuccess()).toBe(true);
  });
  expect(fixture.nativeElement.textContent).toContain('Aucune table active');
  expect(fixture.nativeElement.textContent).not.toContain('configuration');
  expect(fixture.nativeElement.querySelector('a[href*="setup"]')).toBeNull();
});

it('rejects a foreign establishment deep link for management without requesting its floor', async () => {
  params.next(convertToParamMap({ outlet: rid(999), area: rid(998) }));
  await create();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.componentInstance.contextError()).toBe(true);
  });
  expect(fixture.componentInstance.outletId()).toBeNull();
  expect(fixture.componentInstance.areaId()).toBeNull();
  expect(api.serviceFloor).not.toHaveBeenCalled();
  expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(
    [],
    expect.objectContaining({ queryParams: { outlet: null, area: null } }),
  );
});
