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
import { injectQuery } from '@tanstack/angular-query-experimental';
import { take } from 'rxjs';

import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../shared/ui/skeleton/skeleton.component';
import { LiassStatCardComponent } from '../../../shared/ui/stat-card/stat-card.component';
import { LiassStatusChipComponent, type LiassStatusTone } from '../../../shared/ui/status-chip/status-chip.component';
import { TreasuryApi } from '../data-access/treasury.api';
import { TreasuryQueries } from '../data-access/treasury-queries';
import { parseBankStatementCsv } from '../utils/bank-statement-csv';
import { CreateTreasuryAccountDialogComponent } from './create-treasury-account-dialog.component';
import { CreateTreasuryTransactionDialogComponent } from './create-treasury-transaction-dialog.component';

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
  private readonly treasuryApi = inject(TreasuryApi);
  private readonly treasuryQueries = inject(TreasuryQueries);

  protected readonly selectedYear = signal(String(new Date().getFullYear()));
  protected readonly selectedAccountId = signal('');
  protected readonly importText = signal('');
  protected readonly selectedStatementLineId = signal<string | null>(null);
  protected readonly selectedMovementLineId = signal<string | null>(null);
  protected readonly importResult = signal<{ imported: number; skipped: number } | null>(null);
  protected readonly actionErrorKey = signal<string | null>(null);

  protected readonly accountsQuery = injectQuery(() => this.treasuryQueries.listAccounts());
  protected readonly summaryQuery = injectQuery(() => this.treasuryQueries.getSummary(this.selectedYear()));
  protected readonly movementsQuery = injectQuery(() =>
    this.treasuryQueries.listMovements(this.selectedAccountId(), this.selectedYear())
  );
  protected readonly statementLinesQuery = injectQuery(() =>
    this.treasuryQueries.listStatementLines(this.selectedAccountId(), this.selectedYear())
  );

  protected readonly accounts = computed(() => this.accountsQuery.data() ?? []);
  protected readonly movements = computed(() => this.movementsQuery.data() ?? []);
  protected readonly statementLines = computed(() => this.statementLinesQuery.data() ?? []);
  protected readonly unmatchedMovements = computed(() =>
    this.movements().filter((movement) => movement.reconciliationStatus !== 'MATCHED')
  );
  protected readonly unmatchedStatementLines = computed(() =>
    this.statementLines().filter((line) => line.status === 'UNMATCHED')
  );
  protected readonly selectedAccount = computed(() =>
    this.accounts().find((account) => account.treasuryAccountId === this.selectedAccountId())
  );
  protected readonly parsedImport = computed(() => parseBankStatementCsv(this.importText()));

  constructor() {
    effect(() => {
      const accounts = this.accounts();
      if (!this.selectedAccountId() && accounts.length > 0) {
        this.selectedAccountId.set(accounts[0].treasuryAccountId);
      }
    });
  }

  protected updateYear(event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    if (/^\d{4}$/.test(value)) {
      this.selectedYear.set(value);
    }
  }

  protected updateImportText(event: Event): void {
    this.importText.set((event.target as HTMLTextAreaElement).value);
    this.importResult.set(null);
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

  protected statusTone(status: BankStatementLineDto['status']): LiassStatusTone {
    return status === 'MATCHED' ? 'success' : status === 'IGNORED' ? 'neutral' : 'warning';
  }

  protected movementLabel(movement: TreasuryMovementDto): string {
    return `${movement.date} - ${movement.label}`;
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
        this.selectedAccountId.set(account.treasuryAccountId);
        void this.accountsQuery.refetch();
        void this.summaryQuery.refetch();
      }
    });
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

  protected async importStatement(): Promise<void> {
    const parsed = this.parsedImport();
    if (!this.selectedAccountId() || parsed.lines.length === 0 || parsed.errors.length > 0) {
      return;
    }

    this.actionErrorKey.set(null);
    try {
      const result = await this.treasuryApi.importStatementLines(this.selectedAccountId(), {
        year: this.selectedYear(),
        lines: parsed.lines
      });
      this.importResult.set({ imported: result.imported, skipped: result.skipped });
      void this.statementLinesQuery.refetch();
      void this.summaryQuery.refetch();
    } catch {
      this.actionErrorKey.set('TREASURY.ERRORS.IMPORT_FAILED');
    }
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
    const movement = this.movements().find((item) => item.lineId === lineId);
    if (!statementLineId || !lineId || !movement || !this.selectedAccountId()) {
      return;
    }

    this.actionErrorKey.set(null);
    try {
      await this.treasuryApi.reconcile({
        treasuryAccountId: this.selectedAccountId(),
        year: this.selectedYear(),
        statementLineId,
        entryId: movement.entryId,
        lineId
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
        statementLineId: line.statementLineId,
        entryId: line.matchedEntryId,
        lineId: line.matchedLineId,
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
