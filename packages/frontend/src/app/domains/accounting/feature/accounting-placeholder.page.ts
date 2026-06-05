import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassPageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { LiassSectionContainerComponent } from '../../../shared/ui/section-container/section-container.component';

@Component({
  selector: 'liass-accounting-placeholder-page',
  imports: [LiassPageHeaderComponent, LiassSectionContainerComponent, TranslocoModule],
  template: `
    <div class="space-y-5 md:space-y-6">
      <liass-page-header
        [eyebrow]="'ACCOUNTING.PLACEHOLDER.EYEBROW' | transloco"
        [subtitle]="subtitleKey | transloco"
        [title]="titleKey | transloco"
      />

      <liass-section-container
        [description]="'ACCOUNTING.PLACEHOLDER.DESCRIPTION' | transloco"
        [title]="'ACCOUNTING.PLACEHOLDER.TITLE' | transloco"
      >
        <p class="text-sm leading-6 text-slate-600 dark:text-slate-400">
          {{ 'ACCOUNTING.PLACEHOLDER.BODY' | transloco }}
        </p>
      </liass-section-container>
    </div>
  `
})
export class AccountingPlaceholderPage {
  private readonly route = inject(ActivatedRoute);

  protected readonly subtitleKey =
    this.route.snapshot.data['subtitleKey'] ?? 'ACCOUNTING.PLACEHOLDER.DEFAULT_SUBTITLE';
  protected readonly titleKey =
    this.route.snapshot.data['titleKey'] ?? 'ACCOUNTING.PLACEHOLDER.DEFAULT_TITLE';
}
