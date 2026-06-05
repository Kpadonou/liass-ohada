import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { UiStore, type AppPage } from '../../../core/state/ui.store';
import { AppBackdropComponent } from '../app-backdrop/app-backdrop.component';
import { AppSidebarComponent } from '../app-sidebar/app-sidebar.component';
import { AppTopbarComponent } from '../app-topbar/app-topbar.component';

function pageFromUrl(url: string): AppPage {
  const path = url.split('?')[0]?.split('#')[0] ?? '';

  if (path.startsWith('/accounting/journals')) {
    return 'accounting.journals';
  }

  if (path.startsWith('/accounting/entries')) {
    return 'accounting.entries';
  }

  if (path.startsWith('/accounting/trial-balance')) {
    return 'accounting.trialBalance';
  }

  if (path.startsWith('/accounting/chart-of-accounts')) {
    return 'accounting.chartOfAccounts';
  }

  if (path.startsWith('/accounting/general-ledger')) {
    return 'accounting.generalLedger';
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
  imports: [AppBackdropComponent, AppSidebarComponent, AppTopbarComponent, RouterOutlet],
  templateUrl: './app-shell.component.html'
})
export class AppShellComponent {
  private readonly uiStore = inject(UiStore);
  private readonly router = inject(Router);

  constructor() {
    this.uiStore.applyTheme();
    this.syncCurrentPage(this.router.url);
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe((event) => {
        this.syncCurrentPage(event.urlAfterRedirects);
      });
  }

  private syncCurrentPage(url: string): void {
    this.uiStore.setCurrentPage(pageFromUrl(url));
  }
}
