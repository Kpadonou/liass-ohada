import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule } from '@ngneat/transloco';

import { LanguageSelectorComponent } from '../../../../core/i18n/language-selector/language-selector.component';
import { publicSiteConfig } from '../../../../core/public/public-site.config';
import { LiassLogoComponent } from '../../../../shared/ui/liass-logo/liass-logo.component';

@Component({
  selector: 'liass-auth-layout',
  imports: [LanguageSelectorComponent, LiassLogoComponent, MatIconModule, TranslocoModule],
  templateUrl: './auth-layout.component.html',
  host: { class: 'block' }
})
export class AuthLayoutComponent {
  protected readonly publicSiteUrl = publicSiteConfig.publicBaseUrl;
}
