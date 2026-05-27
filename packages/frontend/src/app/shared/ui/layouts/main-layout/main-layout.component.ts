import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterOutlet } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';

import { LanguageSelectorComponent } from '../../../../core/i18n/language-selector/language-selector.component';

@Component({
  selector: 'liass-main-layout',
  imports: [LanguageSelectorComponent, MatIconModule, RouterLink, RouterOutlet, TranslocoModule],
  templateUrl: './main-layout.component.html',
})
export class MainLayoutComponent {}
