import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';

import { UiStore, type AppPage } from '../../../core/state/ui.store';
import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { LiassLogoComponent } from '../../ui/liass-logo/liass-logo.component';
import { LiassSidebarNavItemComponent } from '../../ui/sidebar-nav-item/sidebar-nav-item.component';

interface ShellNavItem {
  badgeKey?: string;
  disabled?: boolean;
  icon: string;
  labelKey: string;
  page: AppPage;
  route?: readonly string[];
}

const accountingItems: readonly ShellNavItem[] = [
  {
    icon: 'account_balance',
    labelKey: 'SHELL.NAV.GENERAL_LEDGER',
    page: 'accounting.generalLedger',
    route: ['/accounting/general-ledger']
  },
  {
    icon: 'menu_book',
    labelKey: 'SHELL.NAV.JOURNALS',
    page: 'accounting.journals',
    route: ['/accounting/journals']
  },
  {
    icon: 'receipt_long',
    labelKey: 'SHELL.NAV.ENTRIES',
    page: 'accounting.entries',
    route: ['/accounting/entries']
  },
  {
    icon: 'balance',
    labelKey: 'SHELL.NAV.TRIAL_BALANCE',
    page: 'accounting.trialBalance',
    route: ['/accounting/trial-balance']
  },
  {
    icon: 'format_list_numbered',
    labelKey: 'SHELL.NAV.CHART_OF_ACCOUNTS',
    page: 'accounting.chartOfAccounts',
    route: ['/accounting/chart-of-accounts']
  }
];

const topLevelItems: readonly ShellNavItem[] = [
  {
    icon: 'dashboard',
    labelKey: 'SHELL.NAV.DASHBOARD',
    page: 'dashboard',
    route: ['/dashboard']
  },
  {
    badgeKey: 'SHELL.NAV.SYCEBNL_BADGE',
    disabled: true,
    icon: 'folder_managed',
    labelKey: 'SHELL.NAV.PROJECTS',
    page: 'projects'
  },
  {
    disabled: true,
    icon: 'payments',
    labelKey: 'SHELL.NAV.TREASURY',
    page: 'treasury'
  },
  {
    disabled: true,
    icon: 'analytics',
    labelKey: 'SHELL.NAV.REPORTS',
    page: 'reports'
  },
  {
    disabled: true,
    icon: 'admin_panel_settings',
    labelKey: 'SHELL.NAV.ADMINISTRATION',
    page: 'administration'
  }
];

const dashboardItems: readonly ShellNavItem[] = topLevelItems.slice(0, 1);
const secondaryItems: readonly ShellNavItem[] = topLevelItems.slice(1);
const cabinetItems: readonly ShellNavItem[] = [
  {
    icon: 'dashboard',
    labelKey: 'SHELL.NAV.CABINET_DASHBOARD',
    page: 'cabinet.dashboard',
    route: ['/cabinet/dashboard']
  },
  {
    icon: 'folder_managed',
    labelKey: 'SHELL.NAV.CLIENT_DOSSIERS',
    page: 'cabinet.dossiers',
    route: ['/cabinet/dossiers']
  },
  {
    disabled: true,
    icon: 'group',
    labelKey: 'SHELL.NAV.COLLABORATORS',
    page: 'cabinet.collaborators'
  },
  {
    disabled: true,
    icon: 'assignment',
    labelKey: 'SHELL.NAV.MISSIONS',
    page: 'cabinet.missions'
  },
  {
    disabled: true,
    icon: 'event_upcoming',
    labelKey: 'SHELL.NAV.DEADLINES',
    page: 'cabinet.deadlines'
  },
  {
    disabled: true,
    icon: 'settings',
    labelKey: 'SHELL.NAV.CABINET_SETTINGS',
    page: 'cabinet.settings'
  }
];

@Component({
  selector: 'liass-app-sidebar',
  imports: [LiassLogoComponent, LiassSidebarNavItemComponent, RouterLink, TranslocoModule],
  templateUrl: './app-sidebar.component.html'
})
export class AppSidebarComponent {
  protected readonly accountingItems = accountingItems;
  protected readonly cabinetItems = cabinetItems;
  protected readonly dashboardItems = dashboardItems;
  protected readonly secondaryItems = secondaryItems;
  protected readonly authStore = inject(AuthStore);
  protected readonly uiStore = inject(UiStore);
  protected readonly cabinetMode = computed(
    () =>
      this.authStore.activeWorkspaceType() === 'ACCOUNTING_FIRM' &&
      !this.authStore.activeDossierOrgId()
  );
  private readonly router = inject(Router);

  protected readonly homeRoute = computed(() =>
    this.cabinetMode() ? '/cabinet/dashboard' : '/dashboard'
  );

  protected sidebarClass(): string {
    const mobileState = this.uiStore.sidebarOpen() ? 'translate-x-0' : '-translate-x-full';
    return `fixed left-0 top-0 z-50 flex h-dvh w-[var(--spacing-shell-sidebar)] flex-col border-r border-slate-200 bg-white px-4 text-slate-950 shadow-app-popover transition-transform duration-300 ease-in-out dark:border-slate-800 dark:bg-slate-900 dark:text-white lg:translate-x-0 lg:shadow-none ${mobileState}`;
  }

  protected async selectItem(item: ShellNavItem): Promise<void> {
    if (item.disabled) {
      return;
    }

    this.uiStore.setCurrentPage(item.page);
    this.uiStore.closeSidebar();

    if (item.route) {
      await this.router.navigate(item.route);
    }
  }
}
