import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import type { ProductCode } from '@liass-ohada/shared/shared';
import { TranslocoModule } from '@ngneat/transloco';

import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { UiStore, type AppPage } from '../../../core/state/ui.store';
import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { SalesCapabilities } from '../../../domains/sales/data-access/sales-capabilities';
import { CabinetSettingsCapabilities } from '../../../domains/identity/data-access/cabinet-settings-capabilities';
import { LiassSidebarNavItemComponent } from '../../ui/sidebar-nav-item/sidebar-nav-item.component';

interface ShellNavItem {
  badgeKey?: string;
  disabled?: boolean;
  icon: string;
  labelKey: string;
  page: AppPage;
  productCode?: ProductCode;
  route?: string;
}

const accountingItems: readonly ShellNavItem[] = [
  {
    icon: 'space_dashboard',
    labelKey: 'SHELL.NAV.ACCOUNTING_OVERVIEW',
    page: 'accounting.overview',
    productCode: 'ACCOUNTING',
    route: '/accounting'
  },
  {
    icon: 'event_available',
    labelKey: 'SHELL.NAV.FISCAL_YEAR',
    page: 'accounting.fiscalYear',
    productCode: 'ACCOUNTING',
    route: '/accounting/fiscal-years'
  },
  {
    icon: 'account_balance',
    labelKey: 'SHELL.NAV.GENERAL_LEDGER',
    page: 'accounting.generalLedger',
    productCode: 'ACCOUNTING',
    route: '/accounting/general-ledger'
  },
  {
    icon: 'account_tree',
    labelKey: 'SHELL.NAV.AUXILIARY_LEDGER',
    page: 'accounting.auxiliaryLedger',
    productCode: 'ACCOUNTING',
    route: '/accounting/auxiliary-ledger'
  },
  {
    icon: 'diversity_3',
    labelKey: 'SHELL.NAV.AUXILIARY_BALANCE',
    page: 'accounting.auxiliaryBalance',
    productCode: 'ACCOUNTING',
    route: '/accounting/auxiliary-balance'
  },
  {
    icon: 'history_edu',
    labelKey: 'SHELL.NAV.JOURNAL_BOOK',
    page: 'accounting.journalBook',
    productCode: 'ACCOUNTING',
    route: '/accounting/journal-book'
  },
  {
    icon: 'menu_book',
    labelKey: 'SHELL.NAV.JOURNALS',
    page: 'accounting.journals',
    productCode: 'ACCOUNTING',
    route: '/accounting/journals'
  },
  {
    icon: 'groups',
    labelKey: 'SHELL.NAV.THIRD_PARTIES',
    page: 'accounting.thirdParties',
    productCode: 'ACCOUNTING',
    route: '/accounting/third-parties'
  },
  {
    icon: 'receipt_long',
    labelKey: 'SHELL.NAV.ENTRIES',
    page: 'accounting.entries',
    productCode: 'ACCOUNTING',
    route: '/accounting/entries'
  },
  {
    icon: 'rule',
    labelKey: 'SHELL.NAV.LETTERING',
    page: 'accounting.lettering',
    productCode: 'ACCOUNTING',
    route: '/accounting/lettering'
  },
  {
    icon: 'balance',
    labelKey: 'SHELL.NAV.TRIAL_BALANCE',
    page: 'accounting.trialBalance',
    productCode: 'ACCOUNTING',
    route: '/accounting/trial-balance'
  },
  {
    icon: 'format_list_numbered',
    labelKey: 'SHELL.NAV.CHART_OF_ACCOUNTS',
    page: 'accounting.chartOfAccounts',
    productCode: 'ACCOUNTING',
    route: '/accounting/accounts'
  }
];

const topLevelItems: readonly ShellNavItem[] = [
  {
    icon: 'dashboard',
    labelKey: 'SHELL.NAV.DASHBOARD',
    page: 'dashboard',
    route: '/dashboard'
  },
  {
    badgeKey: 'SHELL.NAV.SYCEBNL_BADGE',
    icon: 'folder_managed',
    labelKey: 'SHELL.NAV.PROJECTS',
    page: 'projects',
    productCode: 'ACCOUNTING',
    route: '/projects'
  },
  {
    icon: 'payments',
    labelKey: 'SHELL.NAV.TREASURY',
    page: 'treasury',
    productCode: 'ACCOUNTING',
    route: '/treasury'
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
const salesItems: readonly ShellNavItem[] = [
  {
    icon: 'group',
    labelKey: 'SHELL.NAV.SALES_CUSTOMERS',
    page: 'sales.customers',
    productCode: 'SALES',
    route: '/sales/customers'
  },
  {
    icon: 'category',
    labelKey: 'SHELL.NAV.SALES_ITEMS',
    page: 'sales.items',
    productCode: 'SALES',
    route: '/sales/items'
  }
];
const cabinetItems: readonly ShellNavItem[] = [
  {
    icon: 'dashboard',
    labelKey: 'SHELL.NAV.CABINET_DASHBOARD',
    page: 'cabinet.dashboard',
    route: '/cabinet/dashboard'
  },
  {
    icon: 'folder_managed',
    labelKey: 'SHELL.NAV.CLIENT_DOSSIERS',
    page: 'cabinet.dossiers',
    route: '/cabinet/dossiers'
  },
  {
    icon: 'group',
    labelKey: 'SHELL.NAV.TEAM',
    page: 'cabinet.team',
    route: '/cabinet/team'
  },
  {
    icon: 'assignment',
    labelKey: 'SHELL.NAV.MISSIONS',
    page: 'cabinet.missions',
    route: '/cabinet/works'
  },
  {
    icon: 'event_upcoming',
    labelKey: 'SHELL.NAV.DEADLINES',
    page: 'cabinet.deadlines',
    route: '/cabinet/deadlines'
  },
  {
    icon: 'settings',
    labelKey: 'SHELL.NAV.CABINET_SETTINGS',
    page: 'cabinet.settings',
    route: '/cabinet/settings'
  }
];

@Component({
  selector: 'liass-app-sidebar',
  imports: [LiassSidebarNavItemComponent, TranslocoModule],
  templateUrl: './app-sidebar.component.html'
})
export class AppSidebarComponent {
  protected readonly accountingItems = accountingItems;
  protected readonly cabinetItems = cabinetItems;
  protected readonly dashboardItems = dashboardItems;
  protected readonly secondaryItems = secondaryItems;
  protected readonly salesItems = salesItems;
  protected readonly authStore = inject(AuthStore);
  private readonly cabinetSettingsCapabilities = inject(CabinetSettingsCapabilities);
  private readonly productAccessState = inject(ProductAccessState);
  private readonly salesCapabilities = inject(SalesCapabilities);
  protected readonly uiStore = inject(UiStore);
  protected readonly cabinetMode = computed(
    () => this.authStore.isCabinetContext()
  );
  protected readonly visibleCabinetItems = computed(() =>
    cabinetItems.filter(
      (item) =>
        (item.page !== 'cabinet.team' || this.authStore.canViewCabinetTeam()) &&
        (item.page !== 'cabinet.settings' ||
          this.cabinetSettingsCapabilities.canManageCabinetSettings())
    )
  );
  private readonly router = inject(Router);

  protected readonly sidebarExpanded = computed(() => !this.uiStore.sidebarCollapsed());
  protected readonly showSalesNavigation = computed(
    () =>
      !!this.authStore.effectiveOrgId() &&
      this.productAccessState.availability('SALES') === 'AVAILABLE' &&
      this.salesCapabilities.canRead()
  );

  protected sidebarClass(): string {
    const mobileState = this.uiStore.sidebarOpen() ? 'translate-x-0' : '-translate-x-full';
    const desktopWidth = this.uiStore.sidebarCollapsed()
      ? 'lg:w-[var(--spacing-shell-sidebar-collapsed)] lg:px-2'
      : 'lg:w-[var(--spacing-shell-sidebar)] lg:px-2';

    return `fixed left-0 top-[var(--spacing-app-header)] z-50 flex h-[calc(100dvh-var(--spacing-app-header))] w-[var(--spacing-shell-sidebar)] flex-col border-r border-slate-200/80 bg-white/96 px-2 text-slate-950 shadow-app-popover backdrop-blur-xl transition-[transform,width,padding] duration-300 ease-in-out dark:border-slate-800 dark:bg-slate-950/96 dark:text-white lg:translate-x-0 lg:shadow-none ${desktopWidth} ${mobileState}`;
  }

  protected async selectItem(item: ShellNavItem): Promise<void> {
    if (this.itemDisabled(item)) {
      return;
    }

    this.uiStore.setCurrentPage(item.page);
    this.uiStore.closeSidebar();

    if (item.route) {
      await this.router.navigateByUrl(item.route);
    }
  }

  protected itemBadge(item: ShellNavItem): string | null {
    if (this.productUnavailable(item)) {
      return 'SHELL.NAV.UNAVAILABLE';
    }

    return item.badgeKey ?? null;
  }

  protected itemDescription(item: ShellNavItem): string | null {
    return this.productUnavailable(item)
      ? 'SHELL.NAV.PRODUCT_UNAVAILABLE_FOR_ORGANIZATION'
      : null;
  }

  protected itemDisabled(item: ShellNavItem): boolean {
    return (item.disabled ?? false) || this.productUnavailable(item);
  }

  private productUnavailable(item: ShellNavItem): boolean {
    return (
      item.productCode !== undefined &&
      this.productAccessState.availability(item.productCode) === 'UNAVAILABLE'
    );
  }
}
