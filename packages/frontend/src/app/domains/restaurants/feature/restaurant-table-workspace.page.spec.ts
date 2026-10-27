import { RestaurantSessionReconciliation } from '../data-access/restaurant-session-reconciliation';
import { RestaurantOrderComposer } from '../ui/order-composer/restaurant-order-composer';
import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BehaviorSubject } from 'rxjs';
import { TranslocoService, TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import fr from '../../../../../public/assets/i18n/fr.json';
import en from '../../../../../public/assets/i18n/en.json';
import { AuthStore } from '../../identity/data-access/auth.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { RestaurantsQueries, restaurantKeys } from '../data-access/restaurants.queries';
import { sessionFixture } from '../data-access/responsible-staff.test-fixture';
import { rid } from '../data-access/restaurants.test-fixture';
import { restaurantOperationalPrice } from '../utils/restaurant-money';
import { RestaurantTableWorkspacePage } from './restaurant-table-workspace.page';
const org = signal('org'),
  user = signal('owner'),
  allowed = signal(true);
const params = new BehaviorSubject(convertToParamMap({ outletId: rid(2), guestSessionId: rid(9) }));
const filters = new BehaviorSubject(convertToParamMap({ area: rid(3) }));
const area = {
  outletId: rid(2),
  id: rid(3),
  name: 'LP-3 Area',
  isActive: true,
  version: 1,
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
};
const api = { guestSession: vi.fn(), get: vi.fn() };
let client: QueryClient;
let fixture: ReturnType<typeof TestBed.createComponent<RestaurantTableWorkspacePage>> | undefined;
const text = () => fixture!.nativeElement.textContent as string;
const setup = (routing = false) =>
  TestBed.configureTestingModule({
    imports: [
      RestaurantTableWorkspacePage,
      TranslocoTestingModule.forRoot({
        langs: { fr, en },
        translocoConfig: {
          availableLangs: ['fr', 'en'],
          defaultLang: 'fr',
          reRenderOnLangChange: true,
        },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter(
        routing
          ? [
              { path: 'restaurants/service', component: FloorStub },
              {
                path: 'restaurants/service/outlets/:outletId/sessions/:guestSessionId',
                component: RestaurantTableWorkspacePage,
              },
            ]
          : [],
      ),
      ...(!routing
        ? [
            {
              provide: ActivatedRoute,
              useValue: {
                snapshot: { paramMap: params.value, queryParamMap: filters.value },
                paramMap: params,
                queryParamMap: filters,
              },
            },
          ]
        : []),
      { provide: AuthStore, useValue: { effectiveOrgId: org, currentUserId: user } },
      { provide: QueryClient, useValue: client },
      { provide: RestaurantsApi, useValue: api },
      {
        provide: RestaurantsCapabilities,
        useValue: { canReadSession: allowed, canReadService: () => false },
      },
      { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
    ],
  }).overrideComponent(RestaurantTableWorkspacePage, {
    remove: { imports: [RestaurantOrderComposer] },
    add: { imports: [ComposerStub] },
  });
@Component({ selector: 'liass-restaurant-order-composer', template: '' })
class ComposerStub {
  readonly accessValid = input<boolean>();
  readonly session = input<unknown>();
  readonly outletId = input<string>();
  readonly sessionId = input<string>();
}
@Component({ template: '<h1>Service en salle</h1>' })
class FloorStub {}
beforeEach(() => {
  org.set('org');
  user.set('owner');
  allowed.set(true);
  params.next(convertToParamMap({ outletId: rid(2), guestSessionId: rid(9) }));
  filters.next(convertToParamMap({ area: rid(3) }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.get.mockReset().mockResolvedValue(area);
  api.guestSession.mockReset().mockResolvedValue(sessionFixture());
});
afterEach(() => {
  fixture?.destroy();
  fixture = undefined;
  client.clear();
  TestBed.resetTestingModule();
});
async function create() {
  setup();
  fixture = TestBed.createComponent(RestaurantTableWorkspacePage);
  fixture.detectChanges();
  return fixture.componentInstance;
}
async function loaded() {
  const page = await create();
  await vi.waitFor(() => {
    fixture!.detectChanges();
    expect(page.session()).not.toBeNull();
  });
  return page;
}
it('renders the preserved header using the keyed read; composer tested independently', async () => {
  await loaded();
  expect(api.guestSession).toHaveBeenCalledWith('org', rid(2), rid(9));
  expect(fixture!.nativeElement.querySelector('h1').textContent).toContain('T02');
  expect(text()).toContain('Table T02');
  expect(text()).toContain('Service en cours');
  expect(text()).toContain('Responsable non affecté');
  expect(
    fixture!.nativeElement.querySelector('[data-testid="workspace-amount"]').textContent.trim(),
  ).toBe(restaurantOperationalPrice(0, 'XOF', 'fr'));
  expect(text().match(/XOF/g)).toHaveLength(1);
  expect(text()).not.toMatch(
    /private-opener|00000000|Ajouter des articles|Encaisser|En préparation/,
  );
  expect(fixture!.nativeElement.querySelectorAll('input, table').length).toBe(0);
  // Composer orchestration is covered in its dedicated integration-style tests.
});
it('shows only the table name as operational heading when name and code differ', async () => {
  api.guestSession.mockResolvedValue(sessionFixture({ tableCode: 'TC', tableName: 'TEST CHRIS' }));
  await loaded();
  expect(fixture!.nativeElement.querySelector('h1').textContent.trim()).toBe('TEST CHRIS');
  expect(text()).not.toMatch(/\bTC\b/);
});
it.each([
  { displayName: 'Aïssatou S.', available: true },
  { displayName: 'Aïssatou S.', available: false },
  { displayName: null, available: false },
])('preserves assigned responsible-staff semantics %j', async (person) => {
  api.guestSession.mockResolvedValue(
    sessionFixture({
      responsibleStaff: { staffId: 'secret-staff-id', ...person },
      dueMinor: 12500,
      orderCount: 3,
    }),
  );
  await loaded();
  expect(text()).toContain(person.displayName ?? fr.RESTAURANTS.TEAM.UNNAMED);
  expect(text().includes(fr.RESTAURANTS.RESPONSIBILITY.UNAVAILABLE)).toBe(!person.available);
  expect(text()).not.toContain('secret-staff-id');
  expect(text()).not.toContain(fr.RESTAURANTS.RESPONSIBILITY.UNASSIGNED);
  expect(text()).toContain('Service en cours');
  expect(text()).not.toContain('Aucune commande pour le moment');
  expect(
    fixture!.nativeElement.querySelector('[data-testid="workspace-amount"]').textContent.trim(),
  ).toBe(restaurantOperationalPrice(12500, 'XOF', 'fr'));
});
it('supports a direct CLOSED session and OPEN-to-CLOSED canonical refresh', async () => {
  const page = await loaded();
  api.guestSession.mockResolvedValue(sessionFixture({ status: 'CLOSED' }));
  await page.query.refetch();
  await vi.waitFor(() => {
    fixture!.detectChanges();
    expect(page.session()?.status).toBe('CLOSED');
  });
  expect(text()).toContain('Service terminé');
  expect(fixture!.nativeElement.querySelector('[data-testid="workspace-context"]')).toBeNull();
  expect(fixture!.nativeElement.querySelector('[data-testid="workspace-content"]')).toBeNull();
});
it.each([
  [403, 'ACCESS'],
  [404, 'UNAVAILABLE'],
  [400, 'INVALID'],
  [503, 'LOAD'],
  [0, 'LOAD'],
] as const)('classifies HTTP %s without exposing raw errors', async (status, key) => {
  api.guestSession.mockRejectedValue(
    new HttpErrorResponse({ status, error: { message: 'PK=private technical error' } }),
  );
  const page = await create();
  await vi.waitFor(() => {
    fixture!.detectChanges();
    expect(page.query.isError()).toBe(true);
  });
  expect(page.errorKey()).toBe(key);
  expect(text()).not.toContain('private');
  expect(page.session()).toBeNull();
  expect(text()).toContain(fr.RESTAURANTS.WORKSPACE.ERRORS[key]);
});
it('retries a temporary failure successfully without reusing stale content', async () => {
  api.guestSession
    .mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }))
    .mockResolvedValue(sessionFixture());
  const page = await create();
  await vi.waitFor(() => {
    fixture!.detectChanges();
    expect(page.query.isError()).toBe(true);
  });
  const button = [...fixture!.nativeElement.querySelectorAll('button')].find((b: unknown) =>
    (b as HTMLElement).textContent?.includes('Réessayer'),
  ) as HTMLButtonElement;
  button.click();
  await vi.waitFor(() => {
    fixture!.detectChanges();
    expect(page.session()).not.toBeNull();
  });
});
it('rejects malformed route before HTTP and suppresses unauthorized cached data', async () => {
  params.next(convertToParamMap({ outletId: 'bad', guestSessionId: rid(9) }));
  const page = await create();
  expect(page.errorKey()).toBe('INVALID');
  expect(api.guestSession).not.toHaveBeenCalled();
  params.next(convertToParamMap({ outletId: rid(2), guestSessionId: rid(9) }));
  allowed.set(false);
  client.setQueryData(restaurantKeys.session('org', rid(2), rid(9), 'owner'), sessionFixture());
  fixture!.detectChanges();
  expect(page.session()).toBeNull();
  expect(text()).not.toContain('Table T02');
});
it.each(['organization', 'principal', 'session'] as const)(
  'isolates a late response across %s change',
  async (change) => {
    let resolve!: (value: ReturnType<typeof sessionFixture>) => void;
    api.guestSession
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockRejectedValue(new HttpErrorResponse({ status: 404 }));
    const page = await create();
    await vi.waitFor(() => expect(api.guestSession).toHaveBeenCalledTimes(1));
    if (change === 'organization') org.set('CLO');
    if (change === 'principal') user.set('Chrys');
    if (change === 'session')
      params.next(convertToParamMap({ outletId: rid(2), guestSessionId: rid(10) }));
    fixture!.detectChanges();
    resolve(sessionFixture());
    await vi.waitFor(() => {
      fixture!.detectChanges();
      expect(api.guestSession).toHaveBeenCalledTimes(2);
    });
    expect(page.session()).toBeNull();
    expect(text()).not.toContain('Table T02');
  },
);
it('preserves only matching area context on return, and discards it on tenant change', async () => {
  const page = await loaded();
  expect(page.backParams()).toEqual({ outlet: rid(2), area: rid(3) });
  filters.next(convertToParamMap({ area: rid(99) }));
  fixture!.detectChanges();
  expect(page.backParams()).toEqual({ outlet: rid(2), area: undefined });
  org.set('CLO');
  fixture!.detectChanges();
  expect(page.backParams()).toEqual({});
});
it('isolates canonical query keys across principal, organization, outlet and session', () => {
  setup();
  const queries = TestBed.inject(RestaurantsQueries);
  const initial = queries.guestSession(rid(2), rid(9)).queryKey;
  user.set('Chrys');
  expect(queries.guestSession(rid(2), rid(9)).queryKey).not.toEqual(initial);
  user.set('owner');
  org.set('CLO');
  expect(queries.guestSession(rid(2), rid(9)).queryKey).not.toEqual(initial);
  expect(restaurantKeys.session('org', rid(3), rid(9), 'owner')).not.toEqual(initial);
  expect(restaurantKeys.session('org', rid(2), rid(10), 'owner')).not.toEqual(initial);
});
it('resolves direct URL, navigation back and browser Back/Forward through real routes', async () => {
  setup(true);
  const harness = await RouterTestingHarness.create('/restaurants/service');
  const path = `/restaurants/service/outlets/${rid(2)}/sessions/${rid(9)}?area=${rid(3)}`;
  const page = await harness.navigateByUrl(path, RestaurantTableWorkspacePage);
  await vi.waitFor(() => {
    harness.detectChanges();
    expect(page.session()).not.toBeNull();
  });
  TestBed.inject(Location).back();
  await vi.waitFor(() => {
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain('Service en salle');
  });
  TestBed.inject(Location).forward();
  await vi.waitFor(() => {
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain('T02');
  });
  const back = harness.routeNativeElement!.querySelector(
    '[data-testid="back-floor"]',
  ) as HTMLAnchorElement;
  expect(back.getAttribute('href')).toContain(`outlet=${rid(2)}`);
  back.click();
  await vi.waitFor(() => {
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain('Service en salle');
  });
});

it('renders the header through the real keyed HTTP client independently of the composer', async () => {
  setup();
  TestBed.overrideProvider(RestaurantsApi, { useFactory: () => new RestaurantsApi() });
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  fixture = TestBed.createComponent(RestaurantTableWorkspacePage);
  fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController);
  await vi.waitFor(() => expect(fixture!.componentInstance.query.isFetching()).toBe(true));
  const request = http.expectOne((r) =>
    r.url.endsWith(`/restaurants/outlets/${rid(2)}/sessions/${rid(9)}`),
  );
  expect(request.request.method).toBe('GET');
  request.flush({ data: sessionFixture({ orderCount: 3 }) });
  await vi.waitFor(() => {
    fixture!.detectChanges();
    expect(text()).toContain('Service en cours');
  });
  http.expectOne((r) => r.url.endsWith('/service-areas/' + rid(3))).flush({ data: area });
  http.expectNone((r) => /orders|items|tables|menu/.test(r.url));
  http.verify();
});
it('renders a direct CLOSED read and clears a previous table immediately when route identity changes', async () => {
  api.guestSession.mockResolvedValueOnce(sessionFixture({ status: 'CLOSED' }));
  const page = await loaded();
  expect(text()).toContain('Service terminé');
  api.guestSession.mockImplementation(() => new Promise(() => {}));
  params.next(convertToParamMap({ outletId: rid(2), guestSessionId: rid(10) }));
  fixture!.detectChanges();
  expect(page.session()).toBeNull();
  expect(fixture!.nativeElement.querySelector('h1').textContent).not.toContain('T02');
  expect(fixture!.nativeElement.querySelector('[aria-busy="true"]')).not.toBeNull();
});
it.each(['organization', 'principal'] as const)(
  'removes an already rendered cached OWNER session immediately after %s switch',
  async (change) => {
    const page = await loaded();
    expect(text()).toContain('Table T02');
    api.guestSession.mockImplementation(() => new Promise(() => {}));
    if (change === 'principal') user.set('Chrys');
    else org.set('CLO');
    fixture!.detectChanges();
    expect(page.session()).toBeNull();
    expect(text()).not.toContain('Table T02');
    expect(fixture!.nativeElement.querySelector('[data-testid="workspace-amount"]')).toBeNull();
  },
);

it('retains authorized context only during matching command reconciliation and accepts CLOSED result', async () => {
  const page = await loaded();
  const header = fixture!.nativeElement.querySelector('[data-testid="workspace-context"]');
  let resolve!: (value: ReturnType<typeof sessionFixture>) => void;
  api.guestSession.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
  const reconciliation = TestBed.inject(RestaurantSessionReconciliation);
  const refresh = reconciliation.run(
    { org: 'org', user: 'owner', revision: 0, outlet: rid(2), session: rid(9) },
    () => page.query.refetch(),
  );
  await vi.waitFor(() => expect(page.query.isFetching()).toBe(true));
  fixture!.detectChanges();
  expect(page.session()?.status).toBe('OPEN');
  expect(fixture!.nativeElement.querySelector('[data-testid="workspace-context"]')).toBe(header);
  resolve(sessionFixture({ status: 'CLOSED' }));
  await refresh;
  await vi.waitFor(() => {
    fixture!.detectChanges();
    expect(page.session()?.status).toBe('CLOSED');
  });
  expect(fixture!.nativeElement.querySelector('[data-testid="workspace-context"]')).toBeNull();
});

it.each(['organization', 'principal'] as const)(
  'does not retain a reconciling session across %s change',
  async (dimension) => {
    const page = await loaded();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pending = TestBed.inject(RestaurantSessionReconciliation).run(
      { org: 'org', user: 'owner', revision: 0, outlet: rid(2), session: rid(9) },
      () => gate,
    );
    api.guestSession.mockImplementation(() => new Promise(() => {}));
    if (dimension === 'organization') org.set('CLO');
    else user.set('Chrys');
    fixture!.detectChanges();
    expect(page.session()).toBeNull();
    expect(page.reconciling()).toBe(false);
    release();
    await pending;
  },
);

it.each(['fr', 'en'])('renders the service summary and canonical area in %s', async (lang) => {
  const page = await loaded();
  TestBed.inject(TranslocoService).setActiveLang(lang);
  await vi.waitFor(() => {
    fixture!.detectChanges();
    expect(page.areaName()).toBe('LP-3 Area');
  });
  const d = lang === 'fr' ? fr : en;
  expect(text()).toContain(d.RESTAURANTS.WORKSPACE.AMOUNT);
  expect(text()).toContain(d.RESTAURANTS.WORKSPACE.OPEN_STATE);
  expect(text()).toContain(d.RESTAURANTS.RESPONSIBILITY.UNASSIGNED);
  expect(text()).toContain(page.duration());
  expect(fixture!.nativeElement.querySelector('time').getAttribute('datetime')).toBe(
    sessionFixture().openedAt,
  );
  expect(api.get).toHaveBeenCalledWith('org', 'area', { outletId: rid(2) }, rid(3));
});

it('keeps canonical service actions available when only the area label fails', async () => {
  api.get.mockRejectedValue(new HttpErrorResponse({ status: 404 }));
  const page = await loaded();
  await vi.waitFor(() => {
    fixture!.detectChanges();
    expect(page.areaQuery.isError()).toBe(true);
  });
  expect(page.session()).not.toBeNull();
  expect(text()).toContain('La salle ne peut pas être affichée');
  expect(text()).toContain('Montant actuel');
  expect(fixture!.nativeElement.querySelector('[data-testid="workspace-error"]')).toBeNull();
});
