import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { type BudgetLineDto, type CreateBudgetLineRequest } from '@liass-ohada/shared/projects';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { ProjectsApi } from '../data-access/projects.api';

interface CreateBudgetLineDialogData {
  projectId: string;
  year: string;
}

@Component({
  selector: 'liass-create-budget-line-dialog',
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
  templateUrl: './create-budget-line-dialog.component.html'
})
export class CreateBudgetLineDialogComponent {
  private readonly data = inject<CreateBudgetLineDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<CreateBudgetLineDialogComponent, BudgetLineDto | null>>(
    MatDialogRef
  );
  private readonly formBuilder = inject(FormBuilder);
  private readonly projectsApi = inject(ProjectsApi);

  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    fiscalYear: [this.data.year, [Validators.required, Validators.pattern(/^\d{4}$/)]],
    code: ['', [Validators.required, Validators.maxLength(40)]],
    label: ['', [Validators.required]],
    amount: [0, [Validators.required, Validators.min(0)]],
    category: ['ACTIVITY' as CreateBudgetLineRequest['category'], [Validators.required]]
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    this.submitting.set(true);
    this.errorKey.set(null);

    try {
      const budgetLine = await this.projectsApi.createBudgetLine(this.data.projectId, {
        fiscalYear: raw.fiscalYear,
        code: raw.code.trim().toUpperCase(),
        label: raw.label.trim(),
        amount: Number(raw.amount),
        category: raw.category
      });
      this.dialogRef.close(budgetLine);
    } catch {
      this.errorKey.set('PROJECTS.ERRORS.CREATE_BUDGET_LINE_FAILED');
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
