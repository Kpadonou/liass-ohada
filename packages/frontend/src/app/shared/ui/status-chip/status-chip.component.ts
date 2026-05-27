import { Component, computed, input } from '@angular/core';

export type LiassStatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const toneClasses: Record<LiassStatusTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/35 dark:text-emerald-300 dark:ring-emerald-900',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/35 dark:text-amber-300 dark:ring-amber-900',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/35 dark:text-rose-300 dark:ring-rose-900',
  info: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/35 dark:text-sky-300 dark:ring-sky-900'
};

@Component({
  selector: 'liass-status-chip',
  templateUrl: './status-chip.component.html'
})
export class LiassStatusChipComponent {
  readonly label = input.required<string>();
  readonly tone = input<LiassStatusTone>('neutral');

  protected readonly chipClass = computed(
    () =>
      `inline-flex items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold leading-none ring-1 ring-inset ${toneClasses[this.tone()]}`
  );
}
