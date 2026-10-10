import { Component, effect, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { RestaurantContext } from '../data-access/restaurants-model';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { NotificationService } from '../../../core/notifications/notification.service';
import { restaurantError } from '../utils/restaurant-errors';
@Component({
  selector: 'liass-restaurant-qr-dialog',
  imports: [MatDialogModule, MatButtonModule, TranslocoModule],
  template: ` <h2 mat-dialog-title>
      {{ 'RESTAURANTS.UI.QR_TITLE' | transloco }} · {{ data.name }}
    </h2>
    <mat-dialog-content class="space-y-4"
      ><p>{{ 'RESTAURANTS.UI.QR_HELP' | transloco }}</p>
      @if (loading()) {
        <p role="status">{{ 'RESTAURANTS.UI.LOADING' | transloco }}</p>
      }
      @if (error()) {
        <p role="alert" class="text-danger-600">{{ error() }}</p>
      }
      @if (token()) {
        <p class="break-all select-all rounded-app-control bg-app-surface-muted p-3" tabindex="0">
          {{ token() }}
        </p>
        <button mat-button (click)="copy()">{{ 'RESTAURANTS.UI.COPY' | transloco }}</button>
      }</mat-dialog-content
    ><mat-dialog-actions align="end"
      ><button mat-button mat-dialog-close>
        {{ 'RESTAURANTS.UI.CLOSE' | transloco }}
      </button></mat-dialog-actions
    >`,
})
export class RestaurantQrDialogComponent {
  readonly data = inject<{ org: string; context: RestaurantContext; id: string; name: string }>(
    MAT_DIALOG_DATA,
  );
  private readonly api = inject(RestaurantsApi);
  private readonly queries = inject(RestaurantsQueries);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly access = inject(ProductAccessState);
  private readonly ref = inject(MatDialogRef<RestaurantQrDialogComponent>);
  private readonly t = inject(TranslocoService);
  private readonly notification = inject(NotificationService);
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
        this.ref.close();
      }
    });
    void this.load();
  }
  private async load() {
    try {
      if (!this.caps.canManageSetup() || this.access.availability('RESTAURANTS') !== 'AVAILABLE')
        return;
      const response = await this.api.qr(this.data.org, this.data.context, this.data.id);
      if (
        this.queries.scope() === this.data.org &&
        this.caps.canManageSetup() &&
        this.access.availability('RESTAURANTS') === 'AVAILABLE'
      )
        this.token.set(response.token);
    } catch (error) {
      this.error.set(restaurantError(error, (key) => this.t.translate(key)));
    } finally {
      this.loading.set(false);
    }
  }
  async copy() {
    try {
      if (!this.token() || !this.caps.canManageSetup() || this.queries.scope() !== this.data.org)
        return;
      await navigator.clipboard.writeText(this.token()!);
      this.notification.success(this.t.translate('RESTAURANTS.UI.COPIED'));
    } catch {
      this.error.set(this.t.translate('RESTAURANTS.UI.COPY_FAILED'));
    }
  }
}
