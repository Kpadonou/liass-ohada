import { Injectable, inject } from '@angular/core';
import { ComponentType } from '@angular/cdk/portal';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';

/** Explicit review actions can outlive the closed editor and its scoped providers. */
@Injectable({ providedIn: 'root' })
export class EditorRecoveryService {
  private readonly dialog = inject(MatDialog);
  open<T, D>(component: ComponentType<T>, config: MatDialogConfig<D>) {
    return this.dialog.open(component, config);
  }
}
