import { tableQrPrint } from '../utils/table-qr-print';
import { Component, effect, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
  MatDialog,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { RestaurantContext } from '../data-access/restaurants-model';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { NotificationService } from '../../../core/notifications/notification.service';
import { HttpErrorResponse } from '@angular/common/http';
import { toDataURL } from 'qrcode';
import { restaurantError } from '../utils/restaurant-errors';
@Component({
  selector: 'liass-restaurant-qr-dialog',
  imports: [MatDialogModule, MatButtonModule, TranslocoModule],
  template: ` <h2 mat-dialog-title>
      {{ 'RESTAURANTS.UI.QR_TITLE' | transloco }} · {{ data.name }}
    </h2>
    <mat-dialog-content class="space-y-4">
      <p>{{ 'RESTAURANTS.QR.HELP' | transloco }}</p>
      @if (loading()) {
        <p role="status">{{ 'RESTAURANTS.UI.LOADING' | transloco }}</p>
      }
      @if (error()) {
        <p role="alert" class="text-danger-600">{{ error() }}</p>
      }
      @if (status()) {
        <p role="status">{{ 'RESTAURANTS.QR.' + status() | transloco }}</p>
        @if (image()) {
          <figure class="mx-auto max-w-64 space-y-2 text-center">
            <img
              [src]="image()"
              width="256"
              height="256"
              class="h-auto w-full bg-white"
              [alt]="'RESTAURANTS.QR.ALT' | transloco: { table: data.name }"
            />
            <figcaption class="break-words font-semibold">{{ data.name }}</figcaption>
          </figure>
          <div class="flex flex-wrap gap-2">
            <button mat-stroked-button type="button" (click)="copy()">
              {{ 'RESTAURANTS.QR.COPY_LINK' | transloco }}
            </button>
            <button mat-stroked-button type="button" (click)="download()">
              {{ 'RESTAURANTS.QR.DOWNLOAD' | transloco }}
            </button>
            <button mat-stroked-button type="button" (click)="print()">
              {{ 'RESTAURANTS.QR.PRINT' | transloco }}
            </button>
          </div>
        }
        <div class="flex flex-wrap gap-2 border-t border-app-border pt-4">
          <button
            mat-stroked-button
            type="button"
            [disabled]="busy() || pendingOther('rotate')"
            (click)="confirm('rotate')"
          >
            {{ 'RESTAURANTS.QR.ROTATE' | transloco }}
          </button>
          @if (status() === 'ACTIVE') {
            <button
              mat-button
              class="liass-action-danger"
              type="button"
              [disabled]="busy() || pendingOther('revoke')"
              (click)="confirm('revoke')"
            >
              {{ 'RESTAURANTS.QR.REVOKE' | transloco }}
            </button>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end"
      ><button mat-button mat-dialog-close [disabled]="busy()">
        {{ 'RESTAURANTS.UI.CLOSE' | transloco }}
      </button></mat-dialog-actions
    >`,
})
export class RestaurantQrDialogComponent {
  readonly data = inject<{
    org: string;
    context: RestaurantContext;
    id: string;
    name: string;
    restaurantName?: string;
    outletName?: string;
  }>(MAT_DIALOG_DATA);
  private readonly api = inject(RestaurantsApi);
  private readonly queries = inject(RestaurantsQueries);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly access = inject(ProductAccessState);
  private readonly ref = inject(MatDialogRef<RestaurantQrDialogComponent>);
  private readonly t = inject(TranslocoService);
  private readonly notification = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  readonly status = signal<'ACTIVE' | 'REVOKED' | null>(null);
  readonly image = signal<string | null>(null);
  readonly busy = signal(false);
  pendingOther(operation: 'rotate' | 'revoke') {
    return !!this.pending && this.pending.operation !== operation;
  }
  private version = 0;
  private pending?: {
    operation: 'rotate' | 'revoke';
    clientRequestId: string;
    expectedVersion: number;
  };
  readonly token = signal<string | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  constructor() {
    effect(() => {
      if (
        this.queries.scope() !== this.data.org ||
        !this.caps.canManageSetup() ||
        this.access.availability('RESTAURANTS') !== 'AVAILABLE'
      ) {
        this.token.set(null);
        this.image.set(null);
        this.ref.close();
      }
    });
    void this.load();
  }
  private async load() {
    try {
      if (!this.caps.canManageSetup() || this.access.availability('RESTAURANTS') !== 'AVAILABLE')
        return;
      const response = await this.api.managedQr(this.data.org, this.data.context, this.data.id);
      if (
        this.queries.scope() === this.data.org &&
        this.caps.canManageSetup() &&
        this.access.availability('RESTAURANTS') === 'AVAILABLE'
      ) {
        this.status.set(response.status);
        this.version = response.version;
        this.token.set(response.token ?? null);
        const image = response.token
          ? await toDataURL(this.url(response.token), {
              width: 1024,
              margin: 4,
              errorCorrectionLevel: 'M',
            })
          : null;
        if (this.current()) this.image.set(image);
      }
    } catch (error) {
      this.error.set(restaurantError(error, (key) => this.t.translate(key)));
    } finally {
      this.loading.set(false);
    }
  }
  private current() {
    return (
      this.queries.scope() === this.data.org &&
      this.caps.canManageSetup() &&
      this.access.availability('RESTAURANTS') === 'AVAILABLE'
    );
  }
  private url(token: string) {
    return `${window.location.origin}/g/${token}`;
  }
  private artifact() {
    return tableQrPrint(
      this.image()!,
      [this.data.restaurantName ?? '', this.data.outletName ?? '', this.data.name],
      this.t.translate('RESTAURANTS.QR.INSTRUCTION'),
    );
  }
  download() {
    if (!this.current() || !this.image()) return;
    const url = URL.createObjectURL(new Blob([this.artifact()], { type: 'image/svg+xml' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'liass-resto-qr.svg';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  print() {
    if (!this.current() || !this.image()) return;
    const url = URL.createObjectURL(new Blob([this.artifact()], { type: 'image/svg+xml' }));
    const popup = window.open(url, '_blank');
    if (popup) popup.addEventListener('load', () => popup.print(), { once: true });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  confirm(operation: 'rotate' | 'revoke') {
    if (!this.current() || this.busy()) return;
    const ref = this.dialog.open(QrConfirmationDialog, {
      disableClose: true,
      data: { operation },
      maxWidth: 'calc(100vw - 24px)',
      width: '420px',
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (confirmed && this.current()) void this.change(operation);
    });
  }
  async change(operation: 'rotate' | 'revoke') {
    if (!this.current() || this.busy()) return;
    // Keep the same command after a lost response. Never silently rebase an intent.
    if (this.pending && this.pending.operation !== operation) return;
    this.pending ??= {
      operation,
      clientRequestId: crypto.randomUUID(),
      expectedVersion: this.version,
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      const { clientRequestId, expectedVersion } = this.pending;
      await this.api.changeQr(this.data.org, this.data.context, this.data.id, operation, {
        clientRequestId,
        expectedVersion,
      });
      if (!this.current()) return;
      this.pending = undefined;
      await this.load();
      if (this.current()) this.notification.success(this.t.translate('RESTAURANTS.QR.SAVED'));
    } catch (error) {
      if (this.current()) {
        this.image.set(null);
        this.token.set(null);
        if (
          error instanceof HttpErrorResponse &&
          error.status >= 400 &&
          error.status < 500 &&
          ![408, 429].includes(error.status)
        )
          this.pending = undefined;
        this.error.set(restaurantError(error, (key) => this.t.translate(key)));
      }
    } finally {
      this.busy.set(false);
    }
  }
  async copy() {
    try {
      if (!this.token() || !this.caps.canManageSetup() || this.queries.scope() !== this.data.org)
        return;
      await navigator.clipboard.writeText(this.url(this.token()!));
      this.notification.success(this.t.translate('RESTAURANTS.UI.COPIED'));
    } catch {
      this.error.set(this.t.translate('RESTAURANTS.UI.COPY_FAILED'));
    }
  }
}

@Component({
  selector: 'liass-qr-confirmation',
  imports: [MatDialogModule, MatButtonModule, TranslocoModule],
  template: `<h2 mat-dialog-title>
      {{ 'RESTAURANTS.QR.' + data.operation.toUpperCase() | transloco }}
    </h2>
    <mat-dialog-content>{{
      'RESTAURANTS.QR.CONFIRM_' + data.operation.toUpperCase() | transloco
    }}</mat-dialog-content>
    <mat-dialog-actions align="end"
      ><button mat-button [mat-dialog-close]="false">
        {{ 'RESTAURANTS.UI.CANCEL' | transloco }}</button
      ><button mat-flat-button [mat-dialog-close]="true">
        {{ 'RESTAURANTS.QR.CONFIRM' | transloco }}
      </button></mat-dialog-actions
    >`,
})
export class QrConfirmationDialog {
  readonly data = inject<{ operation: 'rotate' | 'revoke' }>(MAT_DIALOG_DATA);
}
