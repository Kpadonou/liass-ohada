import type { ProductCode } from '@liass-ohada/shared/shared';
import { UiStore, type AppPage } from '../state/ui.store';
import { ProductAccessState } from '../product-access/product-access.state';
import { AuthStore } from '../../domains/identity/data-access/auth.store';
import { SalesCapabilities } from '../../domains/sales/data-access/sales-capabilities';

import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

export const restaurantSections = [
  { path: 'setup', kind: 'restaurant', icon: 'storefront' },
  { path: 'setup/locations', kind: 'outlet', icon: 'location_on' },
  { path: 'setup/areas', kind: 'area', icon: 'grid_view' },
  { path: 'setup/tables', kind: 'table', icon: 'table_restaurant' },
  { path: 'setup/stations', kind: 'station', icon: 'soup_kitchen' },
] as const;

@Injectable({ providedIn: 'root' })
export class ShellRouteContext {
  private readonly router = inject(Router);
  readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects.split(/[?#]/)[0].replace(/\/$/, '')),
    ),
    { initialValue: this.router.url.split(/[?#]/)[0].replace(/\/$/, '') },
  );
  restaurantKey(): string {
    if (this.url() === '/restaurants/service') return 'service';
    return this.url() === '/restaurants/menu'
      ? 'menu'
      : (restaurantSections.find((section) => this.url() === '/restaurants/' + section.path)
          ?.kind ?? 'overview');
  }
}

export const shellProducts = [
  {
    code: 'ACCOUNTING',
    icon: 'account_balance',
    labelKey: 'SHELL.NAV.ACCOUNTING',
    route: '/dashboard',
  },
  { code: 'SALES', icon: 'storefront', labelKey: 'SHELL.NAV.SALES', route: '/sales' },
  {
    code: 'RESTAURANTS',
    icon: 'restaurant',
    labelKey: 'SHELL.NAV.RESTAURANTS',
    route: '/restaurants',
  },
] as const;
export type ShellProduct = (typeof shellProducts)[number];

export function productForPage(page: AppPage): ProductCode | null {
  if (page === 'restaurants') return 'RESTAURANTS';
  if (page.startsWith('sales.')) return 'SALES';
  if (
    page === 'dashboard' ||
    page.startsWith('accounting.') ||
    page === 'projects' ||
    page === 'treasury'
  )
    return 'ACCOUNTING';
  return null;
}

/** Presentation only: ProductAccess and domain guards remain authoritative. */
@Injectable({ providedIn: 'root' })
export class ShellProductNavigation {
  private readonly auth = inject(AuthStore);
  private readonly access = inject(ProductAccessState);
  private readonly sales = inject(SalesCapabilities);
  private readonly ui = inject(UiStore);
  readonly routeProduct = computed(() => productForPage(this.ui.currentPage()));
  readonly products = computed(() =>
    !this.auth.effectiveOrgId()
      ? []
      : shellProducts.filter(
          (product) =>
            this.access.availability(product.code) === 'AVAILABLE' &&
            (product.code !== 'SALES' || this.sales.canRead()),
        ),
  );
  readonly activeProduct = computed(
    () =>
      this.products().find((product) => product.code === this.routeProduct()) ??
      (this.routeProduct() ? null : (this.products()[0] ?? null)),
  );
}
