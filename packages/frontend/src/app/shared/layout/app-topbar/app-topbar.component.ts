import { Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';

import { LanguageSelectorComponent } from '../../../core/i18n/language-selector/language-selector.component';
import { UiStore, type AppSection } from '../../../core/state/ui.store';
import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { LiassButtonComponent } from '../../ui/button/button.component';
import { LiassCommandInputComponent } from '../../ui/command-input/command-input.component';
import { LiassDropdownComponent } from '../../ui/dropdown/dropdown.component';

const sectionTitleKeys: Record<AppSection, string> = {
  ledger: 'SHELL.SECTIONS.LEDGER',
  projects: 'SHELL.SECTIONS.PROJECTS',
  treasury: 'SHELL.SECTIONS.TREASURY',
  reports: 'SHELL.SECTIONS.REPORTS'
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
export class AppTopbarComponent {
  protected readonly authStore = inject(AuthStore);
  protected readonly uiStore = inject(UiStore);
  protected readonly sectionTitleKey = computed(() => sectionTitleKeys[this.uiStore.selectedSection()]);
  private readonly router = inject(Router);

  protected commandValue = '';
  protected userMenuOpen = false;

  protected readonly userLabel = computed(() => {
    const user = this.authStore.user();
    return user?.signInDetails?.loginId ?? user?.username ?? '';
  });

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
}
