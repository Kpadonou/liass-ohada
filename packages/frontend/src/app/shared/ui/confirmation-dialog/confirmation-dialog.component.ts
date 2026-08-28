import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../button/button.component';

export interface LiassConfirmationDialogData {
  titleKey: string;
  descriptionKey: string;
  confirmKey: string;
  cancelKey: string;
  tone?: 'brand' | 'warning' | 'danger';
  descriptionParams?: Record<string, unknown>;
}

@Component({
  selector: 'liass-confirmation-dialog',
  imports: [LiassButtonComponent, MatDialogModule, MatIconModule, TranslocoModule],
  template: `
    <header class="px-5 pt-5 sm:px-6 sm:pt-6">
      <div class="flex items-start gap-3">
        <span
          class="inline-flex size-10 shrink-0 items-center justify-center rounded-app-control"
          [class]="iconClasses"
          aria-hidden="true"
        >
          <mat-icon>{{ data.tone === 'danger' ? 'warning' : 'help_outline' }}</mat-icon>
        </span>
        <h2 mat-dialog-title class="m-0 min-w-0 p-0 text-xl font-semibold text-app-text">
          {{ data.titleKey | transloco }}
        </h2>
      </div>
    </header>
    <mat-dialog-content class="px-5 pb-0 pt-4 sm:px-6">
      <p class="text-sm leading-6 text-app-text-secondary">
        {{ data.descriptionKey | transloco: data.descriptionParams }}
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="flex-wrap gap-2 px-5 pb-5 pt-5 sm:px-6 sm:pb-6">
      <liass-button tone="neutral" variant="outline" (pressed)="close(false)">
        {{ data.cancelKey | transloco }}
      </liass-button>
      <liass-button [tone]="data.tone ?? 'brand'" variant="solid" (pressed)="close(true)">
        {{ data.confirmKey | transloco }}
      </liass-button>
    </mat-dialog-actions>
  `
})
export class LiassConfirmationDialogComponent {
  protected readonly data = inject<LiassConfirmationDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<LiassConfirmationDialogComponent, boolean>>(
    MatDialogRef
  );

  protected get iconClasses(): string {
    return this.data.tone === 'danger'
      ? 'bg-danger-50 text-danger-600 dark:bg-rose-950/35 dark:text-rose-300'
      : 'bg-warning-50 text-warning-600 dark:bg-amber-950/35 dark:text-amber-300';
  }

  protected close(result: boolean): void {
    this.dialogRef.close(result);
  }
}
