import { Component, computed, inject, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { AccountingQueries } from '../../data-access/accounting-queries';

@Component({
  selector: 'liass-trial-balance-page',
  imports: [
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    MatFormFieldModule,
    MatInputModule,
    TranslocoModule
  ],
  templateUrl: './trial-balance.page.html'
})
export class TrialBalancePage {
  private readonly accountingQueries = inject(AccountingQueries);

  protected readonly selectedYear = signal(`${new Date().getFullYear()}`);
  protected readonly trialBalanceQuery = injectQuery(() =>
    this.accountingQueries.trialBalance(this.selectedYear())
  );
  protected readonly trialBalance = computed(() => this.trialBalanceQuery.data());

  protected updateYear(event: Event): void {
    this.selectedYear.set((event.target as HTMLInputElement).value);
  }
}
