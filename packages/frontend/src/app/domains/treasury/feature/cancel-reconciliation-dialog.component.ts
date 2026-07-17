import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../shared/ui/button/button.component';

export interface CancelReconciliationDialogData {
  matchId: string;
}

@Component({
  selector: 'liass-cancel-reconciliation-dialog',
  imports: [
    LiassButtonComponent,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    TranslocoModule
  ],
  templateUrl: './cancel-reconciliation-dialog.component.html'
})
export class CancelReconciliationDialogComponent {
  protected readonly data = inject<CancelReconciliationDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<CancelReconciliationDialogComponent, string | undefined>>(MatDialogRef);

  protected readonly reason = signal('');

  protected confirm(): void {
    this.dialogRef.close(this.reason().trim());
  }

  protected close(): void {
    this.dialogRef.close(undefined);
  }
}
