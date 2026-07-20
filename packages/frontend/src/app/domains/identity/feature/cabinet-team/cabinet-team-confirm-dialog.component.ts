import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';

export interface CabinetTeamConfirmDialogData {
  titleKey: string;
  descriptionKey: string;
  confirmKey: string;
  memberName?: string;
  danger?: boolean;
}

@Component({
  selector: 'liass-cabinet-team-confirm-dialog',
  imports: [LiassButtonComponent, MatDialogModule, MatIconModule, TranslocoModule],
  template: `
    <header class="px-6 pt-6">
      <div class="flex items-start gap-3">
        <span class="inline-flex size-10 items-center justify-center rounded-app-control"
          [class]="data.danger ? 'bg-danger-50 text-danger-600 dark:bg-rose-950/35 dark:text-rose-300' : 'bg-brand-50 text-brand-700 dark:bg-brand-950/35 dark:text-brand-300'">
          <mat-icon>{{ data.danger ? 'warning' : 'help' }}</mat-icon>
        </span>
        <div>
          <h2 mat-dialog-title class="m-0 p-0 text-xl font-semibold text-slate-950 dark:text-white">
            {{ data.titleKey | transloco }}
          </h2>
          @if (data.memberName) {
            <p class="mt-1 text-sm font-medium text-slate-700 dark:text-slate-300">{{ data.memberName }}</p>
          }
        </div>
      </div>
    </header>
    <mat-dialog-content class="px-6 pb-0 pt-5">
      <p class="text-sm leading-6 text-slate-600 dark:text-slate-400">
        {{ data.descriptionKey | transloco }}
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="gap-3 px-6 pb-6 pt-5">
      <liass-button tone="neutral" variant="outline" (pressed)="close(false)">
        {{ 'COMMON.ACTIONS.CANCEL' | transloco }}
      </liass-button>
      <liass-button [tone]="data.danger ? 'danger' : 'brand'" variant="solid" (pressed)="close(true)">
        {{ data.confirmKey | transloco }}
      </liass-button>
    </mat-dialog-actions>
  `
})
export class CabinetTeamConfirmDialogComponent {
  protected readonly data = inject<CabinetTeamConfirmDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<CabinetTeamConfirmDialogComponent, boolean>>(
    MatDialogRef
  );

  protected close(result: boolean): void {
    this.dialogRef.close(result);
  }
}
