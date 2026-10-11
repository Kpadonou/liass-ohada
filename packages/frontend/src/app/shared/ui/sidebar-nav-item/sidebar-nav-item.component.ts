import { Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'liass-sidebar-nav-item',
  imports: [MatIconModule, MatTooltipModule],
  templateUrl: './sidebar-nav-item.component.html',
})
export class LiassSidebarNavItemComponent {
  readonly active = input(false);
  readonly restrained = input(false);
  readonly badge = input<string | null>(null);
  readonly compact = input(false);
  readonly description = input<string | null>(null);
  readonly disabled = input(false);
  readonly icon = input.required<string>();
  readonly label = input.required<string>();

  readonly selected = output<void>();

  protected readonly accessibleLabel = computed(() =>
    this.description() ? `${this.label()}. ${this.description()}` : this.label(),
  );
  protected readonly tooltip = computed(
    () => this.description() ?? (this.compact() ? this.label() : ''),
  );

  protected readonly itemClass = computed(() => {
    const state = this.active()
      ? this.restrained()
        ? 'bg-brand-50/60 text-brand-700 dark:bg-brand-900/20 dark:text-brand-200'
        : 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100 shadow-app-xs dark:bg-brand-900/28 dark:text-brand-200 dark:ring-brand-900/70'
      : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-white';
    const disabled = this.disabled()
      ? 'cursor-not-allowed text-slate-400 opacity-80 dark:text-slate-500'
      : '';
    const layout = this.compact()
      ? 'gap-2.5 px-2.5 text-left lg:justify-center lg:px-0 lg:text-center'
      : 'gap-2.5 px-2.5 text-left';

    return `liass-focus-ring group relative flex h-9 w-full items-center rounded-app-control text-sm font-semibold transition ${layout} ${state} ${disabled}`;
  });

  protected selectItem(): void {
    if (this.disabled()) {
      return;
    }

    this.selected.emit();
  }
}
