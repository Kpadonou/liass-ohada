import { RestaurantsApi } from '../data-access/restaurants.api';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { HttpErrorResponse } from '@angular/common/http';
import * as c from '@liass-ohada/shared/restaurants';
import fr from '../../../../../public/assets/i18n/fr.json';
import { AuthStore } from '../../identity/data-access/auth.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { RestaurantAccessState } from '../data-access/restaurant-access-state';
import {
  RestaurantPreparationApi,
  KitchenContext,
} from '../data-access/restaurant-preparation.api';
import { kitchenKeys } from '../data-access/restaurant-preparation.queries';
import { RestaurantKitchenPage } from './restaurant-kitchen.page';
import { accessWorkspace } from '../data-access/restaurant-access.test-fixture';
import { rid } from '../data-access/restaurants.test-fixture';
const org = signal('org'),
  user = signal('cook'),
  revision = signal(0),
  role = signal<'KITCHEN' | 'OWNER' | 'MANAGER' | 'WAITER' | 'CASHIER'>('KITCHEN');
const stamp = '2026-10-18T10:00:00.000Z';
const task = (state: 'QUEUED' | 'IN_PROGRESS' | 'READY', n = 1): c.PreparationRead =>
  c.PreparationReadSchema.parse({
    orgId: 'org',
    outletId: rid(2),
    schemaVersion: 1,
    orderId: rid(20 + n),
    itemId: rid(30 + n),
    fireId: rid(40 + n),
    submissionId: rid(50 + n),
    stationId: rid(3),
    stationVersion: 1,
    generation: 1,
    name: 'Poulet braisé sauce maison',
    quantity: 2,
    notes: 'Sans piment',
    state,
    queuedAt: stamp,
    queuedBy: 'owner',
    ...(state !== 'QUEUED' ? { startedAt: stamp, startedBy: 'cook' } : {}),
    ...(state === 'READY' ? { readyAt: stamp, readyBy: 'cook' } : {}),
    version: 1,
    serviceContext:
      n === 1
        ? { mode: 'DINE_IN', tableName: 'Terrasse jardin' }
        : n === 2
          ? { mode: 'TAKEAWAY' }
          : { mode: 'COUNTER' },
  });
let client: QueryClient,
  fixture: ReturnType<typeof TestBed.createComponent<RestaurantKitchenPage>>,
  tasks: c.PreparationRead[];
const api = {
  context: () => ({ org: org(), user: user(), revision: revision(), outlet: '' }),
  outlets: vi.fn(),
  stations: vi.fn(),
  queue: vi.fn(),
  command: vi.fn(),
};
const outlets = [
  { id: rid(2), name: 'Centre', isActive: true },
  { id: rid(12), name: 'Jardin', isActive: true },
];
const stations = [
  { id: rid(3), name: 'Cuisine', outletId: rid(2), isActive: true },
  { id: rid(4), name: 'Bar', outletId: rid(2), isActive: true },
  { id: rid(5), name: 'Ancien poste', outletId: rid(2), isActive: false },
];
async function settle() {
  for (let n = 0; n < 8; n++) {
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
async function create() {
  fixture = TestBed.createComponent(RestaurantKitchenPage);
  await settle();
}
beforeEach(() => {
  org.set('org');
  user.set('cook');
  revision.set(0);
  role.set('KITCHEN');
  tasks = [task('QUEUED'), task('IN_PROGRESS', 2), task('READY', 3)];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.outlets.mockReset().mockResolvedValue({ items: [outlets[0]] });
  api.stations.mockReset().mockResolvedValue({ items: stations });
  api.queue.mockReset().mockImplementation(async (ctx, station, state) => ({
    items: tasks.filter(
      (t) => t.outletId === ctx.outlet && t.stationId === station && t.state === state,
    ),
  }));
  api.command.mockReset().mockImplementation(async (_ctx, t, action) => {
    const found = tasks.find((row) => row.fireId === t.fireId)!;
    found.state = action === 'start' ? 'IN_PROGRESS' : 'READY';
    return { data: found };
  });
  TestBed.configureTestingModule({
    imports: [
      RestaurantKitchenPage,
      TranslocoTestingModule.forRoot({
        langs: { fr },
        preloadLangs: true,
        translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
      }),
    ],
    providers: [
      provideRouter([]),
      { provide: QueryClient, useValue: client },
      { provide: RestaurantPreparationApi, useValue: api },
      {
        provide: RestaurantsApi,
        useValue: {
          myOutlets: async (_org: string, _user: string, cursor?: string) => {
            const page = await api.outlets(api.context(), true, cursor);
            return {
              ...page,
              items: page.items.map((row: { id: string; name: string }) => ({
                outletId: row.id,
                name: row.name,
              })),
            };
          },
          list: async (_org: string, _kind: string, _ctx: unknown, cursor?: string) =>
            api.outlets(api.context(), false, cursor),
        },
      },
      {
        provide: AuthStore,
        useValue: {
          currentUserId: user,
          contextRevision: revision,
          effectiveOrgId: org,
          activeWorkspaceType: () => 'COMPANY',
          activeWorkspace: () => ({ ...accessWorkspace(role()), orgId: org() }),
        },
      },
      { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
      {
        provide: RestaurantAccessState,
        useValue: { refreshing: () => false, refreshFailed: () => false, refresh: vi.fn() },
      },
    ],
  });
});
afterEach(() => {
  fixture?.destroy();
  client.clear();
  TestBed.resetTestingModule();
});
it.each(['KITCHEN', 'OWNER', 'MANAGER'] as const)(
  '%s sees canonical contexts, notes and three selected-station queues only',
  async (value) => {
    role.set(value);
    await create();
    expect(api.outlets.mock.calls[0][1]).toBe(value === 'KITCHEN');
    expect(api.queue).toHaveBeenCalledTimes(3);
    expect(api.queue.mock.calls.every((call) => call[1] === rid(3))).toBe(true);
    const text = fixture.nativeElement.textContent;
    for (const content of [
      'Terrasse jardin',
      'À emporter',
      'Comptoir',
      'Sans piment',
      'À préparer',
      'En préparation',
      'Prêt',
    ])
      expect(text).toContain(content);
    expect(text).not.toContain(rid(20));
    expect(text).not.toContain('Servir');
  },
);
it.each(['WAITER', 'CASHIER'] as const)('%s has no Kitchen requests or commands', async (value) => {
  role.set(value);
  await create();
  expect(api.queue).not.toHaveBeenCalled();
  expect(api.outlets).not.toHaveBeenCalled();
  expect(fixture.nativeElement.querySelector('liass-restaurant-kitchen-lane')).toBeNull();
});
it('preserves no-outlet and no-station states without invented work', async () => {
  api.outlets.mockResolvedValue({ items: [] });
  await create();
  expect(fixture.nativeElement.textContent).toContain('affecté');
  expect(api.queue).not.toHaveBeenCalled();
});
it('auto-selects one station without a redundant selector and preserves inactive work discovery', async () => {
  api.stations.mockResolvedValue({ items: [stations[0], stations[2]] });
  await create();
  expect(fixture.componentInstance.stationId()).toBe(rid(3));
  expect(fixture.nativeElement.querySelector('.kitchen-stations')).toBeNull();
  expect(fixture.nativeElement.textContent).toContain('postes inactifs');
  fixture.componentInstance.selectStation(rid(5));
  await settle();
  expect(api.queue).toHaveBeenCalledTimes(6);
});
it('zero stations does not request queues', async () => {
  api.stations.mockResolvedValue({ items: [] });
  await create();
  expect(fixture.nativeElement.textContent).toContain('Aucun poste');
  expect(api.queue).not.toHaveBeenCalled();
});
it('station A/B/A reuses fresh cache and mobile lane switching stays local', async () => {
  await create();
  fixture.componentInstance.selectStation(rid(4));
  await settle();
  expect(api.queue).toHaveBeenCalledTimes(6);
  fixture.componentInstance.selectStation(rid(3));
  await settle();
  fixture.componentInstance.mobileLane.set('READY');
  await settle();
  expect(api.queue).toHaveBeenCalledTimes(6);
});
it('multiple outlets require selection and switching cannot flash the previous outlet', async () => {
  api.outlets.mockResolvedValue({ items: outlets });
  await create();
  expect(api.queue).not.toHaveBeenCalled();
  fixture.componentInstance.selectOutlet(rid(2));
  await settle();
  expect(fixture.nativeElement.textContent).toContain('Terrasse jardin');
  fixture.componentInstance.selectOutlet(rid(12));
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).not.toContain('Terrasse jardin');
  await settle();
  expect(fixture.componentInstance.stations()).toEqual([]);
});
it('Start retains the board, prevents duplicate clicks, and reconciles only two lanes', async () => {
  await create();
  let finish!: () => void;
  api.command.mockImplementation(
    (_ctx, t) =>
      new Promise((resolve) => {
        finish = () => {
          tasks = tasks.map((row) =>
            row.fireId === t.fireId ? { ...row, state: 'IN_PROGRESS' as const } : row,
          );
          resolve({ data: tasks.find((row) => row.fireId === t.fireId) });
        };
      }),
  );
  const button = fixture.nativeElement.querySelector(
    'button[aria-label^="Commencer"]',
  ) as HTMLButtonElement;
  const board = fixture.nativeElement.querySelector('.kitchen-board');
  button.click();
  fixture.detectChanges();
  button.click();
  expect(api.command).toHaveBeenCalledTimes(1);
  expect(fixture.nativeElement.querySelector('.kitchen-board')).toBe(board);
  expect(fixture.nativeElement.textContent).not.toContain('Enregistrement en cours');
  expect(button.disabled).toBe(true);
  finish();
  await settle();
  expect(api.queue).toHaveBeenCalledTimes(5);
  expect(fixture.nativeElement.querySelector('.kitchen-board')).toBe(board);
  expect(
    api.queue.mock.calls
      .slice(3)
      .map((call) => call[2])
      .sort(),
  ).toEqual(['IN_PROGRESS', 'QUEUED']);
});
it('Ready reconciles in-progress/ready only and explicit refresh fetches exactly three queues', async () => {
  await create();
  const button = fixture.nativeElement.querySelector(
    'button[aria-label^="Marquer prêt"]',
  ) as HTMLButtonElement;
  button.click();
  await settle();
  expect(api.queue).toHaveBeenCalledTimes(5);
  expect(
    api.queue.mock.calls
      .slice(3)
      .map((call) => call[2])
      .sort(),
  ).toEqual(['IN_PROGRESS', 'READY']);
  await fixture.componentInstance.refresh();
  await settle();
  expect(api.queue).toHaveBeenCalledTimes(8);
});
it('ambiguous failures keep stable request identity and useful local error feedback', async () => {
  await create();
  api.command.mockRejectedValue(new HttpErrorResponse({ status: 0 }));
  const button = () =>
    fixture.nativeElement.querySelector('button[aria-label^="Commencer"]') as HTMLButtonElement;
  button().click();
  await settle();
  button().click();
  await settle();
  expect(api.command.mock.calls[0][3]).toBe(api.command.mock.calls[1][3]);
  expect(fixture.nativeElement.querySelector('.kitchen-board')).not.toBeNull();
  expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
});
it.each(['organization', 'principal', 'revision'])(
  'hides old tasks immediately on %s change and isolates query keys',
  async (kind) => {
    await create();
    if (kind === 'organization') org.set('other');
    else if (kind === 'principal') user.set('other');
    else revision.set(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Terrasse jardin');
    expect(
      kitchenKeys.lane(
        { org: org(), user: user(), revision: revision(), outlet: rid(2) },
        rid(3),
        'QUEUED',
      ),
    ).not.toEqual(
      kitchenKeys.lane({ org: 'org', user: 'cook', revision: 0, outlet: rid(2) }, rid(3), 'QUEUED'),
    );
  },
);
it('no polling is configured and idle fresh queries do not repeat', async () => {
  await create();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await settle();
  expect(api.queue).toHaveBeenCalledTimes(3);
  for (const query of client
    .getQueryCache()
    .getAll()
    .filter((query) => query.queryKey.includes('queue')))
    expect((query.options as { refetchInterval?: unknown }).refetchInterval).toBeUndefined();
});
it('loads only the requested lane continuation and preserves current content', async () => {
  api.queue.mockImplementation(async (ctx, station, state, cursor) => ({
    items: state === 'QUEUED' ? [task('QUEUED', cursor ? 2 : 1)] : [],
    ...(state === 'QUEUED' && !cursor ? { nextCursor: 'next' } : {}),
  }));
  await create();
  expect(api.queue).toHaveBeenCalledTimes(3);
  const button = fixture.nativeElement.querySelector('button.w-full') as HTMLButtonElement;
  expect(button.textContent).toContain('Charger davantage');
  button.click();
  await settle();
  expect(api.queue).toHaveBeenCalledTimes(4);
  expect(api.queue.mock.calls[3][2]).toBe('QUEUED');
  expect(api.queue.mock.calls[3][3]).toBe('next');
  expect(fixture.nativeElement.textContent).toContain('Terrasse jardin');
  expect(fixture.nativeElement.textContent).toContain('À emporter');
});
it('conflicts reconcile only affected lanes and never invalidate application or catalogue context', async () => {
  const unrelated = [
    ['auth', 'current-user'],
    ['workspaces', 'cook'],
    ['product-access', 'org'],
    ['restaurants', 'org', 'operational-carte', 'cook', 0, rid(2), 'menu'],
  ];
  for (const key of unrelated) client.setQueryData(key, { stable: true });
  await create();
  api.command.mockRejectedValue(new HttpErrorResponse({ status: 409 }));
  (
    fixture.nativeElement.querySelector('button[aria-label^="Commencer"]') as HTMLButtonElement
  ).click();
  await settle();
  expect(api.queue).toHaveBeenCalledTimes(5);
  for (const key of unrelated) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  expect(fixture.nativeElement.querySelector('.kitchen-board')).not.toBeNull();
});
it('authorization denial removes operational content rather than retaining actionable cached tasks', async () => {
  await create();
  api.queue.mockRejectedValue(new HttpErrorResponse({ status: 403 }));
  await fixture.componentInstance.refresh();
  await settle();
  expect(fixture.nativeElement.querySelector('.kitchen-board')).toBeNull();
  expect(fixture.nativeElement.textContent).not.toContain('Terrasse jardin');
});
it('late previous-station responses never attach to the selected station', async () => {
  let finish!: () => void;
  api.queue.mockImplementation(async (ctx, station, state) =>
    station === rid(3)
      ? await new Promise((resolve) => {
          if (state === 'QUEUED') finish = () => resolve({ items: [task('QUEUED')] });
          else resolve({ items: [] });
        })
      : { items: [] },
  );
  await create();
  fixture.componentInstance.selectStation(rid(4));
  await settle();
  finish();
  await settle();
  expect(fixture.componentInstance.stationId()).toBe(rid(4));
  expect(fixture.nativeElement.textContent).not.toContain('Terrasse jardin');
});
it('reuses fresh outlet queues on A/B/A with valid outlet-specific station discovery', async () => {
  api.outlets.mockResolvedValue({ items: outlets });
  api.stations.mockImplementation(async (ctx: KitchenContext) => ({
    items: stations.map((row) => ({ ...row, outletId: ctx.outlet })),
  }));
  await create();
  fixture.componentInstance.selectOutlet(rid(2));
  await settle();
  fixture.componentInstance.selectOutlet(rid(12));
  await settle();
  expect(api.queue).toHaveBeenCalledTimes(6);
  fixture.componentInstance.selectOutlet(rid(2));
  await settle();
  expect(api.queue).toHaveBeenCalledTimes(6);
  expect(fixture.nativeElement.textContent).toContain('Terrasse jardin');
});
it('does not claim zero active stations before bounded station discovery is exhausted', async () => {
  api.stations.mockImplementation(async (_ctx, cursor) =>
    cursor ? { items: [stations[0]] } : { items: [stations[2]], nextCursor: 'next' },
  );
  await create();
  expect(fixture.nativeElement.textContent).not.toContain('Aucun poste');
  expect(api.queue).not.toHaveBeenCalled();
  const button = Array.from(fixture.nativeElement.querySelectorAll('button')).find((button) =>
    (button as HTMLButtonElement).textContent?.includes('Autres postes'),
  ) as HTMLButtonElement;
  button.click();
  await settle();
  expect(api.queue).toHaveBeenCalledTimes(3);
});

it('aggregates a common server failure once and retries the same mounted queues', async () => {
  api.queue.mockRejectedValue(
    new HttpErrorResponse({ status: 503, error: { message: 'Erreur interne du serveur.' } }),
  );
  await create();
  expect(fixture.componentInstance.commonFailure()).toBe(true);
  const views = [...fixture.componentInstance.laneViews()];
  expect(views).toHaveLength(3);
  expect(fixture.nativeElement.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(fixture.nativeElement.textContent).toContain('Impossible de charger les préparations.');
  expect(fixture.nativeElement.textContent).not.toContain('Erreur interne du serveur.');
  expect(api.queue).toHaveBeenCalledTimes(3);
  expect(
    [...fixture.nativeElement.querySelectorAll('button')].filter((b: any) =>
      b.textContent.includes('Réessayer'),
    ),
  ).toHaveLength(1);
  expect(
    fixture.nativeElement.querySelector('[data-testid="kitchen-toolbar"]').textContent,
  ).not.toContain('Actualiser');
  api.queue.mockImplementation(async (_ctx, _station, state) => ({
    items: tasks.filter((t) => t.state === state),
  }));
  await fixture.componentInstance.refresh();
  await settle();
  expect(fixture.componentInstance.commonFailure()).toBe(false);
  expect(fixture.componentInstance.laneViews()).toEqual(views);
  expect(api.queue).toHaveBeenCalledTimes(6);
  expect(fixture.nativeElement.querySelectorAll('article')).toHaveLength(3);
});

it('keeps successful lanes usable when only READY fails and retries only that lane', async () => {
  api.queue.mockImplementation(async (_ctx, _station, state) => {
    if (state === 'READY') throw new HttpErrorResponse({ status: 503 });
    return { items: tasks.filter((t) => t.state === state) };
  });
  await create();
  expect(fixture.componentInstance.commonFailure()).toBe(false);
  expect(fixture.nativeElement.querySelector('[data-testid="kitchen-common-error"]')).toBeNull();
  expect(fixture.nativeElement.querySelectorAll('article')).toHaveLength(2);
  expect(fixture.nativeElement.querySelectorAll('[role="alert"]')).toHaveLength(1);
  const retry = [...fixture.nativeElement.querySelectorAll('button')].find((b: any) =>
    b.textContent.includes('Réessayer'),
  ) as HTMLButtonElement;
  api.queue.mockResolvedValue({ items: [] });
  retry.click();
  await settle();
  expect(api.queue).toHaveBeenCalledTimes(4);
  expect(api.queue.mock.calls.at(-1)?.[2]).toBe('READY');
  expect(fixture.nativeElement.querySelectorAll('article')).toHaveLength(2);
  expect(fixture.nativeElement.textContent).toContain(fr.RESTAURANTS.KITCHEN.EMPTY_READY);
});

it('keeps local state navigation immediate and station/refresh controls in one toolbar', async () => {
  await create();
  const toolbar = fixture.nativeElement.querySelector('[data-testid="kitchen-toolbar"]');
  expect(toolbar.querySelector('.kitchen-stations')).not.toBeNull();
  expect(toolbar.textContent).toContain('Actualiser');
  const calls = api.queue.mock.calls.length;
  fixture.componentInstance.mobileLane.set('READY');
  fixture.detectChanges();
  expect(api.queue).toHaveBeenCalledTimes(calls);
});

it('does not aggregate unrelated lane failures into a common transport error', async () => {
  api.queue.mockImplementation(async (_ctx, _station, state) => {
    throw new HttpErrorResponse({ status: state === 'READY' ? 409 : 503 });
  });
  await create();
  expect(fixture.componentInstance.commonFailure()).toBe(false);
  expect(fixture.nativeElement.querySelectorAll('[role="alert"]')).toHaveLength(3);
});
