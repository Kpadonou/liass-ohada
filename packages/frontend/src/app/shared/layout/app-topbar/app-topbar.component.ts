import { Component, OnInit, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';

import { LanguageSelectorComponent } from '../../../core/i18n/language-selector/language-selector.component';
import { UiStore, type AppPage } from '../../../core/state/ui.store';
import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { LiassButtonComponent } from '../../ui/button/button.component';
import { LiassCommandInputComponent } from '../../ui/command-input/command-input.component';
import { LiassDropdownComponent } from '../../ui/dropdown/dropdown.component';

const pageTitleKeys: Record<AppPage, string> = {
  'accounting.chartOfAccounts': 'SHELL.PAGES.CHART_OF_ACCOUNTS',
  'accounting.entries': 'SHELL.PAGES.ENTRIES',
  'accounting.generalLedger': 'SHELL.PAGES.GENERAL_LEDGER',
  'accounting.journals': 'SHELL.PAGES.JOURNALS',
  'accounting.trialBalance': 'SHELL.PAGES.TRIAL_BALANCE',
  'cabinet.collaborators': 'SHELL.PAGES.CABINET_COLLABORATORS',
  'cabinet.dashboard': 'SHELL.PAGES.CABINET_DASHBOARD',
  'cabinet.deadlines': 'SHELL.PAGES.CABINET_DEADLINES',
  'cabinet.dossiers': 'SHELL.PAGES.CLIENT_DOSSIERS',
  'cabinet.missions': 'SHELL.PAGES.CABINET_MISSIONS',
  'cabinet.settings': 'SHELL.PAGES.CABINET_SETTINGS',
  administration: 'SHELL.PAGES.ADMINISTRATION',
  dashboard: 'SHELL.PAGES.DASHBOARD',
  projects: 'SHELL.SECTIONS.PROJECTS',
  reports: 'SHELL.SECTIONS.REPORTS',
  treasury: 'SHELL.SECTIONS.TREASURY'
};

@Component({
  selector: 'liass-app-topbar',
  imports: [
    LanguageSelectorComponent,
    LiassButtonComponent,
    LiassCommandInputComponent,
    LiassDropdownComponent,
    MatIconModule,
    TranslocoModule
  ],
  templateUrl: './app-topbar.component.html'
})
export class AppTopbarComponent implements OnInit {
  protected readonly authStore = inject(AuthStore);
  protected readonly uiStore = inject(UiStore);
  protected readonly pageTitleKey = computed(() => pageTitleKeys[this.uiStore.currentPage()]);
  protected readonly activeWorkspaceTypeLabelKey = computed(() =>
    this.authStore.activeWorkspaceTypeLabelKey()
  );
  protected readonly activeWorkspaceIcon = computed(() =>
    this.authStore.activeWorkspaceType() === 'ACCOUNTING_FIRM' ? 'groups' : 'domain'
  );
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
  protected readonly activeDossierRouteLabelKey = computed(() => 'SHELL.TOPBAR.SELECT_DOSSIER');
  private readonly router = inject(Router);

  protected commandValue = '';
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

  protected updateCommandValue(value: string): void {
    this.commandValue = value;
  }

  protected async openDossierContext(): Promise<void> {
    if (this.authStore.activeWorkspaceType() !== 'ACCOUNTING_FIRM') {
      return;
    }

    const route = this.authStore.hasActiveDossier() || this.authStore.dossiers().length > 1
      ? '/cabinet/dossiers/select'
      : '/cabinet/dossiers/new';

    await this.router.navigate([route]);
  }
}
