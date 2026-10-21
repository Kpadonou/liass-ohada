import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChildren,
  ElementRef,
  Injectable,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { injectInfiniteQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import type { PreparationRead } from '@liass-ohada/shared/restaurants';
import { RestaurantOrdersQueries } from '../data-access/restaurant-orders.queries';
import { ServiceOrderContext } from '../data-access/restaurant-orders.api';
import {
  RestaurantServicePreparationQueries,
  servicePreparationKey,
} from '../data-access/restaurant-service-preparation.queries';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';
import { safeMessageFromError } from '../../../core/notifications/notification-message';

/** Headless observer: TanStack owns canonical pages; signals only derive presentation.
 * At most 10 pages (500 fires) per Order. An exhausted budget never means complete.
 */
@Component({ selector: 'liass-order-delivery-reader', template: '' })
export class RestaurantOrderDeliveryReader {
  readonly context = input<ServiceOrderContext>({
    org: '',
    user: '',
    revision: 0,
    outlet: '',
    session: '',
  });
  readonly order = input('');
  readonly queries = inject(RestaurantServicePreparationQueries);
  readonly query = injectInfiniteQuery(() =>
    this.queries.pages(this.context(), this.order(), true),
  );
  readonly tasks = computed(
    () =>
      this.query
        .data()
        ?.pages.filter(
          (p) =>
            p.contextKey === JSON.stringify(servicePreparationKey(this.context(), this.order())),
        )
        .flatMap((p) => p.items) ?? [],
  );
  readonly complete = computed(
    () => this.query.isSuccess() && !this.query.hasNextPage() && !this.query.isFetching(),
  );
  constructor() {
    effect(() => {
      if (
        this.query.isSuccess() &&
        this.query.hasNextPage() &&
        !this.query.isFetching() &&
        (this.query.data()?.pages.length ?? 0) < 10
      ) {
        untracked(() => {
          void this.query.fetchNextPage();
        });
      }
    });
  }
}

@Component({
  selector: 'liass-restaurant-table-delivery',
  host: { class: 'block min-w-0' },
  imports: [
    RestaurantOrderDeliveryReader,
    MatButtonModule,
    MatIconModule,
    TranslocoModule,
    LiassCardComponent,
  ],
  templateUrl: './restaurant-table-delivery.component.html',
})
export class RestaurantTableDeliveryComponent {
  readonly context = input.required<ServiceOrderContext>();
  readonly enabled = input.required<boolean>();
  readonly expectedOrderCount = input.required<number>();
  readonly denied = output<void>();
  readonly ordersQueries = inject(RestaurantOrdersQueries);
  readonly queries = inject(RestaurantServicePreparationQueries);
  private readonly client = inject(QueryClient);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly t = inject(TranslocoService);
  readonly identity = computed(() => JSON.stringify(this.context()));
  readonly orders = injectInfiniteQuery(() =>
    this.ordersQueries.orders(this.context(), this.enabled()),
  );
  readonly rows = computed(() => this.orders.data()?.pages.flatMap((p) => p.items) ?? []);
  // Bound speculative hydration to 20 active Orders. Individual service remains available.
  readonly activeOrders = computed(() =>
    this.rows()
      .filter((o) => o.status === 'SUBMITTED')
      .slice(0, 20),
  );
  readonly readers = viewChildren(RestaurantOrderDeliveryReader);
  readonly tasks = computed(() =>
    this.enabled() && !this.accessBlocked() ? this.readers().flatMap((r) => r.tasks()) : [],
  );
  readonly ready = computed(() => this.tasks().filter((t) => t.state === 'READY'));
  readonly complete = computed(
    () =>
      this.enabled() &&
      !this.orders.isFetching() &&
      this.orders.isSuccess() &&
      !this.orders.hasNextPage() &&
      this.rows().length === this.expectedOrderCount() &&
      new Set(this.rows().map((o) => o.orderId)).size === this.rows().length &&
      this.rows().filter((o) => o.status === 'SUBMITTED').length <= 20 &&
      this.readers().length === this.activeOrders().length &&
      this.readers().every((r) => r.complete()) &&
      this.tasks().length <= 1000,
  );
  readonly accessBlocked = computed(() =>
    [this.orders.error(), ...this.readers().map((r) => r.query.error())].some(
      (e) => e instanceof HttpErrorResponse && [401, 403, 404].includes(e.status),
    ),
  );
  readonly loading = computed(
    () => this.orders.isFetching() || this.readers().some((r) => r.query.isFetching()),
  );
  readonly failed = computed(
    () => this.orders.isError() || this.readers().some((r) => r.query.isError()),
  );
  readonly busy = signal(false);
  readonly display = signal(50);
  readonly message = signal('');
  readonly error = signal('');
  // Unresolved original payloads survive reconciliation and component recreation in this session.
  private readonly intents = inject(RestaurantDeliveryIntents);
  readonly unresolved = computed(() => this.intents.pending(this.identity()));
  constructor() {
    effect(() => {
      this.identity();
      untracked(() => {
        this.message.set('');
        this.error.set('');
        this.display.set(50);
      });
    });
    effect(() => {
      if (this.enabled() && this.accessBlocked()) this.denied.emit();
      if (
        this.orders.isSuccess() &&
        this.orders.hasNextPage() &&
        !this.orders.isFetching() &&
        (this.orders.data()?.pages.length ?? 0) < 4 &&
        this.rows().length < 200 &&
        !this.busy()
      ) {
        untracked(() => {
          void this.orders.fetchNextPage();
        });
      }
    });
  }
  key(task: PreparationRead) {
    return `${task.orderId}:${task.itemId}:${task.fireId}`;
  }
  async refresh() {
    if (this.busy()) return;
    await Promise.all([this.orders.refetch(), ...this.readers().map((r) => r.query.refetch())]);
  }
  async serve(task: PreparationRead) {
    await this.run([task]);
  }
  async serveAll() {
    if (!this.complete() || this.display() < this.ready().length) return;
    await this.run([...this.ready()]);
  }
  async retry() {
    await this.run(
      this.unresolved().map((i) => i.task),
      true,
    );
  }
  private async run(batch: PreparationRead[], retry = false) {
    const ctx = this.context(),
      identity = this.identity();
    if (
      !this.enabled() ||
      this.accessBlocked() ||
      this.loading() ||
      this.busy() ||
      !batch.length ||
      (!retry && this.unresolved().length)
    )
      return;
    if (
      !retry &&
      batch.some(
        (t) => !this.ready().some((r) => this.key(r) === this.key(t) && r.version === t.version),
      )
    )
      return;
    this.busy.set(true);
    this.message.set('');
    this.error.set('');
    const intents = retry
      ? this.unresolved()
      : batch.map((task) => ({ task: structuredClone(task), request: crypto.randomUUID() }));
    this.intents.set(identity, intents);
    let served = 0;
    const same = () => this.enabled() && this.identity() === identity;
    try {
      for (const intent of intents) {
        if (!same()) break;
        try {
          this.ordersQueries.api.assertContext(ctx);
          await this.queries.api.serve(ctx, intent.task.orderId, intent.task, intent.request);
          served++;
          this.intents.remove(identity, intent.request);
        } catch (e) {
          if (same()) {
            this.error.set(
              safeMessageFromError(e) ?? this.t.translate('RESTAURANTS.SERVING.FAILED'),
            );
            if (e instanceof HttpErrorResponse && [401, 403, 404].includes(e.status))
              this.denied.emit();
            // Definite rejection permits rebuilding this task from canonical state. Ambiguous
            // responses retain the original version/request, even if the read already says SERVED.
            if (
              e instanceof HttpErrorResponse &&
              e.status >= 400 &&
              e.status < 500 &&
              e.status !== 408
            )
              this.intents.remove(identity, intent.request);
          }
          break;
        }
      }
      if (same())
        this.message.set(
          this.t.translate('RESTAURANTS.SERVING.BATCH_RESULT', {
            served,
            remaining: intents.length - served,
          }),
        );
    } finally {
      // One reconciliation phase after serialized writes, including partial success.
      if (same()) {
        try {
          await Promise.all([
            ...[...new Set(batch.map((t) => t.orderId))].flatMap((order) => [
              this.queries.reconcile(ctx, order),
              this.client.invalidateQueries({
                queryKey: this.ordersQueries.key(ctx, 'order', order),
                exact: true,
              }),
            ]),
            this.client.invalidateQueries({
              queryKey: this.ordersQueries.key(ctx, 'orders'),
              exact: true,
            }),
          ]);
          // Unattempted tasks can be retried through the same frozen batch.
        } catch {
          if (same()) this.error.set(this.t.translate('RESTAURANTS.SERVING.LOAD_ERROR'));
        }
      }
      this.busy.set(false);
      if (same() && document.activeElement === document.body)
        this.host.nativeElement
          .querySelector<HTMLElement>('#table-delivery-title')
          ?.focus({ preventScroll: true });
    }
  }
}

type DeliveryIntent = { task: PreparationRead; request: string };
@Injectable({ providedIn: 'root' })
export class RestaurantDeliveryIntents {
  private readonly values = signal<ReadonlyMap<string, DeliveryIntent[]>>(new Map());
  pending(identity: string) {
    return this.values().get(identity) ?? [];
  }
  set(identity: string, intents: DeliveryIntent[]) {
    this.values.update((v) => new Map(v).set(identity, intents));
  }
  remove(identity: string, request: string) {
    this.set(
      identity,
      this.pending(identity).filter((i) => i.request !== request),
    );
  }
}
