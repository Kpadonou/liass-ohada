import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { type AccountDto } from '@liass-ohada/shared/accounting';
import { type TreasuryAccountDto } from '@liass-ohada/shared/treasury';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { AccountSearchSelectComponent } from '../../accounting/ui/account-search-select/account-search-select.component';
import { TreasuryApi } from '../data-access/treasury.api';

interface CreateTreasuryTransactionDialogData {
  accounts: TreasuryAccountDto[];
  selectedAccountId: string;
  year: string;
}

@Component({
  selector: 'liass-create-treasury-transaction-dialog',
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
  templateUrl: './create-treasury-transaction-dialog.component.html'
})
export class CreateTreasuryTransactionDialogComponent {
  private readonly data = inject<CreateTreasuryTransactionDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<CreateTreasuryTransactionDialogComponent, string | null>>(
    MatDialogRef
  );
  private readonly formBuilder = inject(FormBuilder);
  private readonly treasuryApi = inject(TreasuryApi);

  protected readonly accounts = this.data.accounts;
  protected readonly selectedTreasuryAccountId = signal(this.data.selectedAccountId);
  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    treasuryAccountId: [this.data.selectedAccountId, [Validators.required]],
    year: [Number(this.data.year), [Validators.required, Validators.min(2000), Validators.max(2100)]],
    entryDate: [new Date().toISOString().slice(0, 10), [Validators.required, Validators.pattern(/^\d{4}-\d{2}-\d{2}$/)]],
    journalCode: ['BANK', [Validators.required]],
    direction: ['INFLOW' as 'INFLOW' | 'OUTFLOW', [Validators.required]],
    amount: [0, [Validators.required, Validators.min(1)]],
    counterpartyAccountId: ['', [Validators.required, Validators.pattern(/^\d{8}$/)]],
    label: ['', [Validators.required, Validators.minLength(3)]],
    voucherNumber: ['']
  });

  protected readonly selectedTreasuryAccount = computed(
    () =>
      this.accounts.find(
        (account) => account.treasuryAccountId === this.selectedTreasuryAccountId()
      ) ?? null
  );

  protected readonly excludedCounterpartyAccountIds = computed(() => {
    const accountId = this.selectedTreasuryAccount()?.accountId;
    return accountId ? [accountId] : [];
  });

  protected accountLabel(account: TreasuryAccountDto): string {
    return `${account.accountId} - ${account.label}`;
  }

  protected handleTreasuryAccountChange(treasuryAccountId: string): void {
    this.selectedTreasuryAccountId.set(treasuryAccountId);
    this.validateCounterpartyAgainstTreasuryAccount();
  }

  protected handleCounterpartySelected(_account: AccountDto | null): void {
    this.validateCounterpartyAgainstTreasuryAccount();
  }

  protected counterpartyErrorKey(): string {
    if (this.form.controls.counterpartyAccountId.hasError('treasuryAccount')) {
      return 'TREASURY.TRANSACTIONS.VALIDATION.COUNTERPARTY_SELF';
    }

    return 'TREASURY.TRANSACTIONS.VALIDATION.COUNTERPARTY_REQUIRED';
  }

  protected async submit(): Promise<void> {
    this.validateCounterpartyAgainstTreasuryAccount();

    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    this.submitting.set(true);
    this.errorKey.set(null);

    try {
      const entryId = await this.treasuryApi.postTransaction({
        treasuryAccountId: raw.treasuryAccountId,
        year: Number(raw.year),
        entryDate: raw.entryDate,
        journalCode: raw.journalCode,
        direction: raw.direction,
        amount: Number(raw.amount),
        counterpartyAccountId: raw.counterpartyAccountId,
        label: raw.label.trim(),
        voucherNumber: raw.voucherNumber.trim() || undefined
      });
      this.dialogRef.close(entryId);
    } catch {
      this.errorKey.set('TREASURY.ERRORS.POST_TRANSACTION_FAILED');
    } finally {
      this.submitting.set(false);
    }
  }

  protected cancel(): void {
    if (!this.submitting()) {
      this.dialogRef.close(null);
    }
  }

  private validateCounterpartyAgainstTreasuryAccount(): void {
    const counterpartyControl = this.form.controls.counterpartyAccountId;
    const treasuryAccountId = this.selectedTreasuryAccount()?.accountId;
    const counterpartyAccountId = counterpartyControl.value;
    const errors = { ...(counterpartyControl.errors ?? {}) };

    if (treasuryAccountId && counterpartyAccountId === treasuryAccountId) {
      counterpartyControl.setErrors({ ...errors, treasuryAccount: true });
      return;
    }

    if (!errors['treasuryAccount']) {
      return;
    }

    delete errors['treasuryAccount'];
    counterpartyControl.setErrors(Object.keys(errors).length ? errors : null);
  }
}
