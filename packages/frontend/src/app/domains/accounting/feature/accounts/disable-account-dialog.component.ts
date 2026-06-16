import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { type AccountDto } from '@liass-ohada/shared/accounting';
import { TranslocoModule } from '@ngneat/transloco';

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
      const account = await this.accountingApi.disableAccount(this.account.accountId);
      this.dialogRef.close(account);
    } catch {
      this.errorKey.set('ACCOUNTING.ERRORS.DISABLE_ACCOUNT_FAILED');
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
