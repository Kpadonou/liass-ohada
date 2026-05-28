import { Component, computed, input } from '@angular/core';

export type LiassStatusSize = 'sm' | 'md';
export type LiassStatusTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
export type LiassStatusVariant = 'soft' | 'solid' | 'outline';

const sizeClasses: Record<LiassStatusSize, string> = {
  md: 'px-2.5 py-1 text-xs',
  sm: 'px-2 py-0.5 text-[11px]'
};

const toneClasses: Record<LiassStatusVariant, Record<LiassStatusTone, string>> = {
  outline: {
    brand: 'bg-transparent text-brand-700 ring-brand-200 dark:text-brand-300 dark:ring-brand-900',
    danger: 'bg-transparent text-danger-600 ring-rose-200 dark:text-rose-300 dark:ring-rose-900',
    info: 'bg-transparent text-info-600 ring-sky-200 dark:text-sky-300 dark:ring-sky-900',
    neutral: 'bg-transparent text-slate-700 ring-slate-200 dark:text-slate-300 dark:ring-slate-700',
    success: 'bg-transparent text-success-600 ring-emerald-200 dark:text-emerald-300 dark:ring-emerald-900',
    warning: 'bg-transparent text-warning-600 ring-amber-200 dark:text-amber-300 dark:ring-amber-900'
  },
  soft: {
    brand: 'bg-brand-50 text-brand-700 ring-brand-100 dark:bg-brand-950/35 dark:text-brand-300 dark:ring-brand-900/70',
    danger: 'bg-danger-50 text-danger-600 ring-rose-100 dark:bg-rose-950/35 dark:text-rose-300 dark:ring-rose-900/70',
    info: 'bg-info-50 text-info-600 ring-sky-100 dark:bg-sky-950/35 dark:text-sky-300 dark:ring-sky-900/70',
    neutral: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
    success: 'bg-success-50 text-success-600 ring-emerald-100 dark:bg-emerald-950/35 dark:text-emerald-300 dark:ring-emerald-900/70',
    warning: 'bg-warning-50 text-warning-600 ring-amber-100 dark:bg-amber-950/35 dark:text-amber-300 dark:ring-amber-900/70'
  },
  solid: {
    brand: 'bg-brand-700 text-white ring-brand-700',
    danger: 'bg-danger-600 text-white ring-danger-600',
    info: 'bg-info-600 text-white ring-info-600',
    neutral: 'bg-slate-900 text-white ring-slate-900 dark:bg-slate-100 dark:text-slate-950 dark:ring-slate-100',
    success: 'bg-success-600 text-white ring-success-600',
    warning: 'bg-warning-600 text-white ring-warning-600'
  }
};

@Component({
  selector: 'liass-status-chip',
  templateUrl: './status-chip.component.html'
})
export class LiassStatusChipComponent {
  readonly label = input.required<string>();
  readonly tone = input<LiassStatusTone>('neutral');
  readonly size = input<LiassStatusSize>('md');
  readonly variant = input<LiassStatusVariant>('soft');

  protected readonly chipClass = computed(
    () =>
      `inline-flex items-center justify-center rounded-full font-semibold leading-none ring-1 ring-inset ${sizeClasses[this.size()]} ${toneClasses[this.variant()][this.tone()]}`
  );
}
