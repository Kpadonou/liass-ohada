import { TestBed } from '@angular/core/testing';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { HttpErrorResponse } from '@angular/common/http';
import fr from '../../../../../public/assets/i18n/fr.json';
import { RestaurantReadyToServeComponent } from './restaurant-ready-to-serve.component';
import { RestaurantServicePreparationApi } from '../data-access/restaurant-service-preparation.api';
import {
  RestaurantServicePreparationQueries,
  servicePreparationKey,
} from '../data-access/restaurant-service-preparation.queries';
import {
  serviceContext as ctx,
  serviceTask,
} from '../data-access/service-preparation.test-fixture';
import { rid } from '../data-access/restaurants.test-fixture';
let fixture: ReturnType<typeof TestBed.createComponent<RestaurantReadyToServeComponent>>,
  page: RestaurantReadyToServeComponent,
  client: QueryClient;
const api = { page: vi.fn(), serve: vi.fn() };
let tasks = [serviceTask()];
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(page.query.isFetching()).toBe(false);
  });
  fixture.detectChanges();
};
beforeEach(async () => {
  vi.clearAllMocks();
  tasks = [serviceTask()];
  api.page.mockImplementation(async () => ({ items: [...tasks] }));
  api.serve.mockImplementation(async (_ctx, _order, task) => {
    tasks = tasks.filter((t) => t.fireId !== task.fireId);
    return {};
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await TestBed.configureTestingModule({
    imports: [
      RestaurantReadyToServeComponent,
      TranslocoTestingModule.forRoot({
        langs: { fr },
        translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
        preloadLangs: true,
      }),
    ],
    providers: [
      { provide: QueryClient, useValue: client },
      { provide: RestaurantServicePreparationApi, useValue: api },
    ],
  }).compileComponents();
  fixture = TestBed.createComponent(RestaurantReadyToServeComponent);
  page = fixture.componentInstance;
  fixture.componentRef.setInput('context', ctx);
  fixture.componentRef.setInput('order', rid(20));
  fixture.componentRef.setInput('enabled', true);
  fixture.detectChanges();
  await settle();
});
afterEach(() => {
  fixture.destroy();
  client.clear();
  TestBed.resetTestingModule();
});
it('shows accepted notes and distinct READY fires; other states never become actionable', async () => {
  tasks = [
    serviceTask(),
    serviceTask(23),
    serviceTask(24, 'QUEUED'),
    serviceTask(25, 'IN_PROGRESS'),
    serviceTask(26, 'SERVED'),
  ];
  await page.query.refetch();
  await settle();
  expect(page.ready()).toHaveLength(2);
  expect(fixture.nativeElement.querySelectorAll('[data-testid="ready-task"]')).toHaveLength(2);
  expect(fixture.nativeElement.textContent).toContain('Sans piment');
});
it('keeps an empty section compact and never claims exhaustive emptiness before cursor exhaustion', async () => {
  api.page.mockResolvedValue({ items: [serviceTask(24, 'QUEUED')], nextCursor: 'more' });
  await page.query.refetch();
  await settle();
  expect(fixture.nativeElement.textContent).toContain('D’autres articles restent à vérifier');
  expect(fixture.nativeElement.textContent).not.toContain('Aucun article prêt');
  api.page.mockResolvedValue({ items: [] });
  await page.query.fetchNextPage();
  await settle();
  expect(fixture.nativeElement.textContent).toContain('Aucun article prêt');
});
it('retains rows during local Serve pending, prevents duplicates and reconciles only the exact read', async () => {
  let resolve!: () => void;
  api.serve.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = () => {
          tasks = [];
          done();
        };
      }),
  );
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const task = page.ready()[0];
  const pending = page.serve(task);
  fixture.detectChanges();
  await page.serve(task);
  expect(api.serve).toHaveBeenCalledTimes(1);
  expect(fixture.nativeElement.querySelector('[data-testid="ready-task"]')).toBeTruthy();
  expect(fixture.nativeElement.textContent).not.toContain('Enregistrement en cours');
  resolve();
  await pending;
  await settle();
  expect(page.ready()).toHaveLength(0);
  expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual([
    { queryKey: servicePreparationKey(ctx, rid(20)), exact: true },
  ]);
});
it('preserves a stable idempotency identity after an ambiguous network failure', async () => {
  api.serve.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
  const task = page.ready()[0];
  await page.serve(task);
  await settle();
  expect(fixture.nativeElement.textContent).toContain('n’a pas pu être confirmé');
  await page.serve(task);
  expect(api.serve.mock.calls[0][3]).toBe(api.serve.mock.calls[1][3]);
});
it('reconciles an already-served race instead of fabricating success', async () => {
  api.serve.mockImplementation(async () => {
    tasks = [];
    throw new HttpErrorResponse({ status: 409 });
  });
  await page.serve(page.ready()[0]);
  await settle();
  expect(page.ready()).toHaveLength(0);
});
it('retains authorized DOM during background reads and hides it immediately on CLOSED/access loss', async () => {
  const row = fixture.nativeElement.querySelector('[data-testid="ready-task"]');
  let resolve!: (value: unknown) => void;
  api.page.mockImplementation(() => new Promise((done) => (resolve = done)));
  const pending = page.query.refetch();
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('[data-testid="ready-task"]')).toBe(row);
  fixture.componentRef.setInput('enabled', false);
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toBe('');
  resolve({ items: tasks });
  await pending;
  fixture.detectChanges();
  expect(page.ready()).toHaveLength(0);
});
it('never attaches a late Order A response to Order B and reuses fresh A cache', async () => {
  const firstCalls = api.page.mock.calls.length;
  fixture.componentRef.setInput('order', rid(30));
  fixture.detectChanges();
  expect(page.ready()).toHaveLength(0);
  await settle();
  fixture.componentRef.setInput('order', rid(20));
  fixture.detectChanges();
  await settle();
  expect(api.page.mock.calls.length).toBe(firstCalls + 1);
});
it.each(['org', 'user', 'revision', 'outlet'])(
  'hides cached work across %s changes',
  async (field) => {
    api.page.mockImplementation(() => new Promise(() => {}));
    fixture.componentRef.setInput('context', {
      ...ctx,
      [field]: field === 'revision' ? 2 : 'different',
    });
    fixture.detectChanges();
    expect(page.ready()).toHaveLength(0);
  },
);
it('uses short freshness, no polling and an exact section refresh', async () => {
  const options = TestBed.inject(RestaurantServicePreparationQueries).pages(ctx, rid(20), true);
  expect(options.staleTime).toBe(15000);
  expect('refetchInterval' in options).toBe(false);
  const before = api.page.mock.calls.length;
  (
    fixture.nativeElement.querySelector(
      'button[aria-label="Actualiser les articles prêts à servir"]',
    ) as HTMLButtonElement
  ).click();
  await settle();
  expect(api.page.mock.calls.length).toBe(before + 1);
});

it('caps rendered READY rows and expands cached rows immediately without a request', async () => {
  tasks = Array.from({ length: 51 }, (_, index) => serviceTask(200 + index));
  await page.query.refetch();
  await settle();
  expect(fixture.nativeElement.querySelectorAll('[data-testid="ready-task"]')).toHaveLength(50);
  const before = api.page.mock.calls.length;
  const button = [...fixture.nativeElement.querySelectorAll('button')].find((button: unknown) =>
    (button as HTMLElement).textContent?.includes('Afficher davantage'),
  ) as HTMLButtonElement;
  button.click();
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelectorAll('[data-testid="ready-task"]')).toHaveLength(51);
  expect(api.page.mock.calls.length).toBe(before);
});
it('emits access loss after Serve denial without touching unrelated caches', async () => {
  const deny = vi.fn();
  page.denied.subscribe(deny);
  api.serve.mockRejectedValue(new HttpErrorResponse({ status: 403 }));
  await page.serve(page.ready()[0]);
  expect(deny).toHaveBeenCalledTimes(1);
});
