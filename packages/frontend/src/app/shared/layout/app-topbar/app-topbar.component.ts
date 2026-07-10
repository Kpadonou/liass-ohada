import { Component, OnInit, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';

import { LanguageSelectorComponent } from '../../../core/i18n/language-selector/language-selector.component';
import { UiStore } from '../../../core/state/ui.store';
import { AccountingFiscalYearContextService } from '../../../domains/accounting/data-access/accounting-fiscal-year-context.service';
import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { LiassDropdownComponent } from '../../ui/dropdown/dropdown.component';
import { LiassLogoComponent } from '../../ui/liass-logo/liass-logo.component';

@Component({
  selector: 'liass-app-topbar',
  imports: [
    LanguageSelectorComponent,
    LiassDropdownComponent,
    LiassLogoComponent,
    MatIconModule,
    MatTooltipModule,
    RouterLink,
    TranslocoModule
  ],
  templateUrl: './app-topbar.component.html'
})
export class AppTopbarComponent implements OnInit {
  protected readonly fiscalYearContext = inject(AccountingFiscalYearContextService);
  protected readonly authStore = inject(AuthStore);
  protected readonly uiStore = inject(UiStore);
  protected readonly activeWorkspaceIcon = computed(() => 'corporate_fare');
  protected readonly activeWorkspaceLabel = computed(() => {
    if (this.authStore.workspaceLoading() && this.authStore.hasActiveTenant()) {
      return null;
    }

    return this.authStore.activeWorkspaceDisplayName();
  });
  protected readonly activeDossierLabel = computed(() => {
    if (this.authStore.activeWorkspaceType() !== 'ACCOUNTING_FIRM') {
      return null;
    }

    if (this.authStore.dossierLoading()) {
      return null;
    }

    return this.authStore.activeDossierDisplayName();
  });
  protected readonly showActiveDossier = computed(
    () => this.authStore.activeWorkspaceType() === 'ACCOUNTING_FIRM'
  );
  protected readonly showFiscalYearSelector = computed(() =>
    this.uiStore.currentPage().startsWith('accounting.')
  );
  protected readonly sidebarToggleLabelKey = computed(() =>
    this.uiStore.sidebarCollapsed() ? 'SHELL.SIDEBAR.EXPAND' : 'SHELL.SIDEBAR.COLLAPSE'
  );
  protected readonly sidebarToggleIcon = computed(() =>
    this.uiStore.sidebarOpen()
      ? 'close'
      : this.uiStore.sidebarCollapsed()
        ? 'menu_open'
        : 'menu'
  );
  private readonly router = inject(Router);

  protected cabinetMenuOpen = false;
  protected fiscalYearMenuOpen = false;
  protected userMenuOpen = false;

  protected readonly userLabel = computed(() => this.authStore.currentUserDisplayName());

  async ngOnInit(): Promise<void> {
    if (this.authStore.isAuthenticated() && !this.authStore.currentUserDisplayName()) {
      await this.authStore.refreshUserProfile();
    }
  }

  protected async logout(): Promise<void> {
    this.userMenuOpen = false;
    await this.authStore.logout();
    await this.router.navigate(['/login']);
  }

  protected toggleUserMenu(): void {
    this.userMenuOpen = !this.userMenuOpen;
  }

  protected toggleShellNavigation(): void {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
      this.uiStore.toggleSidebarCollapsed();
      return;
    }

    this.uiStore.toggleSidebar();
  }

  protected toggleCabinetMenu(): void {
    if (this.authStore.activeWorkspaceType() !== 'ACCOUNTING_FIRM') {
      return;
    }

    this.cabinetMenuOpen = !this.cabinetMenuOpen;
  }

  protected toggleFiscalYearMenu(): void {
    if (!this.showFiscalYearSelector()) {
      return;
    }

    this.fiscalYearMenuOpen = !this.fiscalYearMenuOpen;
  }

  protected async openDossierContext(): Promise<void> {
    if (this.authStore.activeWorkspaceType() !== 'ACCOUNTING_FIRM') {
      return;
    }

    await this.router.navigate(['/cabinet/dossiers']);
  }

  protected selectFiscalYear(year: number): void {
    const fiscalYear = this.fiscalYearContext.fiscalYears().find((candidate) => candidate.year === year);

    if (fiscalYear) {
      this.fiscalYearContext.selectFiscalYear(fiscalYear);
    }

    this.fiscalYearMenuOpen = false;
  }

  protected async navigateToFiscalYears(): Promise<void> {
    this.fiscalYearMenuOpen = false;
    await this.router.navigate(['/accounting/fiscal-years']);
  }

  protected async navigateToCabinetDashboard(): Promise<void> {
    this.cabinetMenuOpen = false;
    await this.router.navigate(['/cabinet/dashboard']);
  }

  protected async navigateToCabinetDossiers(): Promise<void> {
    this.cabinetMenuOpen = false;
    await this.router.navigate(['/cabinet/dossiers']);
  }

  protected async createCabinetDossier(): Promise<void> {
    this.cabinetMenuOpen = false;
    await this.router.navigate(['/cabinet/dossiers'], {
      queryParams: { createDossier: '1' }
    });
  }
}
