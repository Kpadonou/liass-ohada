import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { type AccountDto } from '@liass-ohada/shared/accounting';
import { type CreateTreasuryAccountRequest, type TreasuryAccountDto } from '@liass-ohada/shared/treasury';
import { TranslocoModule } from '@ngneat/transloco';

import { safeMessageFromError } from '../../../core/notifications/notification-message';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { AccountSearchSelectComponent } from '../../accounting/ui/account-search-select/account-search-select.component';
import { TreasuryApi } from '../data-access/treasury.api';

@Component({
  selector: 'liass-create-treasury-account-dialog',
  imports: [
    AccountSearchSelectComponent,
    LiassButtonComponent,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslocoModule
  ],
  templateUrl: './create-treasury-account-dialog.component.html'
})
export class CreateTreasuryAccountDialogComponent {
  private readonly dialogRef = inject<MatDialogRef<CreateTreasuryAccountDialogComponent, TreasuryAccountDto | null>>(
    MatDialogRef
  );
  private readonly formBuilder = inject(FormBuilder);
  private readonly treasuryApi = inject(TreasuryApi);

  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    accountId: ['', [Validators.required, Validators.pattern(/^5\d{7}$/)]],
    label: ['', [Validators.required]],
    type: ['BANK' as CreateTreasuryAccountRequest['type'], [Validators.required]],
    currency: ['XOF', [Validators.required, Validators.minLength(3), Validators.maxLength(3)]],
    bankName: [''],
    bankAccountNumber: [''],
    openingBalance: [0, [Validators.required]]
  });

  protected handleAccountSelected(account: AccountDto | null): void {
    const labelControl = this.form.controls.label;

    if (account && !labelControl.value.trim()) {
      labelControl.setValue(account.accountName);
    }
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    this.submitting.set(true);
    this.errorKey.set(null);
    this.errorMessage.set(null);

    try {
      const account = await this.treasuryApi.createAccount({
        accountId: raw.accountId,
        label: raw.label.trim(),
        type: raw.type,
        currency: raw.currency.trim().toUpperCase(),
        bankName: raw.bankName.trim() || undefined,
        bankAccountNumber: raw.bankAccountNumber.trim() || undefined,
        openingBalance: Number(raw.openingBalance)
      });
      this.dialogRef.close(account);
    } catch (error) {
      this.errorMessage.set(safeMessageFromError(error));
      this.errorKey.set('TREASURY.ERRORS.CREATE_ACCOUNT_FAILED');
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
