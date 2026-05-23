import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterOutlet } from '@angular/router';

import { AppSection, UiStore } from './state/ui.store';

const sectionLabels: Record<AppSection, string> = {
  ledger: 'General ledger',
  projects: 'SYCEBNL projects',
  treasury: 'Treasury',
  reports: 'Reports'
};

@Component({
  selector: 'liass-root',
  imports: [MatButtonModule, MatIconModule, MatToolbarModule, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly uiStore = inject(UiStore);
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
}
