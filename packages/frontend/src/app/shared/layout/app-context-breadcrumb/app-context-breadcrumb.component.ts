import { ShellRouteContext } from '../../../core/navigation/product-navigation';
import { Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule } from '@ngneat/transloco';

import { UiStore, type AppPage } from '../../../core/state/ui.store';
import { AuthStore } from '../../../domains/identity/data-access/auth.store';

const pageLabelKeys: Record<AppPage, string> = {
  administration: 'SHELL.PAGES.ADMINISTRATION',
  'accounting.auxiliaryBalance': 'SHELL.PAGES.AUXILIARY_BALANCE',
  'accounting.auxiliaryLedger': 'SHELL.PAGES.AUXILIARY_LEDGER',
  'accounting.chartOfAccounts': 'SHELL.PAGES.CHART_OF_ACCOUNTS',
  'accounting.entries': 'SHELL.PAGES.ENTRIES',
  'accounting.fiscalYear': 'SHELL.PAGES.FISCAL_YEAR',
  'accounting.generalLedger': 'SHELL.PAGES.GENERAL_LEDGER',
  'accounting.journalBook': 'SHELL.PAGES.JOURNAL_BOOK',
  'accounting.journals': 'SHELL.PAGES.JOURNALS',
  'accounting.lettering': 'SHELL.PAGES.LETTERING',
  'accounting.overview': 'SHELL.PAGES.ACCOUNTING_OVERVIEW',
  'accounting.thirdParties': 'SHELL.PAGES.THIRD_PARTIES',
  'accounting.trialBalance': 'SHELL.PAGES.TRIAL_BALANCE',
  'cabinet.collaborators': 'SHELL.PAGES.CABINET_COLLABORATORS',
  'cabinet.dashboard': 'SHELL.PAGES.CABINET_DASHBOARD',
  'cabinet.deadlines': 'SHELL.PAGES.CABINET_DEADLINES',
  'cabinet.dossiers': 'SHELL.PAGES.CLIENT_DOSSIERS',
  'cabinet.missions': 'SHELL.PAGES.CABINET_MISSIONS',
  'cabinet.settings': 'SHELL.PAGES.CABINET_SETTINGS',
  'cabinet.team': 'SHELL.PAGES.CABINET_COLLABORATORS',
  dashboard: 'SHELL.PAGES.DASHBOARD',
  projects: 'SHELL.NAV.PROJECTS',
  reports: 'SHELL.NAV.REPORTS',
  restaurants: 'SHELL.NAV.RESTAURANTS',
  'sales.dashboard': 'SHELL.PAGES.DASHBOARD',
  'sales.customers': 'SHELL.PAGES.SALES_CUSTOMERS',
  'sales.items': 'SHELL.PAGES.SALES_ITEMS',
  'sales.invoices': 'SHELL.PAGES.SALES_INVOICES',
  treasury: 'SHELL.NAV.TREASURY',
};
const cabinetOperationsPages = new Set<AppPage>([
  'cabinet.dashboard',
  'cabinet.deadlines',
  'cabinet.missions',
]);

@Component({
  selector: 'liass-app-context-breadcrumb',
  imports: [MatIconModule, TranslocoModule],
  templateUrl: './app-context-breadcrumb.component.html',
})
export class AppContextBreadcrumbComponent {
  protected readonly routeContext = inject(ShellRouteContext);
  private readonly authStore = inject(AuthStore);
  private readonly uiStore = inject(UiStore);

  protected readonly contextNames = computed(() => {
    if (cabinetOperationsPages.has(this.uiStore.currentPage())) {
      return [this.authStore.activeWorkspaceDisplayName()].filter(
        (value): value is string => !!value,
      );
    }

    const workspaceName = this.authStore.activeWorkspaceDisplayName();
    const dossierName = this.authStore.activeDossierDisplayName();

    return [workspaceName, this.authStore.isDossierContext() ? dossierName : null].filter(
      (value): value is string => !!value,
    );
  });
  protected readonly restaurantContext = computed(
    () => this.uiStore.currentPage() === 'restaurants',
  );
  protected readonly salesContext = computed(() => this.uiStore.currentPage().startsWith('sales.'));
  protected readonly pageLabelKey = computed(() =>
    this.restaurantContext()
      ? 'RESTAURANTS.UX.PAGES.' + this.routeContext.restaurantKey() + '.TITLE'
      : pageLabelKeys[this.uiStore.currentPage()],
  );
}
