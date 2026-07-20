import { Component, computed, effect, inject, signal } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import {
  type BankStatementLineDto,
  type ReconciliationMatchDto,
  type TreasuryAccountDto,
  type TreasuryMovementDto
} from '@liass-ohada/shared/treasury';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { take } from 'rxjs';

import { safeMessageFromError } from '../../../core/notifications/notification-message';
import { NotificationService } from '../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../shared/ui/skeleton/skeleton.component';
import { LiassStatCardComponent } from '../../../shared/ui/stat-card/stat-card.component';
import { LiassStatusChipComponent, type LiassStatusTone } from '../../../shared/ui/status-chip/status-chip.component';
import { TreasuryApi } from '../data-access/treasury.api';
import { TreasuryQueries } from '../data-access/treasury-queries';
import { AuthStore } from '../../identity/data-access/auth.store';
import { CancelReconciliationDialogComponent } from './cancel-reconciliation-dialog.component';
import { CreateTreasuryAccountDialogComponent } from './create-treasury-account-dialog.component';
import { CreateTreasuryTransactionDialogComponent } from './create-treasury-transaction-dialog.component';
import { ImportBankStatementDialogComponent } from './import-bank-statement-dialog.component';

type StatementStatusFilter = 'ALL' | BankStatementLineDto['status'];
type StatementDirectionFilter = 'ALL' | BankStatementLineDto['direction'];
type ReconciliationDirectionFilter = 'ALL' | BankStatementLineDto['direction'];
type ReconciliationHistoryStatusFilter = 'ALL' | ReconciliationMatchDto['status'];

interface MatchEligibility {
  eligible: boolean;
  reasonKey: string;
}

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
  protected readonly authStore = inject(AuthStore);
  protected readonly canWriteAccounting = () => !this.authStore.isAccountingReadOnly?.();
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly transloco = inject(TranslocoService);
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
  protected readonly reconciliationDirectionFilter = signal<ReconciliationDirectionFilter>('ALL');
  protected readonly reconciliationStartDate = signal('');
  protected readonly reconciliationEndDate = signal('');
  protected readonly reconciliationHistoryStatusFilter = signal<ReconciliationHistoryStatusFilter>('ALL');
  protected readonly reconciliationHistoryExtraPages = signal<ReconciliationMatchDto[][]>([]);
  protected readonly nextReconciliationHistoryCursor = signal<string | null>(null);
  protected readonly loadingMoreReconciliationHistory = signal(false);
  protected readonly loadMoreReconciliationHistoryFailed = signal(false);
  protected readonly reconciliationBusy = signal(false);

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
  private readonly reconciliationStatementLineRequest = computed(() => ({
    year: this.selectedYear(),
    limit: 100,
    status: 'UNMATCHED' as const,
    ...(this.reconciliationDirectionFilter() !== 'ALL'
      ? { direction: this.reconciliationDirectionFilter() as BankStatementLineDto['direction'] }
      : {}),
    ...(this.reconciliationStartDate() ? { startDate: this.reconciliationStartDate() } : {}),
    ...(this.reconciliationEndDate() ? { endDate: this.reconciliationEndDate() } : {})
  }));
  private readonly reconciliationHistoryRequest = computed(() => ({
    year: this.selectedYear(),
    limit: 100,
    ...(this.reconciliationHistoryStatusFilter() !== 'ALL'
      ? { status: this.reconciliationHistoryStatusFilter() as ReconciliationMatchDto['status'] }
      : {})
  }));

  protected readonly accountsQuery = injectQuery(() => this.treasuryQueries.listAccounts());
  protected readonly summaryQuery = injectQuery(() => this.treasuryQueries.getSummary(this.selectedYear()));
  protected readonly movementsQuery = injectQuery(() =>
    this.treasuryQueries.listMovements(this.selectedAccountId(), this.selectedYear())
  );
  protected readonly statementLinesQuery = injectQuery(() =>
    this.treasuryQueries.listStatementLines(this.selectedAccountId(), this.statementLineRequest())
  );
  protected readonly reconciliationStatementLinesQuery = injectQuery(() =>
    this.treasuryQueries.listStatementLines(this.selectedAccountId(), this.reconciliationStatementLineRequest())
  );
  protected readonly reconciliationHistoryQuery = injectQuery(() =>
    this.treasuryQueries.listReconciliationMatches(this.selectedAccountId(), this.reconciliationHistoryRequest())
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
    this.reconciliationStatementLinesQuery.data()?.statementLines ?? []
  );
  protected readonly selectedStatementLine = computed(() =>
    this.unmatchedStatementLines().find((line) => line.statementLineId === this.selectedStatementLineId()) ?? null
  );
  protected readonly selectedMovement = computed(() =>
    this.movements().find((movement) => movement.lineId === this.selectedMovementLineId()) ?? null
  );
  protected readonly selectedMatchEligibility = computed(() =>
    this.matchEligibility(this.selectedStatementLine(), this.selectedMovement())
  );
  protected readonly suggestedMovements = computed(() =>
    this.movements()
      .map((movement) => ({ movement, score: this.matchSuggestionScore(movement) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .map(({ movement }) => movement.lineId)
  );
  protected readonly reconciliationHistoryPage = computed(() => this.reconciliationHistoryQuery.data());
  protected readonly reconciliationHistory = computed(() =>
    mergeReconciliationMatches([
      ...(this.reconciliationHistoryPage()?.matches ?? []),
      ...this.reconciliationHistoryExtraPages().flat()
    ])
  );
  protected readonly reconciliationHistoryCount = computed(
    () => this.reconciliationHistoryPage()?.count ?? this.reconciliationHistory().length
  );
  protected readonly hasMoreReconciliationHistory = computed(
    () =>
      Boolean(
        this.nextReconciliationHistoryCursor() ||
          (this.reconciliationHistoryExtraPages().length === 0 && this.reconciliationHistoryPage()?.nextCursor)
      )
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

    effect(() => {
      this.selectedAccountId();
      this.selectedYear();
      this.reconciliationDirectionFilter();
      this.reconciliationStartDate();
      this.reconciliationEndDate();
      this.selectedStatementLineId.set(null);
      this.selectedMovementLineId.set(null);
    });

    effect(() => {
      this.selectedAccountId();
      this.selectedYear();
      this.reconciliationHistoryStatusFilter();
      this.resetReconciliationHistoryPagination();
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

  protected updateReconciliationDirectionFilter(value: ReconciliationDirectionFilter): void {
    this.reconciliationDirectionFilter.set(value);
  }

  protected updateReconciliationStartDate(event: Event): void {
    this.reconciliationStartDate.set((event.target as HTMLInputElement).value);
  }

  protected updateReconciliationEndDate(event: Event): void {
    this.reconciliationEndDate.set((event.target as HTMLInputElement).value);
  }

  protected updateReconciliationHistoryStatusFilter(value: ReconciliationHistoryStatusFilter): void {
    this.reconciliationHistoryStatusFilter.set(value);
  }

  private resetStatementPagination(): void {
    this.statementExtraPages.set([]);
    this.nextStatementCursor.set(null);
    this.loadMoreStatementLinesFailed.set(false);
  }

  private resetReconciliationHistoryPagination(): void {
    this.reconciliationHistoryExtraPages.set([]);
    this.nextReconciliationHistoryCursor.set(null);
    this.loadMoreReconciliationHistoryFailed.set(false);
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

  protected async loadMoreReconciliationHistory(): Promise<void> {
    const cursor =
      this.nextReconciliationHistoryCursor() ||
      (this.reconciliationHistoryExtraPages().length === 0 ? this.reconciliationHistoryPage()?.nextCursor : null);

    if (!cursor || !this.selectedAccountId() || this.loadingMoreReconciliationHistory()) {
      return;
    }

    this.loadingMoreReconciliationHistory.set(true);
    this.loadMoreReconciliationHistoryFailed.set(false);

    try {
      const page = await this.treasuryApi.listReconciliationMatches({
        ...this.reconciliationHistoryRequest(),
        treasuryAccountId: this.selectedAccountId(),
        cursor
      });
      this.reconciliationHistoryExtraPages.update((pages) => [...pages, page.matches]);
      this.nextReconciliationHistoryCursor.set(page.nextCursor ?? null);
    } catch {
      this.loadMoreReconciliationHistoryFailed.set(true);
    } finally {
      this.loadingMoreReconciliationHistory.set(false);
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
      maxWidth: '95vw',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '760px'
    });
  }

  protected selectStatementLine(line: BankStatementLineDto): void {
    this.selectedStatementLineId.set(line.statementLineId);
    if (this.selectedMovement() && !this.matchEligibility(line, this.selectedMovement()).eligible) {
      this.selectedMovementLineId.set(null);
    }
  }

  protected selectMovement(movement: TreasuryMovementDto): void {
    this.selectedMovementLineId.set(movement.lineId);
  }

  protected async reconcileSelected(): Promise<void> {
    const statementLine = this.selectedStatementLine();
    const movement = this.selectedMovement();
    const eligibility = this.selectedMatchEligibility();

    if (!statementLine || !movement || !this.selectedAccountId() || !eligibility.eligible || this.reconciliationBusy()) {
      return;
    }

    this.reconciliationBusy.set(true);
    this.actionErrorKey.set(null);
    try {
      await this.treasuryApi.reconcile({
        treasuryAccountId: this.selectedAccountId(),
        year: this.selectedYear(),
        statementLineId: statementLine.statementLineId,
        statementDate: statementLine.statementDate,
        movementLineId: movement.lineId
      });
      this.selectedStatementLineId.set(null);
      this.selectedMovementLineId.set(null);
      this.notification.success(this.transloco.translate('TREASURY.RECONCILIATION.NOTIFICATIONS.MATCHED'));
      void this.invalidateReconciliationData();
    } catch (error) {
      this.notification.error(safeMessageFromError(error) ?? this.transloco.translate('TREASURY.ERRORS.RECONCILE_FAILED'));
      this.actionErrorKey.set('TREASURY.ERRORS.RECONCILE_FAILED');
    } finally {
      this.reconciliationBusy.set(false);
    }
  }

  protected openCancelReconciliation(match: ReconciliationMatchDto): void {
    if (match.status !== 'ACTIVE') {
      return;
    }

    const dialogRef = this.dialog.open(CancelReconciliationDialogComponent, {
      autoFocus: 'first-tabbable',
      data: { matchId: match.matchId },
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '520px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((reason: string | null | undefined) => {
      if (reason !== undefined) {
        void this.cancelReconciliationMatch(match, reason ?? undefined);
      }
    });
  }

  protected async cancelReconciliationMatch(match: ReconciliationMatchDto, cancelReason?: string): Promise<void> {
    if (match.status !== 'ACTIVE' || this.reconciliationBusy()) {
      return;
    }

    this.reconciliationBusy.set(true);
    this.actionErrorKey.set(null);
    try {
      await this.treasuryApi.cancelReconciliation({
        treasuryAccountId: this.selectedAccountId(),
        year: this.selectedYear(),
        matchId: match.matchId,
        cancelReason
      });
      this.notification.success(this.transloco.translate('TREASURY.RECONCILIATION.NOTIFICATIONS.CANCELLED'));
      void this.invalidateReconciliationData();
    } catch (error) {
      this.notification.error(safeMessageFromError(error) ?? this.transloco.translate('TREASURY.ERRORS.CANCEL_RECONCILE_FAILED'));
      this.actionErrorKey.set('TREASURY.ERRORS.CANCEL_RECONCILE_FAILED');
    } finally {
      this.reconciliationBusy.set(false);
    }
  }

  protected async cancelMatch(line: BankStatementLineDto): Promise<void> {
    if (!line.reconciliationMatchId || this.reconciliationBusy()) {
      return;
    }

    this.reconciliationBusy.set(true);
    this.actionErrorKey.set(null);
    try {
      await this.treasuryApi.cancelReconciliation({
        treasuryAccountId: this.selectedAccountId(),
        year: this.selectedYear(),
        matchId: line.reconciliationMatchId
      });
      this.notification.success(this.transloco.translate('TREASURY.RECONCILIATION.NOTIFICATIONS.CANCELLED'));
      void this.invalidateReconciliationData();
    } catch (error) {
      this.notification.error(safeMessageFromError(error) ?? this.transloco.translate('TREASURY.ERRORS.CANCEL_RECONCILE_FAILED'));
      this.actionErrorKey.set('TREASURY.ERRORS.CANCEL_RECONCILE_FAILED');
    } finally {
      this.reconciliationBusy.set(false);
    }
  }

  protected matchEligibility(
    statementLine: BankStatementLineDto | null,
    movement: TreasuryMovementDto | null
  ): MatchEligibility {
    if (!statementLine || !movement) {
      return { eligible: false, reasonKey: 'TREASURY.RECONCILIATION.ELIGIBILITY.MISSING_SELECTION' };
    }

    if (movement.reconciliationStatus === 'MATCHED') {
      return { eligible: false, reasonKey: 'TREASURY.RECONCILIATION.ELIGIBILITY.ALREADY_RECONCILED' };
    }

    if (this.selectedAccount()?.accountId && movement.accountId !== this.selectedAccount()?.accountId) {
      return { eligible: false, reasonKey: 'TREASURY.RECONCILIATION.ELIGIBILITY.ACCOUNT_MISMATCH' };
    }

    if (statementLine.amount !== movement.amount) {
      return { eligible: false, reasonKey: 'TREASURY.RECONCILIATION.ELIGIBILITY.AMOUNT_MISMATCH' };
    }

    if (statementLine.direction === 'INFLOW' && movement.debit !== statementLine.amount) {
      return { eligible: false, reasonKey: 'TREASURY.RECONCILIATION.ELIGIBILITY.DIRECTION_MISMATCH' };
    }

    if (statementLine.direction === 'OUTFLOW' && movement.credit !== statementLine.amount) {
      return { eligible: false, reasonKey: 'TREASURY.RECONCILIATION.ELIGIBILITY.DIRECTION_MISMATCH' };
    }

    return { eligible: true, reasonKey: 'TREASURY.RECONCILIATION.ELIGIBILITY.ELIGIBLE' };
  }

  protected movementEligibilityTone(movement: TreasuryMovementDto): LiassStatusTone {
    return this.matchEligibility(this.selectedStatementLine(), movement).eligible ? 'success' : 'neutral';
  }

  protected isMovementSuggested(movement: TreasuryMovementDto): boolean {
    return this.suggestedMovements().includes(movement.lineId);
  }

  protected matchSuggestionScore(movement: TreasuryMovementDto): number {
    const statementLine = this.selectedStatementLine();
    if (!statementLine || !this.matchEligibility(statementLine, movement).eligible) {
      return 0;
    }

    let score = 10;
    const dateDiff = Math.abs(daysBetween(statementLine.statementDate, movement.date));
    if (dateDiff === 0) {
      score += 6;
    } else if (dateDiff <= 3) {
      score += 4;
    } else if (dateDiff <= 7) {
      score += 2;
    }

    if (hasReferenceSimilarity(statementLine.reference, movement.reference)) {
      score += 4;
    }

    if (hasReferenceSimilarity(statementLine.description, movement.label)) {
      score += 2;
    }

    return score;
  }

  protected dateDifferenceLabel(): string {
    const statementLine = this.selectedStatementLine();
    const movement = this.selectedMovement();
    if (!statementLine || !movement) {
      return 'COMMON.EMPTY_VALUE';
    }

    const difference = Math.abs(daysBetween(statementLine.statementDate, movement.date));
    return difference === 0
      ? this.transloco.translate('TREASURY.RECONCILIATION.SUMMARY.SAME_DATE')
      : this.transloco.translate('TREASURY.RECONCILIATION.SUMMARY.DATE_DIFF', { count: difference });
  }

  protected async invalidateReconciliationData(): Promise<void> {
    const accountId = this.selectedAccountId();
    if (!accountId) {
      return;
    }

    await Promise.all([
      this.queryClient.invalidateQueries({ queryKey: this.treasuryQueries.statementLinesRootQueryKey(accountId) }),
      this.queryClient.invalidateQueries({ queryKey: this.treasuryQueries.movementsRootQueryKey(accountId) }),
      this.queryClient.invalidateQueries({ queryKey: this.treasuryQueries.reconciliationsRootQueryKey(accountId) }),
      this.queryClient.invalidateQueries({ queryKey: this.treasuryQueries.summaryRootQueryKey() })
    ]);
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

function mergeReconciliationMatches(matches: readonly ReconciliationMatchDto[]): ReconciliationMatchDto[] {
  const matchesById = new Map<string, ReconciliationMatchDto>();

  for (const match of matches) {
    matchesById.set(match.matchId, match);
  }

  return [...matchesById.values()].sort((left, right) =>
    `${right.matchedAt}#${right.matchId}`.localeCompare(`${left.matchedAt}#${left.matchId}`)
  );
}

function daysBetween(left: string, right: string): number {
  const leftDate = Date.parse(`${left}T00:00:00.000Z`);
  const rightDate = Date.parse(`${right}T00:00:00.000Z`);

  if (Number.isNaN(leftDate) || Number.isNaN(rightDate)) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Math.round((rightDate - leftDate) / 86_400_000);
}

function hasReferenceSimilarity(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeMatchText(left);
  const normalizedRight = normalizeMatchText(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function normalizeMatchText(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
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
