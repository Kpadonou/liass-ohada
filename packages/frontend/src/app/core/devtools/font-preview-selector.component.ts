import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslocoModule } from '@ngneat/transloco';

import { UiStore, type FontFamilyPreference } from '../state/ui.store';

@Component({
  selector: 'liass-font-preview-selector',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, TranslocoModule],
  templateUrl: './font-preview-selector.component.html',
  styleUrl: './font-preview-selector.component.css',
})
export class FontPreviewSelectorComponent {
  protected readonly uiStore = inject(UiStore);

  protected selectFontFamily(fontFamily: FontFamilyPreference): void {
    this.uiStore.setFontFamily(fontFamily);
  }
}
