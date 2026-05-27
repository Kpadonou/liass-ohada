import { Component, input } from '@angular/core';

@Component({
  selector: 'liass-section-container',
  templateUrl: './section-container.component.html'
})
export class LiassSectionContainerComponent {
  readonly description = input<string | null>(null);
  readonly title = input.required<string>();
}
