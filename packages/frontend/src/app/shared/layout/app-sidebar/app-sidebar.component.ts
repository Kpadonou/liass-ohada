import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';

import { UiStore, type AppSection } from '../../../core/state/ui.store';
import { LiassLogoComponent } from '../../ui/liass-logo/liass-logo.component';
import { LiassSidebarNavItemComponent } from '../../ui/sidebar-nav-item/sidebar-nav-item.component';

interface ShellNavItem {
  badgeKey?: string;
  icon: string;
  labelKey: string;
  section: AppSection;
}

const navItems: readonly ShellNavItem[] = [
  {
    icon: 'account_balance',
    labelKey: 'SHELL.NAV.LEDGER',
    section: 'ledger'
  },
  {
    badgeKey: 'SHELL.NAV.SYCEBNL_BADGE',
    icon: 'folder_managed',
    labelKey: 'SHELL.NAV.PROJECTS',
    section: 'projects'
  },
  {
    icon: 'payments',
    labelKey: 'SHELL.NAV.TREASURY',
    section: 'treasury'
  },
  {
    icon: 'analytics',
    labelKey: 'SHELL.NAV.REPORTS',
    section: 'reports'
  }
];

@Component({
  selector: 'liass-app-sidebar',
  imports: [LiassLogoComponent, LiassSidebarNavItemComponent, RouterLink, TranslocoModule],
  templateUrl: './app-sidebar.component.html'
})
export class AppSidebarComponent {
  protected readonly navItems = navItems;
  protected readonly uiStore = inject(UiStore);

  protected sidebarClass(): string {
    const mobileState = this.uiStore.sidebarOpen() ? 'translate-x-0' : '-translate-x-full';
    return `fixed left-0 top-0 z-50 flex h-dvh w-[var(--spacing-shell-sidebar)] flex-col border-r border-slate-200 bg-white px-4 text-slate-950 shadow-app-popover transition-transform duration-300 ease-in-out dark:border-slate-800 dark:bg-slate-900 dark:text-white lg:translate-x-0 lg:shadow-none ${mobileState}`;
  }

  protected selectSection(section: AppSection): void {
    this.uiStore.selectSection(section);
    this.uiStore.closeSidebar();
  }
}
