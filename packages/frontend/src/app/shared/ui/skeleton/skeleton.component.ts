import { Component, computed, input } from '@angular/core';

export type LiassSkeletonVariant = 'text' | 'block' | 'circle' | 'card';

const variantClasses: Record<LiassSkeletonVariant, string> = {
  block: 'h-24 w-full rounded-app-card',
  card: 'h-36 w-full rounded-app-card',
  circle: 'size-10 rounded-full',
  text: 'h-3 rounded-full'
};

@Component({
  selector: 'liass-skeleton',
  templateUrl: './skeleton.component.html'
})
export class LiassSkeletonComponent {
  readonly animated = input(true);
  readonly lines = input(1);
  readonly variant = input<LiassSkeletonVariant>('text');

  protected readonly skeletonLines = computed(() => Array.from({ length: Math.max(1, this.lines()) }));

  protected classForLine(index: number): string {
    const animation = this.animated() ? 'animate-pulse' : '';
    const isLastTextLine = this.variant() === 'text' && this.lines() > 1 && index === this.lines() - 1;
    const width = this.variant() === 'text' ? (isLastTextLine ? 'w-3/4' : 'w-full') : '';
    return `${variantClasses[this.variant()]} ${width} bg-app-surface-hover ${animation}`;
  }
}
