import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { type AccountDto } from '@liass-ohada/shared/accounting';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { AccountingApi } from '../../data-access/accounting.api';

export interface DisableAccountDialogData {
  account: AccountDto;
}

@Component({
  selector: 'liass-disable-account-dialog',
  imports: [LiassButtonComponent, MatDialogModule, MatIconModule, TranslocoModule],
  templateUrl: './disable-account-dialog.component.html'
})
export class DisableAccountDialogComponent {
  private readonly accountingApi = inject(AccountingApi);
  private readonly data = inject<DisableAccountDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<DisableAccountDialogComponent, AccountDto | null>>(
    MatDialogRef
  );
  private readonly notification = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);

  protected readonly account = this.data.account;
  protected readonly errorKey = signal<string | null>(null);
  protected readonly submitting = signal(false);

  protected async confirm(): Promise<void> {
    if (this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    try {
      const result = await this.accountingApi.disableAccount(this.account.accountId);

      this.notification.success(
        result.message ?? this.transloco.translate('ACCOUNTING.NOTIFICATIONS.ACCOUNT_DISABLED')
      );
      this.dialogRef.close(result.data);
    } catch (error) {
      const fallbackKey = 'ACCOUNTING.ERRORS.DISABLE_ACCOUNT_FAILED';

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
