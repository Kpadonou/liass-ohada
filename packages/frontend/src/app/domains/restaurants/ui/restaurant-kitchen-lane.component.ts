import {
  Component,
  input,
  output,
  computed,
  signal,
  inject,
  effect,
  untracked,
} from '@angular/core';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { RestaurantPreparationQueries } from '../data-access/restaurant-preparation.queries';
import {
  KitchenContext,
  KitchenLane,
  KitchenTask,
} from '../data-access/restaurant-preparation.api';
import { restaurantError } from '../utils/restaurant-errors';
import { serviceDuration } from '../utils/service-duration';
@Component({
  selector: 'liass-restaurant-kitchen-lane',
  host: { class: 'block min-w-0' },
  imports: [MatButtonModule, MatIconModule, TranslocoModule],
  templateUrl: './restaurant-kitchen-lane.component.html',
})
export class RestaurantKitchenLaneComponent {
  readonly context = input.required<KitchenContext>();
  readonly station = input.required<string>();
  readonly state = input.required<KitchenLane>();
  readonly now = input.required<number>();
  readonly denied = output<void>();
  private readonly queries = inject(RestaurantPreparationQueries);
  private readonly t = inject(TranslocoService);
  readonly queue = injectInfiniteQuery(() =>
    this.queries.lane(this.context(), this.station(), this.state(), true),
  );
  readonly tasks = computed(
    () =>
      this.queue
        .data()
        ?.pages.filter(
          (page) =>
            page.contextKey === JSON.stringify([this.context(), this.station(), this.state()]),
        )
        .flatMap((page) => page.items) ?? [],
  );
  readonly busy = signal<ReadonlySet<string>>(new Set());
  readonly errors = signal<Record<string, string>>({});
  private readonly intents = new Map<string, string>();
  constructor() {
    effect(() => {
      this.context();
      this.station();
      untracked(() => {
        this.busy.set(new Set());
        this.errors.set({});
      });
    });
    effect(() => {
      const error = this.queue.error();
      if (error instanceof HttpErrorResponse && [401, 403].includes(error.status))
        this.denied.emit();
    });
  }
  key(task: KitchenTask) {
    return [task.orderId, task.itemId, task.fireId, task.version].join(':');
  }
  pending(task: KitchenTask) {
    return this.busy().has(this.key(task));
  }
  duration(task: KitchenTask) {
    const elapsed = serviceDuration(task.queuedAt, this.now());
    return this.t.translate(elapsed.key, elapsed.values);
  }
  message(error: unknown) {
    return restaurantError(error, (key) => this.t.translate(key));
  }
  async act(task: KitchenTask) {
    const key = this.key(task);
    if (this.pending(task) || task.state === 'READY') return;
    const ctx = this.context(),
      station = this.station();
    const identity = JSON.stringify(ctx);
    const action = task.state === 'QUEUED' ? 'start' : 'ready';
    const next = action === 'start' ? 'IN_PROGRESS' : 'READY';
    const intentKey = identity + key + action;
    let request = this.intents.get(intentKey);
    if (!request) {
      request = crypto.randomUUID();
      this.intents.set(intentKey, request);
    }
    this.busy.update((set) => new Set([...set, key]));
    this.errors.update((errors) => ({ ...errors, [key]: '' }));
    try {
      await this.queries.api.command(ctx, task, action, request);
      await this.queries.reconcile(ctx, station, [this.state(), next]);
      this.intents.delete(intentKey);
      if (
        JSON.stringify(this.context()) === identity &&
        this.station() === station &&
        document.activeElement === document.body
      ) {
        const target = document.getElementById('kitchen-' + next);
        (target && target.getBoundingClientRect().width > 0
          ? target
          : document.getElementById('kitchen-' + this.state())
        )?.focus();
      }
    } catch (error) {
      if (JSON.stringify(this.context()) !== identity || this.station() !== station) return;
      if (error instanceof HttpErrorResponse && [401, 403].includes(error.status)) {
        this.denied.emit();
        return;
      }
      this.errors.update((errors) => ({ ...errors, [key]: this.message(error) }));
      await this.queries.reconcile(ctx, station, [this.state(), next]);
    } finally {
      if (JSON.stringify(this.context()) === identity && this.station() === station)
        this.busy.update((set) => {
          const next = new Set(set);
          next.delete(key);
          return next;
        });
    }
  }
}
