import { RestaurantSessionReconciliation } from '../data-access/restaurant-session-reconciliation';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantOrderComposer } from '../ui/order-composer/restaurant-order-composer';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { RestaurantIdSchema } from '@liass-ohada/shared/restaurants';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { LiassSkeletonComponent } from '../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../shared/ui/status-chip/status-chip.component';
import { restaurantOperationalPrice } from '../utils/restaurant-money';
import { serviceDuration } from '../utils/service-duration';
import { tableDisplayName } from '../utils/table-display-name';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';

@Component({
  selector: 'liass-restaurant-table-workspace',
  host: { class: 'block min-w-0' },
  imports: [
    RestaurantOrderComposer,
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    TranslocoModule,
    LiassSkeletonComponent,
    LiassStatusChipComponent,
    LiassCardComponent,
  ],
  templateUrl: './restaurant-table-workspace.page.html',
})
export class RestaurantTableWorkspacePage {
  readonly tableDisplayName = tableDisplayName;
  readonly queries = inject(RestaurantsQueries);
  private readonly auth = inject(AuthStore);
  private readonly reconciliation = inject(RestaurantSessionReconciliation);
  readonly reconciling = computed(() =>
    this.reconciliation.contains({
      org: this.queries.scope(),
      user: this.queries.userScope(),
      revision: this.auth.contextRevision?.() ?? 0,
      outlet: this.outletId(),
      session: this.sessionId(),
    }),
  );
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly access = inject(ProductAccessState);
  private readonly route = inject(ActivatedRoute);
  readonly t = inject(TranslocoService);
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly params = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  readonly filters = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly outletId = computed(() => this.params().get('outletId') ?? '');
  readonly sessionId = computed(() => this.params().get('guestSessionId') ?? '');
  readonly valid = computed(
    () =>
      RestaurantIdSchema.safeParse(this.outletId()).success &&
      RestaurantIdSchema.safeParse(this.sessionId()).success,
  );
  readonly allowed = computed(
    () => this.caps.canReadSession() && this.access.availability('RESTAURANTS') === 'AVAILABLE',
  );
  readonly query = injectQuery(() =>
    this.queries.guestSession(this.outletId(), this.sessionId(), this.allowed() && this.valid()),
  );
  // Retain current content only for scoped command reconciliation, never for an
  // independent authorization refresh or a different principal/tenant revision.
  readonly session = computed(() => {
    const data = this.query.data();
    return this.allowed() &&
      this.valid() &&
      this.query.isSuccess() &&
      (!this.query.isFetching() || this.reconciling()) &&
      data?.orgId === this.queries.scope() &&
      data.outletId === this.outletId() &&
      data.guestSessionId === this.sessionId()
      ? data
      : null;
  });
  readonly backParams = computed(() => {
    const session = this.session();
    return session
      ? {
          outlet: session.outletId,
          area: this.filters().get('area') === session.areaId ? session.areaId : undefined,
        }
      : {};
  });
  readonly errorKey = computed(() => {
    if (!this.valid()) return 'INVALID';
    if (!this.allowed()) return 'ACCESS';
    const error = this.query.error();
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401 || error.status === 403) return 'ACCESS';
      if (error.status === 404) return 'UNAVAILABLE';
      if (error.status === 400) return 'INVALID';
    }
    return 'LOAD';
  });
  readonly now = signal(Date.now());
  readonly amount = computed(() => {
    const session = this.session();
    return session
      ? restaurantOperationalPrice(
          session.dueMinor,
          session.currency,
          this.t.getActiveLang(),
          session.currency,
        )
      : '';
  });
  duration() {
    const session = this.session();
    if (!session) return '';
    const value = serviceDuration(session.openedAt, this.now());
    return this.t.translate(value.key, value.values);
  }
  readonly responsibleName = computed(
    () =>
      this.session()?.responsibleStaff?.displayName || this.t.translate('RESTAURANTS.TEAM.UNNAMED'),
  );
  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    afterRenderEffect(() => {
      this.params();
      const heading = this.host.nativeElement.querySelector('h1');
      heading?.setAttribute('tabindex', '-1');
      heading?.focus({ preventScroll: true });
    });
  }
}
