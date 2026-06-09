import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { type CreateProjectRequest, type DonorDto, type ProjectDto } from '@liass-ohada/shared/projects';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { ProjectQueries } from '../data-access/project-queries';
import { ProjectsApi } from '../data-access/projects.api';

@Component({
  selector: 'liass-create-project-dialog',
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
  templateUrl: './create-project-dialog.component.html'
})
export class CreateProjectDialogComponent {
  private readonly dialogRef = inject<MatDialogRef<CreateProjectDialogComponent, ProjectDto | null>>(
    MatDialogRef
  );
  private readonly formBuilder = inject(FormBuilder);
  private readonly projectQueries = inject(ProjectQueries);
  private readonly projectsApi = inject(ProjectsApi);

  protected readonly donorsQuery = injectQuery(() => this.projectQueries.listDonors());
  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly currentYear = String(new Date().getFullYear());

  protected readonly form = this.formBuilder.nonNullable.group({
    projectCode: ['', [Validators.required, Validators.maxLength(30)]],
    name: ['', [Validators.required]],
    description: [''],
    donorId: ['', [Validators.required]],
    managerId: ['', [Validators.required]],
    contractRef: [''],
    startDate: ['', [Validators.required, Validators.pattern(/^\d{4}-\d{2}-\d{2}$/)]],
    endDate: ['', [Validators.pattern(/^\d{4}-\d{2}-\d{2}$/)]],
    totalBudget: [0, [Validators.required, Validators.min(0)]],
    annualBudget: [0, [Validators.required, Validators.min(0)]],
    currency: ['XOF', [Validators.required, Validators.minLength(3), Validators.maxLength(3)]],
    status: ['ACTIVE' as CreateProjectRequest['status'], [Validators.required]]
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
    const payload: CreateProjectRequest = {
      projectCode: raw.projectCode.trim().toUpperCase(),
      name: raw.name.trim(),
      description: raw.description.trim() || undefined,
      donorId: raw.donorId,
      managerId: raw.managerId.trim(),
      contractRef: raw.contractRef.trim() || undefined,
      startDate: raw.startDate,
      endDate: raw.endDate || undefined,
      totalBudget: Number(raw.totalBudget),
      annualBudgets: {
        [this.currentYear]: Number(raw.annualBudget)
      },
      currency: raw.currency.trim().toUpperCase(),
      status: raw.status
    };

    this.submitting.set(true);
    this.errorKey.set(null);

    try {
      const project = await this.projectsApi.createProject(payload);
      this.dialogRef.close(project);
    } catch {
      this.errorKey.set('PROJECTS.ERRORS.CREATE_PROJECT_FAILED');
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
