import { Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { LiassButtonComponent } from '../button/button.component';

@Component({
  selector: 'liass-page-header',
  host: {
    class: 'block'
  },
  imports: [LiassButtonComponent, MatIconModule],
  templateUrl: './page-header.component.html'
})
export class LiassPageHeaderComponent {
  readonly actionIcon = input<string | null>(null);
  readonly actionLabel = input<string | null>(null);
  readonly eyebrow = input.required<string>();
  readonly subtitle = input.required<string>();
  readonly title = input.required<string>();

  readonly actionTriggered = output<void>();

  protected emitAction(): void {
    this.actionTriggered.emit();
  }
}
