import { Component, computed, input } from '@angular/core';

export type LiassCardPadding = 'sm' | 'md' | 'lg';
export type LiassCardVariant = 'default' | 'muted' | 'accent';

const paddingClasses: Record<LiassCardPadding, string> = {
  sm: 'p-4',
  md: 'p-5 md:p-6',
  lg: 'p-6 md:p-7'
};

const variantClasses: Record<LiassCardVariant, string> = {
  default: 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/80',
  muted: 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/55',
  accent: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/70 dark:bg-emerald-950/25'
};

@Component({
  selector: 'liass-card',
  templateUrl: './card.component.html'
})
export class LiassCardComponent {
  readonly padding = input<LiassCardPadding>('md');
  readonly variant = input<LiassCardVariant>('default');

  protected readonly cardClass = computed(
    () =>
      `rounded-lg border shadow-sm shadow-slate-900/[0.03] ${paddingClasses[this.padding()]} ${variantClasses[this.variant()]}`
  );
}
