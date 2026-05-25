import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Router } from '@angular/router';

import { UiStore, type AppSection } from '../../../../core/state/ui.store';
import { AuthStore } from '../../../identity/data-access/auth.store';

const sectionLabels: Record<AppSection, string> = {
  ledger: 'General ledger',
  projects: 'SYCEBNL projects',
  treasury: 'Treasury',
  reports: 'Reports'
};

@Component({
  selector: 'liass-dashboard-page',
  imports: [MatButtonModule, MatIconModule, MatToolbarModule],
  templateUrl: './dashboard.page.html'
})
export class DashboardPage {
  protected readonly authStore = inject(AuthStore);
  protected readonly uiStore = inject(UiStore);
  private readonly router = inject(Router);

  protected readonly sectionLabels = sectionLabels;
  protected readonly sections: readonly AppSection[] = [
    'ledger',
    'projects',
    'treasury',
    'reports'
  ];
  protected readonly activeSectionLabel = computed(
    () => sectionLabels[this.uiStore.selectedSection()]
  );

  protected selectSection(section: AppSection): void {
    this.uiStore.selectSection(section);
  }

  protected async logout(): Promise<void> {
    await this.authStore.logout();
    await this.router.navigate(['/login']);
  }
}
