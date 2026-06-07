import { Component, computed, input } from '@angular/core';

import { LiassSkeletonComponent } from '../skeleton/skeleton.component';

export type LiassCardPadding = 'sm' | 'md' | 'lg';
export type LiassCardState = 'default' | 'loading' | 'empty';
export type LiassCardVariant = 'default' | 'muted' | 'accent';

const paddingClasses: Record<LiassCardPadding, string> = {
  sm: 'p-4',
  md: 'p-5 md:p-6',
  lg: 'p-6 md:p-7'
};

const variantClasses: Record<LiassCardVariant, string> = {
  default: 'border-app-border bg-app-surface dark:border-app-border-dark dark:bg-app-surface-dark/85',
  muted: 'border-app-border bg-app-surface-muted dark:border-app-border-dark dark:bg-slate-900/55',
  accent: 'border-brand-100 bg-brand-50/70 dark:border-brand-900/70 dark:bg-brand-900/20'
};

@Component({
  selector: 'liass-card',
  host: {
    class: 'block'
  },
  imports: [LiassSkeletonComponent],
  templateUrl: './card.component.html'
})
export class LiassCardComponent {
  readonly description = input<string | null>(null);
  readonly emptyDescription = input<string | null>(null);
  readonly emptyTitle = input<string | null>(null);
  readonly padding = input<LiassCardPadding>('md');
  readonly state = input<LiassCardState>('default');
  readonly title = input<string | null>(null);
  readonly variant = input<LiassCardVariant>('default');

  protected readonly cardClass = computed(
    () =>
      `rounded-app-card border shadow-app-card ${paddingClasses[this.padding()]} ${variantClasses[this.variant()]}`
  );
}
