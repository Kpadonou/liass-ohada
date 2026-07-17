import { Component, computed, effect, inject, signal } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import {
  type BankStatementLineDto,
  type TreasuryAccountDto,
  type TreasuryMovementDto
} from '@liass-ohada/shared/treasury';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { take } from 'rxjs';

import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../shared/ui/skeleton/skeleton.component';
import { LiassStatCardComponent } from '../../../shared/ui/stat-card/stat-card.component';
import { LiassStatusChipComponent, type LiassStatusTone } from '../../../shared/ui/status-chip/status-chip.component';
import { TreasuryApi } from '../data-access/treasury.api';
import { TreasuryQueries } from '../data-access/treasury-queries';
import { CreateTreasuryAccountDialogComponent } from './create-treasury-account-dialog.component';
import { CreateTreasuryTransactionDialogComponent } from './create-treasury-transaction-dialog.component';
import { ImportBankStatementDialogComponent } from './import-bank-statement-dialog.component';

type StatementStatusFilter = 'ALL' | BankStatementLineDto['status'];
type StatementDirectionFilter = 'ALL' | BankStatementLineDto['direction'];

@Component({
  selector: 'liass-treasury-page',
  imports: [
    LiassButtonComponent,
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    LiassStatCardComponent,
    LiassStatusChipComponent,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTabsModule,
    TranslocoModule
  ],
  templateUrl: './treasury.page.html'
})
export class TreasuryPage {
  private readonly dialog = inject(MatDialog);
  private readonly queryClient = inject(QueryClient);
  private readonly treasuryApi = inject(TreasuryApi);
  private readonly treasuryQueries = inject(TreasuryQueries);

  protected readonly selectedYear = signal(String(new Date().getFullYear()));
  protected readonly selectedAccountId = signal('');
  protected readonly activeTabIndex = signal(0);
  protected readonly selectedStatementLineId = signal<string | null>(null);
  protected readonly selectedMovementLineId = signal<string | null>(null);
  protected readonly actionErrorKey = signal<string | null>(null);
  protected readonly accountExtraPages = signal<TreasuryAccountDto[][]>([]);
  protected readonly localAccountUpserts = signal<TreasuryAccountDto[]>([]);
  protected readonly loadingMoreAccounts = signal(false);
  protected readonly loadMoreAccountsFailed = signal(false);
  protected readonly statementStatusFilter = signal<StatementStatusFilter>('ALL');
  protected readonly statementDirectionFilter = signal<StatementDirectionFilter>('ALL');
  protected readonly statementStartDate = signal('');
  protected readonly statementEndDate = signal('');
  protected readonly statementExtraPages = signal<BankStatementLineDto[][]>([]);
  protected readonly nextStatementCursor = signal<string | null>(null);
  protected readonly loadingMoreStatementLines = signal(false);
  protected readonly loadMoreStatementLinesFailed = signal(false);

  private readonly statementLineRequest = computed(() => ({
    year: this.selectedYear(),
    limit: 100,
    ...(this.statementStatusFilter() !== 'ALL' ? { status: this.statementStatusFilter() as BankStatementLineDto['status'] } : {}),
    ...(this.statementDirectionFilter() !== 'ALL'
      ? { direction: this.statementDirectionFilter() as BankStatementLineDto['direction'] }
      : {}),
    ...(this.statementStartDate() ? { startDate: this.statementStartDate() } : {}),
    ...(this.statementEndDate() ? { endDate: this.statementEndDate() } : {})
  }));

  protected readonly accountsQuery = injectQuery(() => this.treasuryQueries.listAccounts());
  protected readonly summaryQuery = injectQuery(() => this.treasuryQueries.getSummary(this.selectedYear()));
  protected readonly movementsQuery = injectQuery(() =>
    this.treasuryQueries.listMovements(this.selectedAccountId(), this.selectedYear())
  );
  protected readonly statementLinesQuery = injectQuery(() =>
    this.treasuryQueries.listStatementLines(this.selectedAccountId(), this.statementLineRequest())
  );

  protected readonly accountsPage = computed(() => this.accountsQuery.data());
  protected readonly accounts = computed(() =>
    mergeTreasuryAccounts(
      [
        ...(this.accountsPage()?.accounts ?? []),
        ...this.accountExtraPages().flat()
      ],
      this.localAccountUpserts()
    )
  );
  protected readonly treasuryAccountsCount = computed(
    () => this.summaryQuery.data()?.accountsCount ?? this.accountsPage()?.count ?? this.accounts().length
  );
  protected readonly nextAccountsCursor = signal<string | null>(null);
  protected readonly hasMoreAccounts = computed(
    () =>
      Boolean(
        this.nextAccountsCursor() ||
          (this.accountExtraPages().length === 0 && this.accountsPage()?.nextCursor)
      )
  );
  protected readonly movements = computed(() => this.movementsQuery.data() ?? []);
  protected readonly statementLinesPage = computed(() => this.statementLinesQuery.data());
  protected readonly statementLines = computed(() =>
    mergeStatementLines([
      ...(this.statementLinesPage()?.statementLines ?? []),
      ...this.statementExtraPages().flat()
    ])
  );
  protected readonly statementLinesCount = computed(
    () => this.statementLinesPage()?.count ?? this.statementLines().length
  );
  protected readonly hasMoreStatementLines = computed(
    () =>
      Boolean(
        this.nextStatementCursor() ||
          (this.statementExtraPages().length === 0 && this.statementLinesPage()?.nextCursor)
      )
  );
  protected readonly unmatchedMovements = computed(() =>
    this.movements().filter((movement) => movement.reconciliationStatus !== 'MATCHED')
  );
  protected readonly unmatchedStatementLines = computed(() =>
    this.statementLines().filter((line) => line.status === 'UNMATCHED')
  );
  protected readonly selectedAccount = computed(() =>
    this.accounts().find((account) => account.treasuryAccountId === this.selectedAccountId())
  );

  constructor() {
    effect(() => {
      const accounts = this.accounts();
      if (!this.selectedAccountId() && accounts.length > 0) {
        this.selectedAccountId.set(accounts[0].treasuryAccountId);
      } else if (accounts.length === 0 && this.selectedAccountId()) {
        this.selectedAccountId.set('');
      } else if (
        this.selectedAccountId() &&
        accounts.length > 0 &&
        !accounts.some((account) => account.treasuryAccountId === this.selectedAccountId())
      ) {
        this.selectedAccountId.set(accounts[0].treasuryAccountId);
      }
    });

    effect(() => {
      this.selectedAccountId();
      this.selectedYear();
      this.statementStatusFilter();
      this.statementDirectionFilter();
      this.statementStartDate();
      this.statementEndDate();
      this.resetStatementPagination();
    });
  }

  protected updateYear(event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    if (/^\d{4}$/.test(value)) {
      this.selectedYear.set(value);
    }
  }

  protected formatAmount(amount: number, currency = 'XOF'): string {
    return new Intl.NumberFormat('fr-FR', {
      maximumFractionDigits: 0,
      style: 'currency',
      currency
    }).format(amount);
  }

  protected accountLabel(account: TreasuryAccountDto): string {
    return `${account.accountId} - ${account.label}`;
  }

  protected accountStatusTone(account: TreasuryAccountDto): LiassStatusTone {
    return account.active ? 'success' : 'neutral';
  }

  protected statusTone(status: BankStatementLineDto['status']): LiassStatusTone {
    return status === 'MATCHED' ? 'success' : status === 'IGNORED' ? 'neutral' : 'warning';
  }

  protected directionTone(direction: BankStatementLineDto['direction']): LiassStatusTone {
    return direction === 'INFLOW' ? 'success' : 'warning';
  }

  protected movementLabel(movement: TreasuryMovementDto): string {
    return `${movement.date} - ${movement.label}`;
  }

  protected selectTreasuryAccount(treasuryAccountId: string): void {
    this.selectedAccountId.set(treasuryAccountId);
  }

  protected updateStatementStatusFilter(value: StatementStatusFilter): void {
    this.statementStatusFilter.set(value);
  }

  protected updateStatementDirectionFilter(value: StatementDirectionFilter): void {
    this.statementDirectionFilter.set(value);
  }

  protected updateStatementStartDate(event: Event): void {
    this.statementStartDate.set((event.target as HTMLInputElement).value);
  }

  protected updateStatementEndDate(event: Event): void {
    this.statementEndDate.set((event.target as HTMLInputElement).value);
  }

  private resetStatementPagination(): void {
    this.statementExtraPages.set([]);
    this.nextStatementCursor.set(null);
    this.loadMoreStatementLinesFailed.set(false);
  }

  protected openCreateAccount(): void {
    const dialogRef = this.dialog.open(CreateTreasuryAccountDialogComponent, {
      autoFocus: 'first-tabbable',
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '720px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((account: TreasuryAccountDto | null | undefined) => {
      if (account) {
        this.localAccountUpserts.update((accounts) => mergeTreasuryAccounts(accounts, [account]));
        this.selectedAccountId.set(account.treasuryAccountId);
        void this.queryClient.invalidateQueries({
          queryKey: this.treasuryQueries.accountsRootQueryKey()
        });
        void this.queryClient.invalidateQueries({
          queryKey: this.treasuryQueries.summaryRootQueryKey()
        });
      }
    });
  }

  protected async loadMoreAccounts(): Promise<void> {
    const cursor =
      this.nextAccountsCursor() ||
      (this.accountExtraPages().length === 0 ? this.accountsPage()?.nextCursor : null);

    if (!cursor || this.loadingMoreAccounts()) {
      return;
    }

    this.loadingMoreAccounts.set(true);
    this.loadMoreAccountsFailed.set(false);

    try {
      const page = await this.treasuryApi.listAccounts({ cursor, limit: 100 });
      this.accountExtraPages.update((pages) => [...pages, page.accounts]);
      this.nextAccountsCursor.set(page.nextCursor ?? null);
    } catch {
      this.loadMoreAccountsFailed.set(true);
    } finally {
      this.loadingMoreAccounts.set(false);
    }
  }

  protected async loadMoreStatementLines(): Promise<void> {
    const cursor =
      this.nextStatementCursor() ||
      (this.statementExtraPages().length === 0 ? this.statementLinesPage()?.nextCursor : null);

    if (!cursor || !this.selectedAccountId() || this.loadingMoreStatementLines()) {
      return;
    }

    this.loadingMoreStatementLines.set(true);
    this.loadMoreStatementLinesFailed.set(false);

    try {
      const page = await this.treasuryApi.listStatementLines(this.selectedAccountId(), {
        ...this.statementLineRequest(),
        cursor
      });
      this.statementExtraPages.update((pages) => [...pages, page.statementLines]);
      this.nextStatementCursor.set(page.nextCursor ?? null);
    } catch {
      this.loadMoreStatementLinesFailed.set(true);
    } finally {
      this.loadingMoreStatementLines.set(false);
    }
  }

  protected openCreateTransaction(): void {
    const dialogRef = this.dialog.open(CreateTreasuryTransactionDialogComponent, {
      autoFocus: 'first-tabbable',
      data: {
        accounts: this.accounts(),
        selectedAccountId: this.selectedAccountId(),
        year: this.selectedYear()
      },
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '760px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((entryId: string | null | undefined) => {
      if (entryId) {
        void this.movementsQuery.refetch();
        void this.summaryQuery.refetch();
      }
    });
  }

  protected openImportStatementDialog(): void {
    const account = this.selectedAccount();
    if (!account) {
      return;
    }

    this.dialog.open(ImportBankStatementDialogComponent, {
      autoFocus: 'first-tabbable',
      data: {
        treasuryAccountId: account.treasuryAccountId,
        year: this.selectedYear(),
        currency: account.currency
      },
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '1100px'
    });
  }

  protected selectStatementLine(line: BankStatementLineDto): void {
    this.selectedStatementLineId.set(line.statementLineId);
  }

  protected selectMovement(movement: TreasuryMovementDto): void {
    this.selectedMovementLineId.set(movement.lineId);
  }

  protected async reconcileSelected(): Promise<void> {
    const statementLineId = this.selectedStatementLineId();
    const lineId = this.selectedMovementLineId();
    const statementLine = this.statementLines().find(
      (item) => item.statementLineId === statementLineId,
    );
    const movement = this.movements().find((item) => item.lineId === lineId);
    if (
      !statementLineId ||
      !lineId ||
      !statementLine ||
      !movement ||
      !this.selectedAccountId()
    ) {
      return;
    }

    this.actionErrorKey.set(null);
    try {
      await this.treasuryApi.reconcile({
        treasuryAccountId: this.selectedAccountId(),
        year: this.selectedYear(),
        statementLineId,
        statementDate: statementLine.statementDate,
        entryId: movement.entryId,
        movementLineId: lineId
      });
      this.selectedStatementLineId.set(null);
      this.selectedMovementLineId.set(null);
      void this.statementLinesQuery.refetch();
      void this.movementsQuery.refetch();
      void this.summaryQuery.refetch();
    } catch {
      this.actionErrorKey.set('TREASURY.ERRORS.RECONCILE_FAILED');
    }
  }

  protected async cancelMatch(line: BankStatementLineDto): Promise<void> {
    if (!line.reconciliationMatchId || !line.matchedEntryId || !line.matchedLineId) {
      return;
    }

    this.actionErrorKey.set(null);
    try {
      await this.treasuryApi.cancelReconciliation({
        treasuryAccountId: this.selectedAccountId(),
        year: this.selectedYear(),
        matchId: line.reconciliationMatchId
      });
      void this.statementLinesQuery.refetch();
      void this.movementsQuery.refetch();
      void this.summaryQuery.refetch();
    } catch {
      this.actionErrorKey.set('TREASURY.ERRORS.CANCEL_RECONCILE_FAILED');
    }
  }
}

function mergeStatementLines(lines: readonly BankStatementLineDto[]): BankStatementLineDto[] {
  const linesById = new Map<string, BankStatementLineDto>();

  for (const line of lines) {
    linesById.set(line.statementLineId, line);
  }

  return [...linesById.values()].sort((left, right) =>
    `${left.statementDate}#${left.statementLineId}`.localeCompare(`${right.statementDate}#${right.statementLineId}`)
  );
}

function mergeTreasuryAccounts(
  baseAccounts: readonly TreasuryAccountDto[],
  upserts: readonly TreasuryAccountDto[]
): TreasuryAccountDto[] {
  const accountsById = new Map<string, TreasuryAccountDto>();

  for (const account of baseAccounts) {
    accountsById.set(account.treasuryAccountId, account);
  }

  for (const account of upserts) {
    accountsById.set(account.treasuryAccountId, account);
  }

  return [...accountsById.values()].sort((left, right) =>
    left.accountId.localeCompare(right.accountId)
  );
}
