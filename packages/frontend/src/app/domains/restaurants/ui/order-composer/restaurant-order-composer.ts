import {
  RestaurantCarteQueries,
  CarteItem,
  carteBytes,
  carteTokens,
  matchesCarteTokens,
  CARTE_PAGE_BUDGET,
  CARTE_BYTE_BUDGET,
} from '../../data-access/restaurant-carte.queries';
import { LiassSearchableSelectComponent } from '../../../../shared/ui/searchable-select/searchable-select.component';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  DestroyRef,
  ElementRef,
  afterEveryRender,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectInfiniteQuery, injectQuery } from '@tanstack/angular-query-experimental';
import * as c from '@liass-ohada/shared/restaurants';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { RestaurantsQueries } from '../../data-access/restaurants.queries';
import { RestaurantOrdersQueries } from '../../data-access/restaurant-orders.queries';
import { OrderCommand, orderCommands } from '../../data-access/restaurant-orders.api';
import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { restaurantOperationalPrice } from '../../utils/restaurant-money';

type Intent = { kind: OrderCommand; input: Record<string, unknown>; order?: string; item?: string };
@Component({
  selector: 'liass-restaurant-order-composer',
  host: { class: 'block min-w-0' },
  imports: [
    LiassSearchableSelectComponent,
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    LiassCardComponent,
    TranslocoModule,
  ],
  templateUrl: './restaurant-order-composer.html',
})
export class RestaurantOrderComposer {
  readonly session = input<c.GuestSessionRead | null>(null);
  readonly accessValid = input(true);
  readonly outletId = input.required<string>();
  readonly sessionId = input.required<string>();
  private readonly auth = inject(AuthStore);
  private readonly scope = inject(RestaurantsQueries);
  readonly queries = inject(RestaurantOrdersQueries);
  private readonly t = inject(TranslocoService);
  private readonly notifications = inject(NotificationService);
  private destroyed = false;
  private focusTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly focusRequest = signal<string | null>(null);
  readonly orderPanelFits = signal(false);
  private orderRegion: HTMLElement | null = null;
  private orderResize?: ResizeObserver;
  private readonly measureOrderRegion = () => {
    const region = this.orderRegion;
    const top = region ? Number.parseFloat(getComputedStyle(region).top) || 0 : 0;
    this.orderPanelFits.set(!!region && region.scrollHeight + top + 12 <= window.innerHeight);
  };
  readonly ctx = computed(() => ({
    org: this.scope.scope(),
    user: this.scope.userScope(),
    revision: this.auth.contextRevision?.() ?? 0,
    outlet: this.outletId(),
    session: this.sessionId(),
  }));
  readonly identity = computed(() => JSON.stringify(this.ctx()));
  readonly denied = signal(false);
  readonly live = computed(() => {
    const s = this.session(),
      ctx = this.ctx();
    return (
      !!s &&
      this.accessValid() &&
      !this.denied() &&
      s.status === 'OPEN' &&
      s.orgId === ctx.org &&
      s.outletId === ctx.outlet &&
      s.guestSessionId === ctx.session
    );
  });
  readonly ordersQuery = injectInfiniteQuery(() => this.queries.orders(this.ctx(), this.live()));
  readonly orders = computed(() =>
    this.ordersQuery.isSuccess()
      ? this.ordersQuery.data()!.pages.flatMap((page) => page.items)
      : [],
  );
  readonly candidates = computed(() => this.orders().filter((order) => this.editable(order)));
  readonly choice = signal<{ context: string; id: string } | null>(null);
  readonly selectedId = computed(() => {
    const choice = this.choice();
    if (choice?.context === this.identity() && this.orders().some((o) => o.orderId === choice.id))
      return choice.id;
    return this.candidates().length === 1
      ? this.candidates()[0].orderId
      : this.orders().length === 1
        ? this.orders()[0].orderId
        : '';
  });
  readonly orderQuery = injectQuery(() =>
    this.queries.order(this.ctx(), this.selectedId(), this.live()),
  );
  readonly order = computed(() =>
    this.orderQuery.isSuccess() && this.orderQuery.data()?.orderId === this.selectedId()
      ? this.orderQuery.data()!
      : null,
  );
  readonly itemsQuery = injectInfiniteQuery(() =>
    this.queries.items(this.ctx(), this.selectedId(), this.live()),
  );
  readonly lines = computed(() =>
    this.itemsQuery.isSuccess() ? this.itemsQuery.data()!.pages.flatMap((page) => page.items) : [],
  );
  readonly drafts = computed(() => this.lines().filter((line) => line.status === 'DRAFT'));
  readonly rounds = computed(() => {
    const groups = new Map<string, c.RestaurantOrderItem[]>();
    for (const line of this.lines())
      if (line.status === 'ACCEPTED' && line.snapshot)
        groups.set(line.snapshot.submissionId, [
          ...(groups.get(line.snapshot.submissionId) ?? []),
          line,
        ]);
    return [...groups.values()].sort((a, b) =>
      a[0].snapshot!.acceptedAt.localeCompare(b[0].snapshot!.acceptedAt),
    );
  });
  readonly menuQuery = injectQuery(() => this.queries.menu(this.ctx(), this.live()));
  private readonly carteQueries = inject(RestaurantCarteQueries);
  readonly carteContext = computed(() => ({
    ...this.ctx(),
    menu: this.menuQuery.data()?.id ?? '',
  }));
  readonly hydrationBudget = signal({ pages: CARTE_PAGE_BUDGET, bytes: CARTE_BYTE_BUDGET });
  // Cached query callbacks retain the small budget signal, never this page/DOM.
  private readonly restartCarteBudget = this.hydrationBudget.set.bind(this.hydrationBudget, {
    pages: CARTE_PAGE_BUDGET,
    bytes: CARTE_BYTE_BUDGET,
  });
  readonly menuItemsQuery = injectInfiniteQuery(() =>
    this.carteQueries.pages(
      this.carteContext(),
      this.live() && !!this.menuQuery.data()?.isActive,
      this.hydrationBudget,
      this.restartCarteBudget,
    ),
  );
  readonly displayCount = signal(50);
  readonly foreground = signal(document.visibilityState !== 'hidden' && navigator.onLine);
  readonly budgetReached = computed(() => {
    const pages = this.menuItemsQuery.data()?.pages ?? [],
      budget = this.hydrationBudget();
    return pages.length >= budget.pages || carteBytes(pages) >= budget.bytes;
  });
  readonly incomplete = computed(() => !!this.menuItemsQuery.data()?.pages.at(-1)?.nextCursor);
  continueCarte() {
    const pages = this.menuItemsQuery.data()?.pages ?? [];
    this.hydrationBudget.set({
      pages: pages.length + CARTE_PAGE_BUDGET,
      bytes: carteBytes(pages) + CARTE_BYTE_BUDGET,
    });
    void this.menuItemsQuery.fetchNextPage();
  }
  readonly orderControl = new FormControl('', { nonNullable: true });
  readonly orderOptions = computed(() =>
    this.orders().map((order) => ({
      value: order.orderId,
      label:
        new Date(order.createdAt).toLocaleString(this.t.getActiveLang()) +
        ' · ' +
        this.t.translate('RESTAURANTS.ORDER_TAKING.STATUS.' + order.status),
    })),
  );
  readonly search = new FormControl('', { nonNullable: true });
  readonly searchText = signal('');
  readonly indexedItems = computed(() =>
    [
      ...new Map(
        (this.menuItemsQuery.data()?.pages ?? [])
          .flatMap((page) => page.items)
          .map((item) => [item.id, item]),
      ).values(),
    ].map((item) => ({ item, tokens: carteTokens(item.name) })),
  );
  readonly matchingItems = computed(() => {
    const query = carteTokens(this.searchText());
    return this.indexedItems()
      .filter((row) => matchesCarteTokens(row.tokens, query))
      .map((row) => row.item);
  });
  readonly menuItems = computed(() => this.matchingItems().slice(0, this.displayCount()));
  readonly names = signal<Record<string, string>>({});
  readonly busy = signal(false);
  readonly addingItem = signal<string | null>(null);
  readonly pending = signal<Intent | null>(null);
  readonly message = signal('');
  readonly quantityError = signal('');
  private readonly quantityInputs = new Map<
    string,
    {
      control: FormControl<string>;
      line: c.RestaurantOrderItem;
      orderVersion: number;
      context: string;
    }
  >();
  readonly quantityMax = c.EditRestaurantDraftItemRequestSchema.shape.quantity.maxValue!;
  lineCountKey(count: number) {
    return (
      'RESTAURANTS.ORDER_TAKING.' +
      (count === 0 ? 'LINES_ZERO' : count === 1 ? 'LINES_ONE' : 'LINES_MANY')
    );
  }
  quantityInput(line: c.RestaurantOrderItem) {
    let entry = this.quantityInputs.get(line.itemId);
    if (!entry || entry.context !== this.identity() || entry.line.version !== line.version) {
      entry = {
        control: new FormControl(String(line.quantity), {
          nonNullable: true,
          validators: (control) =>
            /^\d+$/.test(control.value) &&
            c.EditRestaurantDraftItemRequestSchema.shape.quantity.safeParse(Number(control.value))
              .success
              ? null
              : { quantity: true },
        }),
        line: { ...line },
        orderVersion: this.order()?.version ?? 0,
        context: this.identity(),
      };
      this.quantityInputs.set(line.itemId, entry);
    }
    return entry.control;
  }
  beginQuantity(line: c.RestaurantOrderItem) {
    this.quantityInput(line);
    const entry = this.quantityInputs.get(line.itemId)!;
    entry.line = { ...line };
    entry.orderVersion = this.order()?.version ?? 0;
    this.quantityError.set('');
  }
  async commitQuantity(line: c.RestaurantOrderItem) {
    const entry = this.quantityInputs.get(line.itemId);
    if (!entry || entry.context !== this.identity()) return;
    const value = Number(entry.control.value);
    if (entry.control.invalid) {
      entry.control.setValue(String(entry.line.quantity));
      this.quantityError.set(
        this.t.translate('RESTAURANTS.ORDER_TAKING.INVALID_QUANTITY', { name: this.name(line) }),
      );
      return;
    }
    // Reset immediately: Enter followed by blur must never enqueue the same edit twice.
    entry.control.setValue(String(entry.line.quantity));
    if (value === entry.line.quantity) return;
    await this.setQuantity(entry.line, value, entry.orderVersion);
  }
  readonly ready = computed(
    () =>
      this.live() &&
      !this.busy() &&
      !this.pending() &&
      this.ordersQuery.isSuccess() &&
      !this.ordersQuery.isFetching() &&
      !this.ordersQuery.hasNextPage() &&
      (!this.selectedId() ||
        (this.order() &&
          !this.orderQuery.isFetching() &&
          this.itemsQuery.isSuccess() &&
          !this.itemsQuery.isFetching() &&
          !this.itemsQuery.hasNextPage())),
  );
  readonly canAdd = computed(
    () =>
      this.ready() &&
      (this.candidates().length === 0 ||
        (!!this.order() && this.editable(this.order()!) && this.drafts().length < 12)),
  );
  readonly canSubmit = computed(
    () =>
      this.ready() &&
      !!this.order() &&
      this.editable(this.order()!) &&
      this.drafts().length > 0 &&
      this.drafts().length <= 12,
  );
  private contextAtStart = '';
  private storageKey = '';
  private intentStorage() {
    const c = this.ctx();
    return 'liass-order-intent:' + JSON.stringify([c.user, c.org, c.outlet, c.session]);
  }
  private saveIntent(intent: Intent | null) {
    this.pending.set(intent);
    try {
      if (intent) sessionStorage.setItem(this.intentStorage(), JSON.stringify(intent));
      else sessionStorage.removeItem(this.intentStorage());
    } catch {
      /* Per-tab in-memory replay remains available when storage is unavailable. */
    }
  }
  constructor() {
    afterEveryRender(() => {
      const region = this.host.nativeElement.querySelector<HTMLElement>('[data-order-region]');
      if (region !== this.orderRegion) {
        this.orderResize?.disconnect();
        this.orderRegion = region;
        if (region && typeof ResizeObserver !== 'undefined') {
          this.orderResize = new ResizeObserver(this.measureOrderRegion);
          this.orderResize.observe(region);
        }
      }
      this.measureOrderRegion();
      clearTimeout(this.focusTimer);
      const label = this.focusRequest(),
        identity = this.identity();
      if (label === null || this.busy() || !this.live() || (!this.ready() && !this.pending()))
        return;
      // Query observers can render again after invalidation resolves. Restore
      // focus only after that render burst, rather than focusing a removed node.
      this.focusTimer = setTimeout(() => {
        if (!this.same(identity) || !this.live() || this.busy()) return;
        const target = label
          ? [...this.host.nativeElement.querySelectorAll<HTMLElement>('[aria-label]')].find(
              (el) => el.getAttribute('aria-label') === label && !el.matches(':disabled'),
            )
          : null;
        const destination =
          target ?? this.host.nativeElement.querySelector<HTMLElement>('#draft-title');
        if (destination) {
          destination.focus({ preventScroll: true });
          this.focusRequest.set(null);
        }
      }, 100);
    });
    const orderSub = this.orderControl.valueChanges.subscribe((value) => this.choose(value));
    effect(() => {
      this.orderControl.setValue(this.selectedId(), { emitEvent: false });
      if (this.busy() || this.pending()) this.orderControl.disable({ emitEvent: false });
      else this.orderControl.enable({ emitEvent: false });
    });
    const sub = this.search.valueChanges.subscribe((value) => {
      this.searchText.set(value);
      this.displayCount.set(50);
    });
    const visibility = () =>
      this.foreground.set(document.visibilityState !== 'hidden' && navigator.onLine);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', visibility);
    window.addEventListener('offline', visibility);
    effect(() => {
      if (
        this.live() &&
        this.foreground() &&
        this.menuItemsQuery.hasNextPage() &&
        !this.menuItemsQuery.isFetching() &&
        !this.menuItemsQuery.isError() &&
        !this.budgetReached()
      )
        void this.menuItemsQuery.fetchNextPage();
    });
    window.addEventListener('resize', this.measureOrderRegion);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', visibility);
      window.removeEventListener('offline', visibility);
      this.orderResize?.disconnect();
      window.removeEventListener('resize', this.measureOrderRegion);
      clearTimeout(this.focusTimer);
      sub.unsubscribe();
      orderSub.unsubscribe();
      this.destroyed = true;
    });
    effect(() => {
      const identity = this.identity();
      if (identity !== this.contextAtStart) {
        try {
          if (this.storageKey) sessionStorage.removeItem(this.storageKey);
        } catch {}
        this.contextAtStart = identity;
        this.focusRequest.set(null);
        this.choice.set(null);
        this.displayCount.set(50);
        this.hydrationBudget.set({ pages: CARTE_PAGE_BUDGET, bytes: CARTE_BYTE_BUDGET });
        this.pending.set(null);
        this.busy.set(false);
        this.addingItem.set(null);
        this.denied.set(false);
        this.message.set('');
        this.names.set({});
        this.quantityInputs.clear();
        this.quantityError.set('');
        this.search.setValue('');
        this.storageKey = this.intentStorage();
        try {
          const saved = JSON.parse(
            sessionStorage.getItem(this.storageKey) ?? 'null',
          ) as Intent | null;
          if (
            saved &&
            Object.hasOwn(orderCommands, saved.kind) &&
            orderCommands[saved.kind].safeParse(saved.input).success
          ) {
            this.pending.set(saved);
            this.message.set(saved.kind === 'create' ? 'CREATE_RETRY' : 'RETRY');
          }
        } catch {
          try {
            sessionStorage.removeItem(this.storageKey);
          } catch {}
        }
      }
    });
    effect(() => {
      const ctx = this.ctx(),
        identity = this.identity(),
        drafts = this.drafts();
      // Only visible draft references need current names; accepted content uses snapshots.
      void (async () => {
        for (let offset = 0; offset < drafts.length; offset += 4) {
          const batch = await Promise.all(
            drafts.slice(offset, offset + 4).map(async (line) => {
              try {
                return [
                  line.itemId,
                  await this.queries.draftName(ctx, line.categoryId, line.menuItemId),
                ] as const;
              } catch {
                return [line.itemId, ''] as const;
              }
            }),
          );
          if (!this.same(identity)) return;
          this.names.update((names) => ({ ...names, ...Object.fromEntries(batch) }));
        }
      })();
    });
    effect(() => {
      if (!this.accessValid() || this.session()?.status === 'CLOSED') {
        this.saveIntent(null);
        this.focusRequest.set(null);
      }
    });
    effect(() => {
      const errors = [
        this.ordersQuery.error(),
        this.orderQuery.error(),
        this.itemsQuery.error(),
        this.menuItemsQuery.error(),
        this.menuQuery.error(),
      ];
      if (
        errors.some(
          (error) => error instanceof HttpErrorResponse && [401, 403, 404].includes(error.status),
        )
      )
        this.denied.set(true);
    });
  }
  private same(identity: string) {
    return !this.destroyed && identity === this.identity();
  }
  editable(order: c.RestaurantOrder) {
    return order.status === 'DRAFT' || order.status === 'SUBMITTED';
  }
  price(amount: number, currency: string) {
    return restaurantOperationalPrice(
      amount,
      currency,
      this.t.getActiveLang(),
      this.session()?.currency,
    );
  }
  name(line: c.RestaurantOrderItem) {
    return this.names()[line.itemId] || this.t.translate('RESTAURANTS.ORDER_TAKING.UNKNOWN_ITEM');
  }
  jump(id: 'draft-title' | 'menu-title') {
    const heading = this.host.nativeElement.querySelector<HTMLElement>('#' + id);
    heading?.scrollIntoView({ block: 'start' });
    heading?.focus({ preventScroll: true });
  }
  choose(id: string) {
    if (!this.busy() && !this.pending()) this.choice.set({ context: this.identity(), id });
  }
  private equivalentDraft(
    item: Pick<CarteItem, 'id' | 'name' | 'categoryId' | 'version' | 'availability'>,
  ) {
    return this.drafts().find(
      (line) =>
        line.menuItemId === item.id &&
        line.categoryId === item.categoryId &&
        !line.notes?.trim() &&
        line.expectedMenuItemVersion === item.version,
    );
  }
  canAddItem(item: Pick<CarteItem, 'id' | 'name' | 'categoryId' | 'version' | 'availability'>) {
    const equivalent = this.equivalentDraft(item);
    return (
      !this.addingItem() &&
      item.availability === 'AVAILABLE' &&
      (equivalent
        ? this.ready() &&
          !!this.order() &&
          this.editable(this.order()!) &&
          Number.isSafeInteger(equivalent.quantity + 1)
        : this.canAdd())
    );
  }
  async add(item: Pick<CarteItem, 'id' | 'name' | 'categoryId' | 'version' | 'availability'>) {
    if (!this.canAddItem(item)) return;
    const identity = this.identity();
    const focusLabel = document.activeElement?.getAttribute('aria-label');
    this.addingItem.set(item.id);
    try {
      await this.performAdd(item);
    } finally {
      if (this.same(identity)) {
        this.addingItem.set(null);
        // A disabled Add button may lose native focus. Never steal focus from
        // someone who continued browsing or changed category during the request.
        if (
          document.activeElement === document.body &&
          focusLabel &&
          [...this.host.nativeElement.querySelectorAll('[aria-label]')].some(
            (el) => el.getAttribute('aria-label') === focusLabel,
          )
        )
          this.focusRequest.set(focusLabel);
      }
    }
  }
  private async performAdd(
    item: Pick<CarteItem, 'id' | 'name' | 'categoryId' | 'version' | 'availability'>,
  ) {
    const equivalent = this.equivalentDraft(item);
    if (equivalent) {
      await this.quantity(equivalent, 1);
      return;
    }
    let order = this.order() && this.editable(this.order()!) ? this.order() : null;
    const ctx = this.ctx(),
      identity = this.identity();
    let created = false;
    if (!order) {
      const result = await this.run({
        kind: 'create',
        input: {
          clientRequestId: crypto.randomUUID(),
          orderType: 'DINE_IN',
          guestSessionId: this.sessionId(),
        },
      });
      if (
        !result ||
        !this.same(identity) ||
        !('orderId' in result) ||
        'itemId' in result ||
        !this.live()
      )
        return;
      order = result;
      created = true;
      this.choice.set({ context: this.identity(), id: order.orderId });
    }
    const added = await this.run({
      kind: 'add',
      order: order.orderId,
      input: {
        clientRequestId: crypto.randomUUID(),
        expectedVersion: order.version,
        menuItemId: item.id,
        categoryId: item.categoryId,
        quantity: 1,
        expectedMenuItemVersion: item.version,
      },
    });
    if (created && this.same(identity)) {
      if (!added) this.message.set('PARTIAL_CREATE');
      await this.queries.changed(ctx, order.orderId, true, true);
    }
  }
  async quantity(line: c.RestaurantOrderItem, delta: number) {
    await this.setQuantity(line, line.quantity + delta);
  }
  private async setQuantity(
    line: c.RestaurantOrderItem,
    value: number,
    orderVersion = this.order()?.version,
  ) {
    const order = this.order();
    if (
      !this.ready() ||
      !order ||
      !this.editable(order) ||
      line.orderId !== order.orderId ||
      line.status !== 'DRAFT' ||
      !c.EditRestaurantDraftItemRequestSchema.shape.quantity.safeParse(value).success
    )
      return;
    this.quantityError.set('');
    await this.run({
      kind: 'edit',
      order: order.orderId,
      item: line.itemId,
      input: {
        clientRequestId: crypto.randomUUID(),
        expectedVersion: orderVersion,
        expectedItemVersion: line.version,
        menuItemId: line.menuItemId,
        categoryId: line.categoryId,
        quantity: value,
        notes: line.notes,
        expectedMenuItemVersion: line.expectedMenuItemVersion,
      },
    });
  }
  async remove(line: c.RestaurantOrderItem) {
    const order = this.order();
    if (!this.ready() || !order || !this.editable(order) || line.status !== 'DRAFT') return;
    await this.run({
      kind: 'remove',
      order: order.orderId,
      item: line.itemId,
      input: {
        clientRequestId: crypto.randomUUID(),
        expectedVersion: order.version,
        expectedItemVersion: line.version,
        reason: this.t.translate('RESTAURANTS.ORDER_TAKING.REMOVAL_REASON'),
      },
    });
  }
  async submit() {
    if (!this.canSubmit()) return;
    await this.run({
      kind: 'submit',
      order: this.order()!.orderId,
      input: {
        clientRequestId: crypto.randomUUID(),
        expectedVersion: this.order()!.version,
        items: this.drafts().map((line) => ({
          itemId: line.itemId,
          expectedVersion: line.version,
        })),
      },
    });
  }
  async retry() {
    const intent = this.pending();
    if (!intent || this.busy() || !this.live()) return;
    const ctx = this.ctx(),
      identity = this.identity(),
      order = intent.order ?? (this.selectedId() || undefined);
    this.busy.set(true);
    try {
      // Reconcile the captured Order without making the parent session disappear
      // during this retry. Scoped reads and the command recheck OPEN service access.
      await this.queries.changed(ctx, order, false);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!this.same(identity)) return;
      this.busy.set(false);
      if (this.live()) await this.run(intent);
    } finally {
      if (this.same(identity)) this.busy.set(false);
    }
  }
  async refresh() {
    const ctx = this.ctx(),
      identity = this.identity();
    await Promise.all([
      this.queries.changed(ctx, this.selectedId() || undefined, true),
      this.queries.menuChanged(ctx, ''),
    ]);
    if (this.same(identity)) this.denied.set(false);
  }
  private async run(intent: Intent) {
    if (this.busy() || !this.live()) return null;
    const ctx = this.ctx(),
      identity = this.identity();
    const focusLabel = document.activeElement?.getAttribute('aria-label');
    this.busy.set(true);
    this.saveIntent(intent);
    this.message.set('');
    try {
      const result = await this.queries.api.command(
        ctx,
        intent.kind,
        intent.input,
        intent.order,
        intent.item,
      );
      if (!this.same(identity)) return null;
      this.saveIntent(null);
      if (intent.kind === 'create' && 'orderId' in result)
        this.choice.set({ context: identity, id: result.orderId });
      await this.queries.changed(
        ctx,
        intent.order ?? ('orderId' in result ? result.orderId : undefined),
        intent.kind === 'submit',
        true,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!this.same(identity)) return null;
      if (intent.kind === 'submit')
        this.notifications.success(this.t.translate('RESTAURANTS.ORDER_TAKING.SUBMITTED'));
      return result;
    } catch (error) {
      if (!this.same(identity)) return null;
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      if ([401, 403, 404].includes(status)) {
        this.denied.set(true);
        this.saveIntent(null);
      } else if (status >= 400 && status < 500) {
        this.saveIntent(null);
        this.message.set(
          status === 409
            ? error instanceof HttpErrorResponse &&
              error.error?.error?.code === 'RESTAURANTS_CONFIGURATION_CHANGED'
              ? 'MENU_CONFLICT'
              : 'CONFLICT'
            : 'REJECTED',
        );
      } else this.message.set(intent.kind === 'create' ? 'CREATE_RETRY' : 'RETRY');
      this.notifications.error(
        safeMessageFromError(error) ??
          this.t.translate('RESTAURANTS.ORDER_TAKING.' + (this.message() || 'ACCESS')),
      );
      await Promise.allSettled([
        this.queries.changed(ctx, intent.order, true),
        ...(this.message() === 'MENU_CONFLICT' ? [this.queries.menuChanged(ctx, '')] : []),
      ]);
      return null;
    } finally {
      if (this.same(identity)) {
        this.busy.set(false);
        if (!this.addingItem()) this.focusRequest.set(focusLabel ?? '');
      }
    }
  }
}
