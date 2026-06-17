import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { type CreateJournalRequest, type JournalDto } from '@liass-ohada/shared/accounting';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { AccountingApi } from '../../data-access/accounting.api';

export interface JournalDialogData {
  journal?: JournalDto;
  mode: 'create' | 'edit';
}

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
  private readonly data = inject<JournalDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<CreateJournalDialogComponent, JournalDto | null>>(
    MatDialogRef
  );
  private readonly formBuilder = inject(FormBuilder);
  private readonly notification = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);

  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly currentYear = new Date().getFullYear();
  protected readonly isEditMode = this.data.mode === 'edit';

  protected readonly form = this.formBuilder.nonNullable.group({
    year: [
      { disabled: this.isEditMode, value: this.data.journal?.year ?? this.currentYear },
      [Validators.required, Validators.min(2000), Validators.max(2100)]
    ],
    journalCode: [
      { disabled: this.isEditMode, value: this.data.journal?.journalCode ?? '' },
      [Validators.required, Validators.maxLength(10)]
    ],
    journalName: [this.data.journal?.journalName ?? '', [Validators.required, Validators.maxLength(160)]],
    type: [(this.data.journal?.type ?? 'MISC') as CreateJournalRequest['type'], [Validators.required]]
  });

  protected readonly titleKey = this.isEditMode
    ? 'ACCOUNTING.JOURNALS.EDIT.TITLE'
    : 'ACCOUNTING.JOURNALS.CREATE.TITLE';
  protected readonly eyebrowKey = this.isEditMode
    ? 'ACCOUNTING.JOURNALS.EDIT.EYEBROW'
    : 'ACCOUNTING.JOURNALS.CREATE.EYEBROW';
  protected readonly subtitleKey = this.isEditMode
    ? 'ACCOUNTING.JOURNALS.EDIT.SUBTITLE'
    : 'ACCOUNTING.JOURNALS.CREATE.SUBTITLE';

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
        year: Number(raw.year),
        journalCode: raw.journalCode.trim().toUpperCase(),
        journalName: raw.journalName.trim(),
        type: raw.type as CreateJournalRequest['type']
      };
      const result = this.isEditMode
        ? await this.accountingApi.updateJournal(this.data.journal!.journalCode, {
            year: payload.year,
            journalName: payload.journalName,
            type: payload.type
          })
        : await this.accountingApi.createJournal(payload);
      const fallbackKey = this.isEditMode
        ? 'ACCOUNTING.NOTIFICATIONS.JOURNAL_UPDATED'
        : 'ACCOUNTING.NOTIFICATIONS.JOURNAL_CREATED';

      this.notification.success(result.message ?? this.transloco.translate(fallbackKey));
      this.dialogRef.close(result.data);
    } catch (error) {
      const fallbackKey =
        this.isEditMode
          ? 'ACCOUNTING.ERRORS.UPDATE_JOURNAL_FAILED'
          : 'ACCOUNTING.ERRORS.CREATE_JOURNAL_FAILED';

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
