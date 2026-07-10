import { Component, input } from '@angular/core';

import { LiassSkeletonComponent } from '../skeleton/skeleton.component';

export type LiassSectionDensity = 'compact' | 'comfortable';
export type LiassSectionState = 'default' | 'loading' | 'empty';

@Component({
  selector: 'liass-section-container',
  host: {
    class: 'block'
  },
  imports: [LiassSkeletonComponent],
  templateUrl: './section-container.component.html'
})
export class LiassSectionContainerComponent {
  readonly density = input<LiassSectionDensity>('comfortable');
  readonly description = input<string | null>(null);
  readonly emptyDescription = input<string | null>(null);
  readonly emptyTitle = input<string | null>(null);
  readonly state = input<LiassSectionState>('default');
  readonly title = input.required<string>();

  protected bodyClass(): string {
    return this.density() === 'compact' ? 'p-3' : 'p-3.5 md:p-4';
  }
}
