import { Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';
import { LiassLogoComponent } from '../../../shared/ui/liass-logo/liass-logo.component';
import { ProductAccessQueries } from '../../product-access/product-access.queries';
import { welcomeApplicationCatalog, type WelcomeApplication } from './welcome-applications';
import { WelcomeDestination } from './welcome-destination';

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
  private readonly router = inject(Router);
  protected readonly justCreatedWorkspace = history.state?.justCreatedWorkspace === true;
  private readonly destination = inject(WelcomeDestination);
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
          descriptionKey: 'WELCOME.APPLICATION.ACCOUNTING.FIRM_DESCRIPTION',
          route: '/cabinet/dashboard',
        },
      ];
    }
    if (!this.access.isSuccess() || this.queries.activeOrgId() !== workspace.orgId) return [];
    return this.destination.accessibleApplications(this.access.data() ?? []);
  });

  protected open(application: WelcomeApplication): void {
    if (
      !this.applications().some(
        (available) => available.code === application.code && available.route === application.route,
      )
    )
      return;
    void this.router.navigateByUrl(application.route);
  }
}
