import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';

@Component({
  selector: 'liass-fiscal-year-required',
  imports: [LiassButtonComponent, MatIconModule, TranslocoModule],
  template: `
    <div class="rounded-app-card border border-dashed border-emerald-200 bg-emerald-50/50 p-8 text-center dark:border-emerald-900 dark:bg-emerald-950/20">
      <span class="mx-auto inline-flex size-12 items-center justify-center rounded-app-control bg-white text-emerald-700 shadow-app-xs dark:bg-emerald-950 dark:text-emerald-200">
        <mat-icon>event_available</mat-icon>
      </span>
      <p class="mt-4 text-base font-semibold text-slate-950 dark:text-white">
        {{ 'ACCOUNTING.FISCAL_YEAR_CONTEXT.EMPTY_TITLE' | transloco }}
      </p>
      <p class="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
        {{ 'ACCOUNTING.FISCAL_YEAR_CONTEXT.EMPTY_DESCRIPTION' | transloco }}
      </p>
      <div class="mt-5 flex flex-wrap justify-center gap-3">
        <liass-button tone="brand" variant="solid" icon="event_note" (pressed)="goToFiscalYears()">
          {{ 'ACCOUNTING.FISCAL_YEAR_CONTEXT.CHOOSE_ACTION' | transloco }}
        </liass-button>
        <liass-button tone="neutral" variant="outline" icon="add" (pressed)="goToFiscalYears()">
          {{ 'ACCOUNTING.FISCAL_YEAR_CONTEXT.CREATE_ACTION' | transloco }}
        </liass-button>
      </div>
    </div>
  `
})
export class FiscalYearRequiredComponent {
  private readonly router = inject(Router);

  protected async goToFiscalYears(): Promise<void> {
    await this.router.navigate(['/accounting/fiscal-years']);
  }
}
