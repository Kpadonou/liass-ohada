import { Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'liass-sidebar-nav-item',
  imports: [MatIconModule],
  templateUrl: './sidebar-nav-item.component.html'
})
export class LiassSidebarNavItemComponent {
  readonly active = input(false);
  readonly badge = input<string | null>(null);
  readonly disabled = input(false);
  readonly icon = input.required<string>();
  readonly label = input.required<string>();

  readonly selected = output<void>();

  protected readonly itemClass = computed(() => {
    const state = this.active()
      ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100 dark:bg-brand-900/25 dark:text-brand-300 dark:ring-brand-900/70'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-white';
    const disabled = this.disabled() ? 'cursor-not-allowed opacity-55' : '';
    return `liass-focus-ring group flex h-11 w-full items-center gap-3 rounded-app-control px-3 text-left text-sm font-semibold transition ${state} ${disabled}`;
  });

  protected selectItem(): void {
    if (this.disabled()) {
      return;
    }

    this.selected.emit();
  }
}
