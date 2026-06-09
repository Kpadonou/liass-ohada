import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { type DonorDto, type FundingSourceDto } from '@liass-ohada/shared/projects';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { ProjectsApi } from '../data-access/projects.api';

interface CreateFundingSourceDialogData {
  donors: DonorDto[];
  projectId: string;
}

@Component({
  selector: 'liass-create-funding-source-dialog',
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
  templateUrl: './create-funding-source-dialog.component.html'
})
export class CreateFundingSourceDialogComponent {
  private readonly data = inject<CreateFundingSourceDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<CreateFundingSourceDialogComponent, FundingSourceDto | null>>(
    MatDialogRef
  );
  private readonly formBuilder = inject(FormBuilder);
  private readonly projectsApi = inject(ProjectsApi);

  protected readonly donors = this.data.donors;
  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    donorId: ['', [Validators.required]],
    label: ['', [Validators.required]],
    amount: [0, [Validators.required, Validators.min(0)]],
    currency: ['XOF', [Validators.required, Validators.minLength(3), Validators.maxLength(3)]]
  });

  protected donorLabel(donor: DonorDto): string {
    return `${donor.code} - ${donor.name}`;
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
      const fundingSource = await this.projectsApi.createFundingSource(this.data.projectId, {
        donorId: raw.donorId,
        label: raw.label.trim(),
        amount: Number(raw.amount),
        currency: raw.currency.trim().toUpperCase()
      });
      this.dialogRef.close(fundingSource);
    } catch {
      this.errorKey.set('PROJECTS.ERRORS.CREATE_FUNDING_SOURCE_FAILED');
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
