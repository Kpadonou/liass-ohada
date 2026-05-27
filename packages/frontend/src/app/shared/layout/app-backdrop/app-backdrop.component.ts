import { Component, inject } from '@angular/core';
import { TranslocoModule } from '@ngneat/transloco';

import { UiStore } from '../../../core/state/ui.store';

@Component({
  selector: 'liass-app-backdrop',
  imports: [TranslocoModule],
  templateUrl: './app-backdrop.component.html'
})
export class AppBackdropComponent {
  protected readonly uiStore = inject(UiStore);
}
