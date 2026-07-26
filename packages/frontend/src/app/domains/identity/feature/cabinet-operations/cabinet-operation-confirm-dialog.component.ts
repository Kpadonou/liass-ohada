import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';

export interface CabinetOperationConfirmDialogData {
  confirmKey: string;
  danger?: boolean;
  descriptionKey: string;
  name: string;
  titleKey: string;
}

@Component({
  selector: 'liass-cabinet-operation-confirm-dialog',
  imports: [LiassButtonComponent, MatDialogModule, MatIconModule, TranslocoModule],
  template: `
    <div class="px-6 pt-6">
      <div class="flex items-start gap-3">
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-full"
          [class]="data.danger ? 'bg-danger-50 text-danger-600 dark:bg-rose-950/35 dark:text-rose-300' : 'bg-brand-50 text-brand-700 dark:bg-brand-950/35 dark:text-brand-300'"
        >
          <mat-icon aria-hidden="true">{{ data.danger ? 'warning' : 'task_alt' }}</mat-icon>
        </div>
        <div class="min-w-0">
          <h2 class="text-lg font-semibold text-slate-950 dark:text-white" mat-dialog-title>
            {{ data.titleKey | transloco }}
          </h2>
          <p class="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
            {{ data.descriptionKey | transloco: { name: data.name } }}
          </p>
        </div>
      </div>
    </div>
    <div class="flex justify-end gap-2 px-6 py-5" mat-dialog-actions>
      <liass-button variant="ghost" tone="neutral" (pressed)="close(false)">
        {{ 'IDENTITY.CABINET_OPERATIONS.ACTIONS.CANCEL' | transloco }}
      </liass-button>
      <liass-button [tone]="data.danger ? 'danger' : 'brand'" variant="solid" (pressed)="close(true)">
        {{ data.confirmKey | transloco }}
      </liass-button>
    </div>
  `
})
export class CabinetOperationConfirmDialogComponent {
  protected readonly data = inject<CabinetOperationConfirmDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<CabinetOperationConfirmDialogComponent, boolean>>(
    MatDialogRef
  );

  protected close(confirmed: boolean): void {
    this.dialogRef.close(confirmed);
  }
}
