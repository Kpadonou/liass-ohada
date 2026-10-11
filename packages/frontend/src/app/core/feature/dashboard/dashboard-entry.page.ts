import { Component, computed, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { ShellProductNavigation } from '../../navigation/product-navigation';
import { ProductAccessQueries } from '../../product-access/product-access.queries';
import { resolveProductAvailability } from '../../product-access/product-availability';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';
import { DashboardPage } from './dashboard.page';

/** /dashboard remains the platform recovery URL; the ERP view requires Accounting access. */
@Component({
  selector: 'liass-dashboard-entry-page',
  imports: [DashboardPage, LiassCardComponent, TranslocoModule],
  template: `
    @if (accountingAvailable()) {
      <liass-dashboard-page />
    } @else if (access.isPending()) {
      <liass-card state="loading" />
    } @else {
      <liass-card [title]="'SHELL.PAGES.DASHBOARD' | transloco">
        <p class="text-sm text-app-text-secondary">
          {{ 'SHELL.TOPBAR.NO_ACCESSIBLE_PRODUCT' | transloco }}
        </p>
      </liass-card>
    }
  `,
})
export class DashboardEntryPage {
  private readonly queries = inject(ProductAccessQueries);
  private readonly navigation = inject(ShellProductNavigation);
  private readonly router = inject(Router);
  protected readonly access = injectQuery(() => this.queries.list());
  protected readonly accountingAvailable = computed(
    () =>
      resolveProductAvailability(this.access.data(), 'ACCOUNTING', this.access.isSuccess()) ===
      'AVAILABLE',
  );
  constructor() {
    effect(() => {
      if (!this.access.isSuccess() || this.accountingAvailable()) return;
      const destination = this.navigation.products()[0];
      if (destination) void this.router.navigateByUrl(destination.route, { replaceUrl: true });
    });
  }
}
