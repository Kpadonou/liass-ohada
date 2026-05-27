import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { UiStore } from '../../../core/state/ui.store';
import { AppBackdropComponent } from '../app-backdrop/app-backdrop.component';
import { AppSidebarComponent } from '../app-sidebar/app-sidebar.component';
import { AppTopbarComponent } from '../app-topbar/app-topbar.component';

@Component({
  selector: 'liass-app-shell',
  imports: [AppBackdropComponent, AppSidebarComponent, AppTopbarComponent, RouterOutlet],
  templateUrl: './app-shell.component.html'
})
export class AppShellComponent {
  private readonly uiStore = inject(UiStore);

  constructor() {
    this.uiStore.applyTheme();
  }
}
