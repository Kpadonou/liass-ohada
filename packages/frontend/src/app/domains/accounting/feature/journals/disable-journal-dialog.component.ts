import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { type JournalDto } from '@liass-ohada/shared/accounting';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { AccountingApi } from '../../data-access/accounting.api';

export interface DisableJournalDialogData {
  journal: JournalDto;
}

@Component({
  selector: 'liass-disable-journal-dialog',
  imports: [LiassButtonComponent, MatDialogModule, MatIconModule, TranslocoModule],
  templateUrl: './disable-journal-dialog.component.html'
})
export class DisableJournalDialogComponent {
  private readonly accountingApi = inject(AccountingApi);
  private readonly data = inject<DisableJournalDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<DisableJournalDialogComponent, string | null>>(
    MatDialogRef
  );

  protected readonly journal = this.data.journal;
  protected readonly errorKey = signal<string | null>(null);
  protected readonly submitting = signal(false);

  protected async confirm(): Promise<void> {
    if (this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    try {
      await this.accountingApi.disableJournal(this.journal.journalCode);
      this.dialogRef.close(this.journal.journalCode);
    } catch {
      this.errorKey.set('ACCOUNTING.ERRORS.DISABLE_JOURNAL_FAILED');
    } finally {
      this.submitting.set(false);
    }
  }

  protected cancel(): void {
    if (!this.submitting()) {
      this.dialogRef.close(null);
    }
  }
}
