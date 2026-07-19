import { Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslocoModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { safeMessageFromError } from '../../../core/notifications/notification-message';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { LiassStatusChipComponent, type LiassStatusTone } from '../../../shared/ui/status-chip/status-chip.component';
import { TreasuryApi, type ImportStatementLinesResult } from '../data-access/treasury.api';
import { TreasuryQueries } from '../data-access/treasury-queries';
import {
  parseBankStatementFile,
  type BankStatementImportPreview,
  type BankStatementImportRow
} from '../utils/bank-statement-import';
import { downloadBankStatementTemplate } from '../utils/bank-statement-template';

export interface ImportBankStatementDialogData {
  treasuryAccountId: string;
  year: string;
  currency: string;
}

@Component({
  selector: 'liass-import-bank-statement-dialog',
  imports: [
    LiassButtonComponent,
    LiassStatusChipComponent,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    TranslocoModule
  ],
  templateUrl: './import-bank-statement-dialog.component.html'
})
export class ImportBankStatementDialogComponent {
  private readonly data = inject<ImportBankStatementDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<ImportBankStatementDialogComponent, ImportStatementLinesResult | null>>(
    MatDialogRef
  );
  private readonly queryClient = inject(QueryClient);
  private readonly treasuryApi = inject(TreasuryApi);
  private readonly treasuryQueries = inject(TreasuryQueries);

  protected readonly parsing = signal(false);
  protected readonly submitting = signal(false);
  protected readonly preview = signal<BankStatementImportPreview | null>(null);
  protected readonly result = signal<ImportStatementLinesResult | null>(null);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly selectedFileName = signal<string | null>(null);

  protected readonly canImport = computed(() => {
    const preview = this.preview();
    return Boolean(
      preview &&
        preview.validRows.length > 0 &&
        preview.invalidRows.length === 0 &&
        !this.submitting() &&
        !this.result()
    );
  });

  protected readonly allRows = computed(() => this.preview()?.rows.slice(0, 100) ?? []);

  protected isStepActive(index: number): boolean {
    if (index === 0) {
      return true;
    }

    if (index === 1) {
      return Boolean(this.preview());
    }

    return Boolean(this.result());
  }

  protected async downloadTemplate(): Promise<void> {
    await downloadBankStatementTemplate();
  }

  protected async handleFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file || this.parsing()) {
      return;
    }

    this.result.set(null);
    this.errorKey.set(null);
    this.errorMessage.set(null);
    this.selectedFileName.set(file.name);
    this.parsing.set(true);

    try {
      this.preview.set(await parseBankStatementFile(file, this.data.currency));
    } catch (error) {
      this.errorMessage.set(safeMessageFromError(error));
      this.errorKey.set('TREASURY.IMPORT.ERRORS.PARSE_FAILED');
      this.preview.set(null);
    } finally {
      this.parsing.set(false);
      input.value = '';
    }
  }

  protected async confirmImport(): Promise<void> {
    const preview = this.preview();
    if (!preview || !this.canImport()) {
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);
    this.errorMessage.set(null);

    try {
      const result = await this.treasuryApi.importStatementLines(this.data.treasuryAccountId, {
        year: this.data.year,
        lines: preview.validRows.flatMap((row) => (row.line ? [row.line] : []))
      });
      this.result.set(result);
      await this.queryClient.invalidateQueries({
        queryKey: this.treasuryQueries.statementLinesRootQueryKey(this.data.treasuryAccountId)
      });
      await this.queryClient.invalidateQueries({
        queryKey: this.treasuryQueries.summaryRootQueryKey()
      });
    } catch (error) {
      this.errorMessage.set(safeMessageFromError(error));
      this.errorKey.set('TREASURY.IMPORT.ERRORS.SUBMIT_FAILED');
    } finally {
      this.submitting.set(false);
    }
  }

  protected close(): void {
    this.dialogRef.close(this.result());
  }

  protected formatAmount(amount: number): string {
    return new Intl.NumberFormat('fr-FR', {
      maximumFractionDigits: 0,
      style: 'currency',
      currency: this.data.currency
    }).format(amount);
  }

  protected directionTone(direction: 'INFLOW' | 'OUTFLOW'): LiassStatusTone {
    return direction === 'INFLOW' ? 'success' : 'warning';
  }

  protected rowStatus(row: BankStatementImportRow): string {
    return row.line ? 'TREASURY.IMPORT.PREVIEW.STATUS_VALID' : 'TREASURY.IMPORT.PREVIEW.STATUS_INVALID';
  }

  protected rowTone(row: BankStatementImportRow): LiassStatusTone {
    return row.line ? 'success' : 'danger';
  }
}
