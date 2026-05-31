import { Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

export type LiassButtonSize = 'sm' | 'md' | 'lg' | 'icon';
export type LiassButtonTone = 'brand' | 'neutral' | 'success' | 'warning' | 'danger' | 'info';
export type LiassButtonType = 'button' | 'submit' | 'reset';
export type LiassButtonVariant = 'solid' | 'soft' | 'outline' | 'ghost';

const baseClass =
  'liass-focus-ring inline-flex shrink-0 items-center justify-center font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';

const sizeClasses: Record<LiassButtonSize, string> = {
  icon: 'size-10 rounded-app-control p-0',
  lg: 'h-12 gap-2 rounded-app-control px-5 text-sm',
  md: 'h-10 gap-2 rounded-app-control px-4 text-sm',
  sm: 'h-9 gap-1.5 rounded-app-control px-3 text-xs'
};

const toneClasses: Record<LiassButtonVariant, Record<LiassButtonTone, string>> = {
  ghost: {
    brand: 'text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950/30',
    danger: 'text-danger-600 hover:bg-danger-50 dark:text-rose-300 dark:hover:bg-rose-950/30',
    info: 'text-info-600 hover:bg-info-50 dark:text-sky-300 dark:hover:bg-sky-950/30',
    neutral: 'text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
    success: 'text-success-600 hover:bg-success-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30',
    warning: 'text-warning-600 hover:bg-warning-50 dark:text-amber-300 dark:hover:bg-amber-950/30'
  },
  outline: {
    brand: 'border border-brand-200 bg-white text-brand-700 shadow-app-xs hover:bg-brand-50 dark:border-brand-900 dark:bg-slate-900 dark:text-brand-300 dark:hover:bg-brand-950/30',
    danger: 'border border-rose-200 bg-white text-danger-600 shadow-app-xs hover:bg-danger-50 dark:border-rose-900 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/30',
    info: 'border border-sky-200 bg-white text-info-600 shadow-app-xs hover:bg-info-50 dark:border-sky-900 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-sky-950/30',
    neutral: 'border border-slate-200 bg-white text-slate-700 shadow-app-xs hover:bg-slate-50 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
    success: 'border border-emerald-200 bg-white text-success-600 shadow-app-xs hover:bg-success-50 dark:border-emerald-900 dark:bg-slate-900 dark:text-emerald-300 dark:hover:bg-emerald-950/30',
    warning: 'border border-amber-200 bg-white text-warning-600 shadow-app-xs hover:bg-warning-50 dark:border-amber-900 dark:bg-slate-900 dark:text-amber-300 dark:hover:bg-amber-950/30'
  },
  soft: {
    brand: 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-950/35 dark:text-brand-300 dark:hover:bg-brand-950/55',
    danger: 'bg-danger-50 text-danger-600 hover:bg-rose-100 dark:bg-rose-950/35 dark:text-rose-300 dark:hover:bg-rose-950/55',
    info: 'bg-info-50 text-info-600 hover:bg-sky-100 dark:bg-sky-950/35 dark:text-sky-300 dark:hover:bg-sky-950/55',
    neutral: 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
    success: 'bg-success-50 text-success-600 hover:bg-emerald-100 dark:bg-emerald-950/35 dark:text-emerald-300 dark:hover:bg-emerald-950/55',
    warning: 'bg-warning-50 text-warning-600 hover:bg-amber-100 dark:bg-amber-950/35 dark:text-amber-300 dark:hover:bg-amber-950/55'
  },
  solid: {
    brand: 'bg-brand-700 text-white shadow-app-xs shadow-brand-900/10 hover:bg-brand-600',
    danger: 'bg-danger-600 text-white shadow-app-xs hover:bg-rose-700',
    info: 'bg-info-600 text-white shadow-app-xs hover:bg-sky-700',
    neutral: 'bg-slate-900 text-white shadow-app-xs hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white',
    success: 'bg-success-600 text-white shadow-app-xs hover:bg-emerald-700',
    warning: 'bg-warning-600 text-white shadow-app-xs hover:bg-amber-700'
  }
};

@Component({
  selector: 'liass-button',
  imports: [MatIconModule],
  templateUrl: './button.component.html'
})
export class LiassButtonComponent {
  readonly ariaLabel = input<string | null>(null);
  readonly buttonType = input<LiassButtonType>('button');
  readonly disabled = input(false);
  readonly icon = input<string | null>(null);
  readonly loading = input(false);
  readonly size = input<LiassButtonSize>('md');
  readonly tone = input<LiassButtonTone>('neutral');
  readonly variant = input<LiassButtonVariant>('outline');

  readonly pressed = output<void>();

  protected readonly buttonClass = computed(
    () => `${baseClass} ${sizeClasses[this.size()]} ${toneClasses[this.variant()][this.tone()]}`
  );

  protected readonly isDisabled = computed(() => this.disabled() || this.loading());

  protected emitPressed(): void {
    if (this.isDisabled()) {
      return;
    }

    this.pressed.emit();
  }
}
