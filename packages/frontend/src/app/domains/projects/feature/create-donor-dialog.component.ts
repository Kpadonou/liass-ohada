import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { type CreateDonorRequest, type DonorDto } from '@liass-ohada/shared/projects';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { ProjectsApi } from '../data-access/projects.api';

@Component({
  selector: 'liass-create-donor-dialog',
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
  templateUrl: './create-donor-dialog.component.html'
})
export class CreateDonorDialogComponent {
  private readonly dialogRef = inject<MatDialogRef<CreateDonorDialogComponent, DonorDto | null>>(
    MatDialogRef
  );
  private readonly formBuilder = inject(FormBuilder);
  private readonly projectsApi = inject(ProjectsApi);

  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    code: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(10)]],
    name: ['', [Validators.required, Validators.minLength(3)]],
    type: ['OTHER' as CreateDonorRequest['type'], [Validators.required]],
    currency: ['XOF', [Validators.required, Validators.minLength(3), Validators.maxLength(3)]],
    email: [''],
    phone: [''],
    address: [''],
    associatedAccountId: ['', [Validators.pattern(/^\d{8}$/)]]
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    const payload: CreateDonorRequest = {
      code: raw.code.trim().toUpperCase(),
      name: raw.name.trim(),
      type: raw.type,
      currency: raw.currency.trim().toUpperCase(),
      email: raw.email.trim() || undefined,
      phone: raw.phone.trim() || undefined,
      address: raw.address.trim() || undefined,
      associatedAccountId: raw.associatedAccountId.trim() || undefined
    };

    this.submitting.set(true);
    this.errorKey.set(null);

    try {
      const donor = await this.projectsApi.createDonor(payload);
      this.dialogRef.close(donor);
    } catch {
      this.errorKey.set('PROJECTS.ERRORS.CREATE_DONOR_FAILED');
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
