import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';

import { saveLanguagePreference, type SupportedLanguage } from '../language-preferences';

@Component({
  selector: 'liass-language-selector',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, TranslocoModule],
  templateUrl: './language-selector.component.html',
})
export class LanguageSelectorComponent {
  private readonly translocoService = inject(TranslocoService);

  protected readonly languages: Array<{
    code: SupportedLanguage;
    labelKey: string;
  }> = [
    { code: 'fr', labelKey: 'COMMON.LANGUAGE_SELECTOR.FRENCH' },
    { code: 'en', labelKey: 'COMMON.LANGUAGE_SELECTOR.ENGLISH' },
  ];

  private readonly activeLanguageSignal = toSignal(this.translocoService.langChanges$, {
    initialValue: this.translocoService.getActiveLang(),
  });

  protected readonly activeLanguage = computed<SupportedLanguage>(() =>
    this.activeLanguageSignal() === 'en' ? 'en' : 'fr',
  );

  protected isActiveLanguage(language: SupportedLanguage): boolean {
    return this.activeLanguage() === language;
  }

  protected switchLanguage(language: SupportedLanguage): void {
    if (this.isActiveLanguage(language)) {
      return;
    }

    saveLanguagePreference(language);
    this.translocoService.setActiveLang(language);
  }
}
