import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { type TreasuryAccountDto } from '@liass-ohada/shared/treasury';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { TreasuryApi } from '../data-access/treasury.api';

interface CreateTreasuryTransactionDialogData {
  accounts: TreasuryAccountDto[];
  selectedAccountId: string;
  year: string;
}

@Component({
  selector: 'liass-create-treasury-transaction-dialog',
  imports: [
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

  protected accountLabel(account: TreasuryAccountDto): string {
    return `${account.accountId} - ${account.label}`;
  }

  protected async submit(): Promise<void> {
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
}
