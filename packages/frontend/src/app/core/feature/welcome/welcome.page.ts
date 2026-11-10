import { Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { CabinetSettingsCapabilities } from '../../../domains/identity/data-access/cabinet-settings-capabilities';
import { RestaurantsCapabilities } from '../../../domains/restaurants/data-access/restaurants-capabilities';
import { SalesCapabilities } from '../../../domains/sales/data-access/sales-capabilities';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';
import { LiassLogoComponent } from '../../../shared/ui/liass-logo/liass-logo.component';
import { ProductAccessQueries } from '../../product-access/product-access.queries';
import { resolveProductAvailability } from '../../product-access/product-availability';
import { welcomeApplicationCatalog, type WelcomeApplication } from './welcome-applications';

@Component({
  selector: 'liass-welcome-page',
  imports: [
    LiassButtonComponent,
    LiassCardComponent,
    LiassLogoComponent,
    MatIconModule,
    TranslocoModule,
  ],
  templateUrl: './welcome.page.html',
})
export class WelcomePage {
  private readonly auth = inject(AuthStore);
  private readonly queries = inject(ProductAccessQueries);
  private readonly sales = inject(SalesCapabilities);
  private readonly restaurants = inject(RestaurantsCapabilities);
  private readonly cabinetSettings = inject(CabinetSettingsCapabilities);
  private readonly router = inject(Router);
  protected readonly access = injectQuery(() => this.queries.list());
  protected readonly workspaceName = this.auth.activeWorkspaceDisplayName;
  protected readonly isLoading = computed(
    () => this.auth.activeWorkspaceType() !== 'ACCOUNTING_FIRM' && this.access.isPending(),
  );
  protected readonly hasError = computed(
    () => this.auth.activeWorkspaceType() !== 'ACCOUNTING_FIRM' && this.access.isError(),
  );
  protected readonly applications = computed<WelcomeApplication[]>(() => {
    const workspace = this.auth.activeWorkspace();
    if (
      !workspace ||
      workspace.orgId !== this.auth.activeWorkspaceOrgId() ||
      workspace.status !== 'ACTIVE'
    )
      return [];
    if (workspace.workspaceType === 'ACCOUNTING_FIRM') {
      const accounting = welcomeApplicationCatalog[0];
      return [
        {
          ...accounting,
          titleKey: 'WELCOME.APPLICATION.ACCOUNTING.FIRM_TITLE',
          descriptionKey: 'WELCOME.APPLICATION.ACCOUNTING.FIRM_DESCRIPTION',
          openRoute: '/cabinet/dashboard',
          configureRoute: '/cabinet/settings',
          canConfigure: this.cabinetSettings.canManageCabinetSettings(),
        },
      ];
    }
    if (!this.access.isSuccess() || this.queries.activeOrgId() !== workspace.orgId) return [];
    return welcomeApplicationCatalog.flatMap((application) => {
      if (resolveProductAvailability(this.access.data(), application.code, true) !== 'AVAILABLE')
        return [];
      if (application.code === 'SALES' && !this.sales.canRead()) return [];
      if (application.code === 'RESTAURANTS' && !this.restaurants.canRead()) return [];
      return [
        {
          ...application,
          canConfigure:
            application.code === 'ACCOUNTING'
              ? workspace.role === 'OWNER' && this.auth.canWriteAccounting()
              : application.code === 'SALES'
                ? this.sales.canWrite()
                : this.restaurants.canManageSetup(),
        },
      ];
    });
  });

  protected open(application: WelcomeApplication): void {
    if (
      !this.applications().some(
        (available) =>
          available.code === application.code && available.openRoute === application.openRoute,
      )
    )
      return;
    void this.router.navigateByUrl(application.openRoute);
  }

  protected configure(application: WelcomeApplication): void {
    if (
      !this.applications().some(
        (available) =>
          available.code === application.code &&
          available.configureRoute === application.configureRoute &&
          available.canConfigure,
      )
    )
      return;
    void this.router.navigateByUrl(application.configureRoute);
  }
}
