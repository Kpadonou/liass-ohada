import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute } from '@angular/router';
import { type GeneralLedgerLineDto } from '@liass-ohada/shared/accounting';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { take } from 'rxjs';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassTablePreferencesDialogComponent } from '../../../../shared/ui/table-preferences/table-preferences-dialog.component';
import { type LiassTableColumnPreference } from '../../../../shared/ui/table-preferences/table-preferences.model';
import {
  loadTablePreferences,
  saveTablePreferences
} from '../../../../shared/ui/table-preferences/table-preferences.storage';
import { AccountingApi } from '../../data-access/accounting.api';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { AccountSearchSelectComponent } from '../../ui/account-search-select/account-search-select.component';
import { FiscalYearRequiredComponent } from '../../ui/fiscal-year-required/fiscal-year-required.component';

type GeneralLedgerColumnId =
  | 'date'
  | 'journal'
  | 'reference'
  | 'label'
  | 'debit'
  | 'credit'
  | 'balance';

const ACCOUNTING_GENERAL_LEDGER_TABLE_ID = 'accounting.generalLedger';
const GENERAL_LEDGER_PAGE_SIZE = 50;
const GENERAL_LEDGER_TABLE_COLUMNS: LiassTableColumnPreference[] = [
  { id: 'date', labelKey: 'ACCOUNTING.GENERAL_LEDGER.TABLE.DATE', required: true },
  { id: 'journal', labelKey: 'ACCOUNTING.GENERAL_LEDGER.TABLE.JOURNAL', required: true },
  { id: 'reference', labelKey: 'ACCOUNTING.GENERAL_LEDGER.TABLE.REFERENCE' },
  { id: 'label', labelKey: 'ACCOUNTING.GENERAL_LEDGER.TABLE.LABEL', required: true },
  { id: 'debit', labelKey: 'ACCOUNTING.GENERAL_LEDGER.TABLE.DEBIT', required: true },
  { id: 'credit', labelKey: 'ACCOUNTING.GENERAL_LEDGER.TABLE.CREDIT', required: true },
  { id: 'balance', labelKey: 'ACCOUNTING.GENERAL_LEDGER.TABLE.BALANCE', required: true }
];

@Component({
  selector: 'liass-general-ledger-page',
  imports: [
    FormsModule,
    AccountSearchSelectComponent,
    LiassButtonComponent,
    LiassCardComponent,
    FiscalYearRequiredComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    TranslocoModule
  ],
  templateUrl: './general-ledger.page.html'
})
export class GeneralLedgerPage {
  private readonly accountingApi = inject(AccountingApi);
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  protected readonly fiscalYearContext = inject(AccountingFiscalYearContextService);

  protected readonly selectedAccountId = signal<string | null>(null);
  private readonly routeFiscalYear = signal<string | null>(null);
  private readonly routeStartDate = signal<string | null>(null);
  private readonly routeEndDate = signal<string | null>(null);
  protected readonly selectedFiscalYear = computed(
    () =>
      this.routeFiscalYear() ??
      (this.fiscalYearContext.activeYear()
        ? String(this.fiscalYearContext.activeYear())
        : '')
  );
  protected readonly selectedStartDate = computed(
    () =>
      this.routeStartDate() ??
      this.fiscalYearContext.activeFiscalYear()?.startDate ??
      ''
  );
  protected readonly selectedEndDate = computed(
    () =>
      this.routeEndDate() ??
      this.fiscalYearContext.activeFiscalYear()?.endDate ??
      ''
  );
  protected readonly extraMovements = signal<GeneralLedgerLineDto[]>([]);
  protected readonly paginationState = signal<{
    finalBalance?: number;
    hasMore?: boolean;
    nextCursor?: string;
  }>({});
  protected readonly loadingMore = signal(false);
  protected readonly loadMoreError = signal(false);
  protected readonly visibleColumnIds = signal(
    loadTablePreferences(ACCOUNTING_GENERAL_LEDGER_TABLE_ID, GENERAL_LEDGER_TABLE_COLUMNS)
  );

  protected readonly ledgerQuery = injectQuery(() =>
    this.accountingQueries.generalLedger(
      {
        accountId: this.selectedAccountId() ?? '',
        endDate: this.selectedEndDate() || undefined,
        fiscalYear: this.selectedFiscalYear(),
        limit: GENERAL_LEDGER_PAGE_SIZE,
        startDate: this.selectedStartDate() || undefined
      },
      !!this.selectedAccountId() && /^\d{4}$/.test(this.selectedFiscalYear())
    )
  );

  protected readonly ledger = computed(() => this.ledgerQuery.data());
  protected readonly movements = computed(() => [
    ...(this.ledger()?.movements ?? []),
    ...this.extraMovements()
  ]);
  protected readonly hasMore = computed(() => {
    const pagination = this.paginationState();
    return pagination.hasMore ?? this.ledger()?.hasMore ?? false;
  });
  protected readonly nextCursor = computed(() => {
    const pagination = this.paginationState();
    return pagination.nextCursor ?? this.ledger()?.nextCursor;
  });
  protected readonly finalBalance = computed(() =>
    this.paginationState().finalBalance ?? this.ledger()?.finalBalance ?? 0
  );
  protected readonly ledgerErrorMessage = computed(() =>
    safeMessageFromError(this.ledgerQuery.error())
  );

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const accountId = params.get('account');
      const year = params.get('year');
      const startDate = params.get('startDate');
      const endDate = params.get('endDate');

      this.selectedAccountId.set(
        accountId && /^\d{8}$/.test(accountId) ? accountId : null
      );
      this.routeFiscalYear.set(year && /^\d{4}$/.test(year) ? year : null);
      this.routeStartDate.set(
        startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : null
      );
      this.routeEndDate.set(
        endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : null
      );
      this.resetPagination();
    });

    effect(() => {
      this.selectedFiscalYear();
      this.resetPagination();
    });
  }

  protected updateSelectedAccount(accountId: string | null): void {
    this.selectedAccountId.set(accountId);
    this.resetPagination();
  }

  protected isColumnVisible(columnId: GeneralLedgerColumnId): boolean {
    return this.visibleColumnIds().includes(columnId);
  }

  protected openTablePreferences(): void {
    const dialogRef = this.dialog.open(LiassTablePreferencesDialogComponent, {
      autoFocus: 'first-tabbable',
      data: {
        columns: GENERAL_LEDGER_TABLE_COLUMNS,
        tableId: ACCOUNTING_GENERAL_LEDGER_TABLE_ID,
        visibleColumnIds: this.visibleColumnIds()
      },
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '560px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((result) => {
      if (!result) {
        return;
      }

      this.visibleColumnIds.set(
        saveTablePreferences(
          ACCOUNTING_GENERAL_LEDGER_TABLE_ID,
          GENERAL_LEDGER_TABLE_COLUMNS,
          result.visibleColumnIds
        )
      );
    });
  }

  protected async retryInitialLoad(): Promise<void> {
    this.resetPagination();
    await this.ledgerQuery.refetch();
  }

  protected async loadMore(): Promise<void> {
    const accountId = this.selectedAccountId();
    const fiscalYear = this.selectedFiscalYear();
    const cursor = this.nextCursor();

    if (!accountId || !fiscalYear || !cursor || this.loadingMore()) {
      return;
    }

    this.loadingMore.set(true);
    this.loadMoreError.set(false);

    try {
      const result = await this.accountingApi.getGeneralLedger({
        accountId,
        cursor,
        endDate: this.selectedEndDate() || undefined,
        fiscalYear,
        limit: GENERAL_LEDGER_PAGE_SIZE,
        startDate: this.selectedStartDate() || undefined
      });

      this.extraMovements.update((movements) => [...movements, ...result.movements]);
      this.paginationState.set({
        finalBalance: result.finalBalance,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor
      });
    } catch {
      this.loadMoreError.set(true);
    } finally {
      this.loadingMore.set(false);
    }
  }

  protected formatAmount(amount: number): string {
    return new Intl.NumberFormat('fr-FR', {
      maximumFractionDigits: 0
    }).format(amount);
  }

  private resetPagination(): void {
    this.extraMovements.set([]);
    this.paginationState.set({});
    this.loadMoreError.set(false);
  }
}
