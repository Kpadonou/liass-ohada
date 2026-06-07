import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { type AccountDto, type CreateAccountRequest } from '@liass-ohada/shared/accounting';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { AccountingApi } from '../../data-access/accounting.api';

@Component({
  selector: 'liass-create-account-dialog',
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
  templateUrl: './create-account-dialog.component.html'
})
export class CreateAccountDialogComponent {
  private readonly accountingApi = inject(AccountingApi);
  private readonly dialogRef = inject<MatDialogRef<CreateAccountDialogComponent, AccountDto | null>>(
    MatDialogRef
  );
  private readonly formBuilder = inject(FormBuilder);

  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly classCodes = [1, 2, 3, 4, 5, 6, 7, 8];

  protected readonly form = this.formBuilder.nonNullable.group({
    accountId: ['', [Validators.required, Validators.pattern(/^\d{1,8}$/)]],
    accountName: ['', [Validators.required]],
    accountNature: ['BALANCE' as CreateAccountRequest['accountNature'], [Validators.required]],
    accountUsage: ['BOTH' as CreateAccountRequest['accountUsage'], [Validators.required]],
    isThirdPartyAccount: [false],
    classCode: [1, [Validators.required, Validators.min(1), Validators.max(8)]],
    financialStatementCode: ['BS', [Validators.required]],
    allowReconciliation: [false]
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    try {
      const raw = this.form.getRawValue();
      const account = await this.accountingApi.createAccount({
        ...raw,
        classCode: Number(raw.classCode)
      });

      this.dialogRef.close(account);
    } catch {
      this.errorKey.set('ACCOUNTING.ERRORS.CREATE_ACCOUNT_FAILED');
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
