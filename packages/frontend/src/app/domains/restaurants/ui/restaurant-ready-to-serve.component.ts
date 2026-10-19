import { safeMessageFromError } from '../../../core/notifications/notification-message';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  ElementRef,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { PreparationRead } from '@liass-ohada/shared/restaurants';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';
import { ServiceOrderContext } from '../data-access/restaurant-orders.api';
import {
  RestaurantServicePreparationQueries,
  servicePreparationKey,
} from '../data-access/restaurant-service-preparation.queries';
@Component({
  selector: 'liass-restaurant-ready-to-serve',
  host: { class: 'block min-w-0' },
  imports: [LiassCardComponent, MatButtonModule, MatIconModule, TranslocoModule],
  templateUrl: './restaurant-ready-to-serve.component.html',
})
export class RestaurantReadyToServeComponent {
  readonly context = input.required<ServiceOrderContext>();
  readonly order = input.required<string>();
  readonly enabled = input.required<boolean>();
  readonly denied = output<void>();
  readonly queries = inject(RestaurantServicePreparationQueries);
  private readonly t = inject(TranslocoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly identity = computed(() =>
    JSON.stringify(servicePreparationKey(this.context(), this.order())),
  );
  readonly query = injectInfiniteQuery(() =>
    this.queries.pages(this.context(), this.order(), this.enabled()),
  );
  readonly blocked = computed(() => {
    const error = this.query.error();
    return error instanceof HttpErrorResponse && [401, 403, 404].includes(error.status);
  });
  readonly tasks = computed(() =>
    this.enabled() && !this.blocked()
      ? (this.query
          .data()
          ?.pages.filter((page) => page.contextKey === this.identity())
          .flatMap((page) => page.items) ?? [])
      : [],
  );
  readonly ready = computed(() => this.tasks().filter((task) => task.state === 'READY'));
  readonly display = signal(50);
  readonly busy = signal<ReadonlySet<string>>(new Set());
  readonly errors = signal<Record<string, string>>({});
  private readonly intents = new Map<string, string>();
  constructor() {
    effect(() => {
      this.identity();
      this.enabled();
      untracked(() => {
        this.busy.set(new Set());
        this.errors.set({});
        this.display.set(50);
      });
    });
    effect(() => {
      const error = this.query.error();
      if (this.enabled() && error instanceof HttpErrorResponse && [401, 403].includes(error.status))
        this.denied.emit();
    });
  }
  key(task: PreparationRead) {
    return [task.itemId, task.fireId, task.version].join(':');
  }
  async serve(task: PreparationRead) {
    const key = this.key(task),
      identity = this.identity(),
      ctx = this.context(),
      order = this.order();
    if (
      !this.enabled() ||
      this.blocked() ||
      this.query.isFetching() ||
      this.busy().has(key) ||
      !this.ready().some((row) => this.key(row) === key)
    )
      return;
    const intent = identity + key;
    let request = this.intents.get(intent);
    if (!request) {
      request = crypto.randomUUID();
      this.intents.set(intent, request);
    }
    const focused = this.host.nativeElement.contains(document.activeElement);
    this.busy.update((set) => new Set([...set, key]));
    this.errors.update((errors) => ({ ...errors, [key]: '' }));
    const same = () => this.enabled() && this.identity() === identity;
    try {
      await this.queries.api.serve(ctx, order, task, request);
      await this.queries.reconcile(ctx, order);
      this.intents.delete(intent);
      if (same() && focused && document.activeElement === document.body)
        this.host.nativeElement
          .querySelector<HTMLElement>('[data-ready-heading]')
          ?.focus({ preventScroll: true });
    } catch (error) {
      if (!same()) return;
      if (error instanceof HttpErrorResponse && [401, 403].includes(error.status)) {
        this.denied.emit();
        return;
      }
      this.errors.update((errors) => ({
        ...errors,
        [key]: safeMessageFromError(error) ?? this.t.translate('RESTAURANTS.SERVING.FAILED'),
      }));
      try {
        await this.queries.reconcile(ctx, order);
      } catch {
        /* Local read feedback remains available. */
      }
    } finally {
      if (same())
        this.busy.update((set) => {
          const next = new Set(set);
          next.delete(key);
          return next;
        });
    }
  }
}
