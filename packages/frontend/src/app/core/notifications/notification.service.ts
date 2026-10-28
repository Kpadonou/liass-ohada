import { Injectable, NgZone, inject } from '@angular/core';
import { MatSnackBar, type MatSnackBarConfig } from '@angular/material/snack-bar';

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private readonly snackBar = inject(MatSnackBar);
  private readonly zone = inject(NgZone);

  default(message: string): void {
    this.show(message, {
      duration: 2000,
      panelClass: 'default-notification-overlay',
    });
  }

  info(message: string): void {
    this.show(message, {
      duration: 2000,
      panelClass: 'info-notification-overlay',
    });
  }

  success(message: string): void {
    this.show(message, {
      duration: 2000,
      panelClass: 'success-notification-overlay',
    });
  }

  warn(message: string): void {
    this.show(message, {
      duration: 2500,
      panelClass: 'warning-notification-overlay',
    });
  }

  error(message: string, action?: { label: string; run: () => void }): void {
    this.show(
      message,
      {
        duration: action ? 10000 : 3000,
        panelClass: 'error-notification-overlay',
        politeness: 'assertive',
      },
      action,
    );
  }

  private show(
    message: string,
    configuration: MatSnackBarConfig,
    action?: { label: string; run: () => void },
  ): void {
    this.zone.run(() => {
      const ref = this.snackBar.open(message, action?.label, configuration);
      if (action) ref.onAction().subscribe(() => action.run());
    });
  }
}
