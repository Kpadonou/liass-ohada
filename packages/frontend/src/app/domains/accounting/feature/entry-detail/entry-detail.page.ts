import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { type EntryDetailDto, type EntryLineDto } from '@liass-ohada/shared/accounting';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import {
  LiassStatusChipComponent,
  type LiassStatusTone
} from '../../../../shared/ui/status-chip/status-chip.component';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { FiscalYearRequiredComponent } from '../../ui/fiscal-year-required/fiscal-year-required.component';

@Component({
  selector: 'liass-entry-detail-page',
  host: {
    class: 'block'
  },
  imports: [
    FiscalYearRequiredComponent,
    LiassButtonComponent,
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    LiassStatusChipComponent,
    MatTooltipModule,
    TranslocoModule
  ],
  templateUrl: './entry-detail.page.html'
})
export class EntryDetailPage {
  private readonly accountingQueries = inject(AccountingQueries);
  protected readonly fiscalYearContext = inject(AccountingFiscalYearContextService);
  private readonly notification = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  protected readonly entryId = this.route.snapshot.paramMap.get('entryId') ?? '';
  protected readonly entryQuery = injectQuery(() =>
    this.accountingQueries.entryDetail(
      this.entryId,
      this.fiscalYearContext.activeYear(),
      this.fiscalYearContext.hasActiveFiscalYear()
    )
  );
  protected readonly entry = computed(() => this.entryQuery.data());
  protected readonly isNotFound = computed(
    () => this.entryQuery.error() instanceof HttpErrorResponse &&
      (this.entryQuery.error() as HttpErrorResponse).status === 404
  );
  protected readonly loadErrorMessage = computed(() =>
    safeMessageFromError(this.entryQuery.error())
  );

  protected async goBack(): Promise<void> {
    await this.router.navigate(['/accounting/entries']);
  }

  protected async editEntry(): Promise<void> {
    const entry = this.entry();

    if (!entry || entry.status !== 'DRAFT') {
      return;
    }

    await this.router.navigate(['/accounting/entries', entry.entryId, 'edit']);
  }

  protected async viewGeneralLedger(line: EntryLineDto, year?: number): Promise<void> {
    if (!line.accountId) {
      this.notification.error(
        this.transloco.translate(
          'ACCOUNTING.ENTRIES.DETAIL.NOTIFICATIONS.GENERAL_LEDGER_ACCOUNT_REQUIRED'
        )
      );
      return;
    }

    if (!year) {
      this.notification.error(
        this.transloco.translate(
          'ACCOUNTING.ENTRIES.DETAIL.NOTIFICATIONS.GENERAL_LEDGER_YEAR_REQUIRED'
        )
      );
      return;
    }

    await this.router.navigate(['/accounting/general-ledger'], {
      queryParams: {
        account: line.accountId,
        year
      }
    });
  }

  protected async retry(): Promise<void> {
    await this.entryQuery.refetch();
  }

  protected formatAmount(amount: number): string {
    return new Intl.NumberFormat('fr-FR', {
      maximumFractionDigits: 0
    }).format(amount);
  }

  protected statusTone(status: EntryDetailDto['status']): LiassStatusTone {
    if (status === 'POSTED') {
      return 'success';
    }

    if (status === 'DRAFT') {
      return 'warning';
    }

    return 'danger';
  }
}
