import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { NotificationService } from '../../../core/notifications/notification.service';
import { staffError } from '../utils/staff-errors';
import type { StaffDialogData } from './staff-assignments-dialog.component';

@Component({
  selector: 'liass-staff-status-dialog',
  imports: [MatDialogModule, MatButtonModule, TranslocoModule, LiassButtonComponent],
  template: `
    <h2 mat-dialog-title>
      {{
        (nextStatus === 'INACTIVE'
          ? 'RESTAURANTS.TEAM.DEACTIVATE_TITLE'
          : 'RESTAURANTS.TEAM.REACTIVATE_TITLE'
        ) | transloco: { name: name }
      }}
    </h2>
    <mat-dialog-content class="space-y-4">
      <p class="text-sm text-app-text-secondary">
        {{
          (nextStatus === 'INACTIVE'
            ? 'RESTAURANTS.TEAM.DEACTIVATE_HELP'
            : 'RESTAURANTS.TEAM.REACTIVATE_HELP'
          ) | transloco
        }}
      </p>
      @if (!allowed()) {
        <p role="alert">{{ 'RESTAURANTS.TEAM.ACCESS_DENIED' | transloco }}</p>
      }
      @if (error()) {
        <p role="alert" class="text-sm text-danger-600">{{ error() }}</p>
        <button mat-button type="button" [disabled]="pending() || !allowed()" (click)="review()">
          {{ 'RESTAURANTS.TEAM.RELOAD_REVIEW' | transloco }}
        </button>
      }
      @if (pending()) {
        <p role="status">{{ 'RESTAURANTS.TEAM.SAVING' | transloco }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="flex-wrap gap-2">
      <button mat-button type="button" [disabled]="pending()" (click)="cancel()">
        {{ 'RESTAURANTS.UI.CANCEL' | transloco }}
      </button>
      <liass-button
        variant="solid"
        [tone]="nextStatus === 'INACTIVE' ? 'danger' : 'brand'"
        [disabled]="pending() || !allowed()"
        [loading]="pending()"
        (pressed)="confirm()"
      >
        {{
          (nextStatus === 'INACTIVE'
            ? 'RESTAURANTS.TEAM.DEACTIVATE'
            : 'RESTAURANTS.TEAM.REACTIVATE'
          ) | transloco
        }}
      </liass-button>
    </mat-dialog-actions>
  `,
})
export class StaffStatusDialogComponent {
  readonly data = inject<StaffDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<StaffStatusDialogComponent>);
  private readonly api = inject(RestaurantsApi);
  private readonly queries = inject(RestaurantsQueries);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly access = inject(ProductAccessState);
  private readonly notification = inject(NotificationService);
  private readonly t = inject(TranslocoService);
  readonly name = this.data.staff.displayName ?? this.t.translate('RESTAURANTS.TEAM.UNNAMED');
  readonly nextStatus = this.data.staff.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
  readonly pending = signal(false);
  readonly error = signal<string | null>(null);
  readonly allowed = computed(
    () =>
      this.queries.scope() === this.data.org &&
      this.access.availability('RESTAURANTS') === 'AVAILABLE' &&
      this.caps.canManageStaff(),
  );
  private version = this.data.staff.version;
  private requestId = crypto.randomUUID();
  constructor() {
    effect(() => {
      this.ref.disableClose = this.pending();
      if (this.queries.scope() !== this.data.org) this.ref.close();
    });
  }
  cancel() {
    if (!this.pending()) this.ref.close();
  }
  async review() {
    if (this.pending() || !this.allowed()) return;
    this.pending.set(true);
    try {
      const latest = await this.api.staffMember(this.data.org, this.data.staff.userId);
      await this.queries.staffChanged(this.data.org, this.data.staff.userId);
      if (latest.status === this.nextStatus) {
        this.notification.info(this.t.translate('RESTAURANTS.TEAM.NO_CHANGES'));
        this.ref.close(true);
      } else {
        this.version = latest.version;
        this.requestId = crypto.randomUUID();
        this.error.set(null);
      }
    } catch (error) {
      this.error.set(staffError(error, (key) => this.t.translate(key)));
    } finally {
      this.pending.set(false);
    }
  }
  async confirm() {
    if (this.pending() || !this.allowed()) return;
    this.pending.set(true);
    this.error.set(null);
    try {
      const result = await this.api.updateStaff(this.data.org, this.data.staff.userId, {
        status: this.nextStatus,
        expectedVersion: this.version,
        clientRequestId: this.requestId,
      });
      await this.queries.staffChanged(this.data.org, this.data.staff.userId);
      if (this.allowed()) {
        this.notification.success(
          result.message ?? this.t.translate('RESTAURANTS.TEAM.STATUS_SAVED'),
        );
        this.ref.close(true);
      }
    } catch (error) {
      this.error.set(staffError(error, (key) => this.t.translate(key)));
      await this.queries.staffChanged(this.data.org, this.data.staff.userId);
    } finally {
      this.pending.set(false);
    }
  }
}
