import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  type AccountDto,
  type CreateAccountRequest
} from '@liass-ohada/shared/accounting';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { AccountingApi } from '../../data-access/accounting.api';

export interface AccountDialogData {
  account?: AccountDto;
  mode: 'create' | 'edit';
}

@Component({
  selector: 'liass-account-dialog',
  imports: [
    LiassButtonComponent,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslocoModule
  ],
  templateUrl: './account-dialog.component.html'
})
export class AccountDialogComponent {
  private readonly accountingApi = inject(AccountingApi);
  private readonly data = inject<AccountDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<AccountDialogComponent, AccountDto | null>>(
    MatDialogRef
  );
  private readonly formBuilder = inject(FormBuilder);
  private readonly notification = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);

  protected readonly classCodes = [1, 2, 3, 4, 5, 6, 7, 8] as const;
  protected readonly errorKey = signal<string | null>(null);
  protected readonly isEditMode = this.data.mode === 'edit';
  protected readonly submitting = signal(false);

  protected readonly form = this.formBuilder.nonNullable.group({
    accountId: [
      { disabled: this.isEditMode, value: this.data.account?.accountId ?? '' },
      [Validators.required, Validators.pattern(/^\d{1,8}$/)]
    ],
    accountName: [this.data.account?.accountName ?? '', [Validators.required, Validators.maxLength(180)]],
    accountNature: [
      (this.data.account?.accountNature ?? 'BALANCE') as CreateAccountRequest['accountNature'],
      [Validators.required]
    ],
    accountUsage: [
      (this.data.account?.accountUsage ?? 'BOTH') as CreateAccountRequest['accountUsage'],
      [Validators.required]
    ],
    isThirdPartyAccount: [this.data.account?.isThirdPartyAccount ?? false],
    classCode: [this.data.account?.classCode ?? 1, [Validators.required, Validators.min(1), Validators.max(8)]],
    financialStatementCode: [
      this.data.account?.financialStatementCode ?? 'SYSCOHADA_CLASS_1',
      [Validators.required, Validators.maxLength(64)]
    ],
    allowReconciliation: [this.data.account?.allowReconciliation ?? false]
  });

  protected readonly titleKey = this.isEditMode
    ? 'ACCOUNTING.ACCOUNTS.DIALOG.EDIT_TITLE'
    : 'ACCOUNTING.ACCOUNTS.DIALOG.CREATE_TITLE';
  protected readonly eyebrowKey = this.isEditMode
    ? 'ACCOUNTING.ACCOUNTS.DIALOG.EDIT_EYEBROW'
    : 'ACCOUNTING.ACCOUNTS.DIALOG.CREATE_EYEBROW';
  protected readonly subtitleKey = this.isEditMode
    ? 'ACCOUNTING.ACCOUNTS.DIALOG.EDIT_SUBTITLE'
    : 'ACCOUNTING.ACCOUNTS.DIALOG.CREATE_SUBTITLE';

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    try {
      const raw = this.form.getRawValue();
      const payload = {
        accountName: raw.accountName.trim(),
        accountNature: raw.accountNature as CreateAccountRequest['accountNature'],
        accountUsage: raw.accountUsage as CreateAccountRequest['accountUsage'],
        isThirdPartyAccount: raw.isThirdPartyAccount,
        classCode: Number(raw.classCode),
        financialStatementCode: raw.financialStatementCode.trim(),
        allowReconciliation: raw.allowReconciliation
      };
      const result = this.isEditMode
        ? await this.accountingApi.updateAccount(this.data.account!.accountId, payload)
        : await this.accountingApi.createAccount({
            ...payload,
            accountId: raw.accountId.trim()
          });
      const fallbackKey = this.isEditMode
        ? 'ACCOUNTING.NOTIFICATIONS.ACCOUNT_UPDATED'
        : 'ACCOUNTING.NOTIFICATIONS.ACCOUNT_CREATED';

      this.notification.success(result.message ?? this.transloco.translate(fallbackKey));
      this.dialogRef.close(result.data);
    } catch (error) {
      const fallbackKey =
        this.isEditMode
          ? 'ACCOUNTING.ERRORS.UPDATE_ACCOUNT_FAILED'
          : 'ACCOUNTING.ERRORS.CREATE_ACCOUNT_FAILED';

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
