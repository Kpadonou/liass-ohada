import { Injectable, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

import {
  LiassConfirmationDialogComponent,
  type LiassConfirmationDialogData
} from '../../shared/ui/confirmation-dialog/confirmation-dialog.component';

@Injectable({ providedIn: 'root' })
export class PendingChangesService {
  private readonly pending = signal(false);

  constructor(private readonly dialog: MatDialog) {}

  hasPendingChanges(): boolean {
    return this.pending();
  }

  setPendingChanges(pending: boolean): void {
    this.pending.set(pending);
  }

  async confirmDeparture(): Promise<boolean> {
    if (!this.pending()) {
      return true;
    }

    const data: LiassConfirmationDialogData = {
      titleKey: 'IDENTITY.CABINET_SETTINGS.UNSAVED.TITLE',
      descriptionKey: 'IDENTITY.CABINET_SETTINGS.UNSAVED.DESCRIPTION',
      confirmKey: 'IDENTITY.CABINET_SETTINGS.UNSAVED.LEAVE',
      cancelKey: 'IDENTITY.CABINET_SETTINGS.UNSAVED.STAY',
      tone: 'danger'
    };
    const confirmed = await firstValueFrom(
      this.dialog.open(LiassConfirmationDialogComponent, {
        autoFocus: 'dialog',
        data,
        disableClose: true,
        maxWidth: 'calc(100vw - 2rem)',
        restoreFocus: true,
        width: '30rem'
      }).afterClosed()
    );

    return confirmed === true;
  }
}
