import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { LiassSkeletonComponent } from '../skeleton/skeleton.component';
import { LiassStatusChipComponent, type LiassStatusTone } from '../status-chip/status-chip.component';

export type LiassStatState = 'default' | 'loading';
export type LiassStatTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const iconToneClasses: Record<LiassStatTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  danger: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
  info: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  accent: 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
};

@Component({
  selector: 'liass-stat-card',
  host: {
    class: 'block'
  },
  imports: [LiassSkeletonComponent, LiassStatusChipComponent, MatIconModule],
  templateUrl: './stat-card.component.html'
})
export class LiassStatCardComponent {
  readonly icon = input.required<string>();
  readonly label = input.required<string>();
  readonly meta = input.required<string>();
  readonly state = input<LiassStatState>('default');
  readonly tone = input<LiassStatTone>('neutral');
  readonly trendLabel = input<string | null>(null);
  readonly trendTone = input<LiassStatusTone>('neutral');
  readonly value = input.required<string>();

  protected readonly iconClass = computed(
    () => `grid size-9 shrink-0 place-items-center rounded-app-control ${iconToneClasses[this.tone()]}`
  );
}
