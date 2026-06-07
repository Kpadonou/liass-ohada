import { Component, computed, inject, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { AccountingQueries } from '../../data-access/accounting-queries';

@Component({
  selector: 'liass-general-ledger-page',
  imports: [
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    TranslocoModule
  ],
  templateUrl: './general-ledger.page.html'
})
export class GeneralLedgerPage {
  private readonly accountingQueries = inject(AccountingQueries);

  protected readonly selectedYear = signal(`${new Date().getFullYear()}`);
  protected readonly selectedAccountId = signal('41100000');
  protected readonly accountsQuery = injectQuery(() => this.accountingQueries.listAccounts());
  protected readonly accounts = computed(() => this.accountsQuery.data()?.items ?? []);
  protected readonly ledgerQuery = injectQuery(() =>
    this.accountingQueries.generalLedger({
      fiscalYear: this.selectedYear(),
      accountId: this.selectedAccountId()
    })
  );
  protected readonly ledger = computed(() => this.ledgerQuery.data());

  protected updateYear(event: Event): void {
    this.selectedYear.set((event.target as HTMLInputElement).value);
  }
}
