import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { UiStore, type AppPage } from '../../../core/state/ui.store';
import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { AppBackdropComponent } from '../app-backdrop/app-backdrop.component';
import { AppContextBreadcrumbComponent } from '../app-context-breadcrumb/app-context-breadcrumb.component';
import { AppSidebarComponent } from '../app-sidebar/app-sidebar.component';
import { AppTopbarComponent } from '../app-topbar/app-topbar.component';

export function pageFromUrl(url: string): AppPage {
  const path = url.split('?')[0]?.split('#')[0] ?? '';

  if (path.startsWith('/cabinet/dossiers')) {
    return 'cabinet.dossiers';
  }

  if (path.startsWith('/cabinet/team')) {
    return 'cabinet.team';
  }

  if (path.startsWith('/cabinet/settings')) {
    return 'cabinet.settings';
  }

  if (path.startsWith('/cabinet/dashboard')) {
    return 'cabinet.dashboard';
  }

  if (path.startsWith('/accounting/journals')) {
    return 'accounting.journals';
  }

  if (path.startsWith('/accounting/third-parties')) {
    return 'accounting.thirdParties';
  }

  if (
    path === '/accounting' ||
    path === '/accounting/' ||
    path.startsWith('/accounting/reports/simplified')
  ) {
    return 'accounting.overview';
  }

  if (path.startsWith('/accounting/entries')) {
    return 'accounting.entries';
  }

  if (path.startsWith('/accounting/fiscal-years') || path.startsWith('/accounting/fiscal-year')) {
    return 'accounting.fiscalYear';
  }

  if (path.startsWith('/accounting/lettering')) {
    return 'accounting.lettering';
  }

  if (path.startsWith('/accounting/trial-balance')) {
    return 'accounting.trialBalance';
  }

  if (path.startsWith('/accounting/accounts') || path.startsWith('/accounting/chart-of-accounts')) {
    return 'accounting.chartOfAccounts';
  }

  if (path.startsWith('/accounting/general-ledger')) {
    return 'accounting.generalLedger';
  }

  if (path.startsWith('/accounting/auxiliary-ledger')) {
    return 'accounting.auxiliaryLedger';
  }

  if (path.startsWith('/accounting/auxiliary-balance')) {
    return 'accounting.auxiliaryBalance';
  }

  if (path.startsWith('/projects')) {
    return 'projects';
  }

  if (path.startsWith('/treasury')) {
    return 'treasury';
  }

  if (path.startsWith('/reports')) {
    return 'reports';
  }

  if (path.startsWith('/administration')) {
    return 'administration';
  }

  return 'dashboard';
}

@Component({
  selector: 'liass-app-shell',
  imports: [
    AppBackdropComponent,
    AppContextBreadcrumbComponent,
    AppSidebarComponent,
    AppTopbarComponent,
    RouterOutlet,
  ],
  templateUrl: './app-shell.component.html',
})
export class AppShellComponent {
  private readonly authStore = inject(AuthStore);
  protected readonly uiStore = inject(UiStore);
  private readonly router = inject(Router);

  constructor() {
    this.uiStore.applyTheme();
    this.syncCurrentPage(this.router.url);
    void this.redirectRootShell();
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        this.syncCurrentPage(event.urlAfterRedirects);
      });
  }

  private syncCurrentPage(url: string): void {
    this.uiStore.setCurrentPage(pageFromUrl(url));
  }

  protected contentClass(): string {
    const sidebarPadding = this.uiStore.sidebarCollapsed()
      ? 'lg:pl-[var(--spacing-shell-sidebar-collapsed)]'
      : 'lg:pl-[var(--spacing-shell-sidebar)]';

    return `min-h-dvh pt-[var(--spacing-app-header)] transition-[padding] duration-300 ease-in-out ${sidebarPadding}`;
  }

  private async redirectRootShell(): Promise<void> {
    if (this.router.url !== '/') {
      return;
    }

    if (!this.authStore.workspacesLoaded()) {
      await this.authStore.loadWorkspaces();
    }

    const destination = this.authStore.workspaceDestination();

    if (destination) {
      await this.router.navigateByUrl(destination, { replaceUrl: true });
    }
  }
}
