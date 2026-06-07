import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { type CreateJournalRequest, type JournalDto } from '@liass-ohada/shared/accounting';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { AccountingApi } from '../../data-access/accounting.api';

@Component({
  selector: 'liass-create-journal-dialog',
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
  templateUrl: './create-journal-dialog.component.html'
})
export class CreateJournalDialogComponent {
  private readonly accountingApi = inject(AccountingApi);
  private readonly dialogRef = inject<MatDialogRef<CreateJournalDialogComponent, JournalDto | null>>(
    MatDialogRef
  );
  private readonly formBuilder = inject(FormBuilder);

  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly currentYear = new Date().getFullYear();

  protected readonly form = this.formBuilder.nonNullable.group({
    year: [this.currentYear, [Validators.required, Validators.min(2000), Validators.max(2100)]],
    journalCode: ['', [Validators.required, Validators.maxLength(10)]],
    journalName: ['', [Validators.required]],
    type: ['MISC' as CreateJournalRequest['type'], [Validators.required]]
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    try {
      const journal = await this.accountingApi.createJournal({
        ...this.form.getRawValue(),
        year: Number(this.form.controls.year.value)
      });
      this.dialogRef.close(journal);
    } catch {
      this.errorKey.set('ACCOUNTING.ERRORS.CREATE_JOURNAL_FAILED');
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
