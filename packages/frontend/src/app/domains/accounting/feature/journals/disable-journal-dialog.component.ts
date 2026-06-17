import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { type JournalDto } from '@liass-ohada/shared/accounting';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
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
  private readonly notification = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);

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
      const result = await this.accountingApi.disableJournal(this.journal.journalCode);

      this.notification.success(
        result.message ?? this.transloco.translate('ACCOUNTING.NOTIFICATIONS.JOURNAL_DISABLED')
      );
      this.dialogRef.close(this.journal.journalCode);
    } catch (error) {
      const fallbackKey = 'ACCOUNTING.ERRORS.DISABLE_JOURNAL_FAILED';

      this.errorKey.set(fallbackKey);
      this.notification.error(safeMessageFromError(error) ?? this.transloco.translate(fallbackKey));
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
