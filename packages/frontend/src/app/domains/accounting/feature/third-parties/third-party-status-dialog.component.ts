import { Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { type ThirdPartyDto } from '@liass-ohada/shared/accounting';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { AccountingApi } from '../../data-access/accounting.api';

export interface ThirdPartyStatusDialogData {
  action: 'activate' | 'deactivate';
  thirdParty: ThirdPartyDto;
}

@Component({
  selector: 'liass-third-party-status-dialog',
  imports: [LiassButtonComponent, MatDialogModule, MatIconModule, TranslocoModule],
  templateUrl: './third-party-status-dialog.component.html'
})
export class ThirdPartyStatusDialogComponent {
  private readonly accountingApi = inject(AccountingApi);
  private readonly data = inject<ThirdPartyStatusDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<ThirdPartyStatusDialogComponent, ThirdPartyDto | null>>(
    MatDialogRef
  );
  private readonly notification = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);

  protected readonly action = this.data.action;
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly thirdParty = this.data.thirdParty;
  protected readonly isDeactivate = this.action === 'deactivate';
  protected readonly titleKey = computed(() =>
    this.isDeactivate
      ? 'ACCOUNTING.THIRD_PARTIES.STATUS_DIALOG.DEACTIVATE_TITLE'
      : 'ACCOUNTING.THIRD_PARTIES.STATUS_DIALOG.ACTIVATE_TITLE'
  );
  protected readonly descriptionKey = computed(() =>
    this.isDeactivate
      ? 'ACCOUNTING.THIRD_PARTIES.STATUS_DIALOG.DEACTIVATE_DESCRIPTION'
      : 'ACCOUNTING.THIRD_PARTIES.STATUS_DIALOG.ACTIVATE_DESCRIPTION'
  );

  protected async confirm(): Promise<void> {
    if (this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    try {
      const result = this.isDeactivate
        ? await this.accountingApi.deactivateThirdParty(this.thirdParty.thirdPartyId, this.thirdParty.type)
        : await this.accountingApi.activateThirdParty(this.thirdParty.thirdPartyId, this.thirdParty.type);
      const fallbackKey = this.isDeactivate
        ? 'ACCOUNTING.THIRD_PARTIES.NOTIFICATIONS.DEACTIVATED'
        : 'ACCOUNTING.THIRD_PARTIES.NOTIFICATIONS.ACTIVATED';

      this.notification.success(result.message ?? this.transloco.translate(fallbackKey));
      this.dialogRef.close(result.data);
    } catch (error) {
      const fallbackKey = this.isDeactivate
        ? 'ACCOUNTING.THIRD_PARTIES.ERRORS.DEACTIVATE_FAILED'
        : 'ACCOUNTING.THIRD_PARTIES.ERRORS.ACTIVATE_FAILED';
      const message =
        safeMessageFromError(error) ||
        String(this.transloco.translate(fallbackKey) || fallbackKey);

      this.errorMessage.set(message);
      this.notification.error(message);
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
