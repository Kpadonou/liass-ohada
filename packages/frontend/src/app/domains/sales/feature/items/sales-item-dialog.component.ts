import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  type CreateSalesCatalogItemRequest,
  type SalesCatalogItem,
  type SalesCatalogItemType,
  type UpdateSalesCatalogItemRequest
} from '@liass-ohada/shared/sales';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { SalesItemsApi } from '../../data-access/sales-items.api';
import { SalesItemsQueries } from '../../data-access/sales-items.queries';

export interface SalesItemDialogData {
  mode: 'create' | 'edit';
  item?: SalesCatalogItem;
}

@Component({
  selector: 'liass-sales-item-dialog',
  imports: [LiassButtonComponent, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, ReactiveFormsModule, TranslocoModule],
  templateUrl: './sales-item-dialog.component.html'
})
export class SalesItemDialogComponent {
  private readonly api = inject(SalesItemsApi);
  protected readonly data = inject<SalesItemDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<SalesItemDialogComponent, SalesCatalogItem | null>>(MatDialogRef);
  private readonly notification = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly queries = inject(SalesItemsQueries);
  private readonly transloco = inject(TranslocoService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly errorMessage = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly isEdit = this.data.mode === 'edit';
  private readonly authoritativeItem = signal(this.data.item);
  protected readonly form = this.formBuilder.nonNullable.group({
    itemType: [this.data.item?.itemType ?? 'PRODUCT', Validators.required],
    name: [this.data.item?.name ?? '', [Validators.required, Validators.maxLength(160)]],
    description: [this.data.item?.description ?? '', Validators.maxLength(2000)],
    unit: [this.data.item?.unit ?? '', Validators.maxLength(80)]
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);
    try {
      const result = this.isEdit
        ? await this.api.update(this.data.item!.id, this.updatePayload())
        : await this.api.create(this.createPayload());
      const fallback = this.isEdit ? 'SALES.ITEMS.NOTIFICATIONS.UPDATED' : 'SALES.ITEMS.NOTIFICATIONS.CREATED';
      this.notification.success(result.message ?? this.transloco.translate(fallback));
      this.dialogRef.close(result.data);
    } catch (error) {
      const conflict = this.isEdit && error instanceof HttpErrorResponse && error.status === 409;
      const fallback = conflict
        ? 'SALES.ITEMS.ERRORS.CONFLICT'
        : this.isEdit ? 'SALES.ITEMS.ERRORS.UPDATE_FAILED' : 'SALES.ITEMS.ERRORS.CREATE_FAILED';
      const fallbackMessage = this.transloco.translate<string>(fallback);
      const message = conflict ? fallbackMessage : safeMessageFromError(error) ?? fallbackMessage;
      this.errorMessage.set(message);
      this.notification.error(message);
      if (conflict && this.data.item) await this.reloadAfterConflict(this.data.item.id);
    } finally {
      this.submitting.set(false);
    }
  }

  protected cancel(): void { if (!this.submitting()) this.dialogRef.close(null); }

  private createPayload(): CreateSalesCatalogItemRequest {
    const raw = this.form.getRawValue();
    return {
      itemType: raw.itemType as SalesCatalogItemType,
      name: raw.name.trim(),
      ...optional('description', raw.description),
      ...optional('unit', raw.unit)
    };
  }

  private updatePayload(): UpdateSalesCatalogItemRequest {
    return { ...this.createPayload(), expectedVersion: this.authoritativeItem()!.version };
  }

  private async reloadAfterConflict(itemId: string): Promise<void> {
    await this.queryClient.invalidateQueries({ queryKey: this.queries.rootKey() });
    await this.queryClient.invalidateQueries({ queryKey: this.queries.detailKey(itemId) });
    try {
      const current = await this.queryClient.fetchQuery(this.queries.detail(itemId));
      this.authoritativeItem.set(current);
      this.form.reset({
        itemType: current.itemType,
        name: current.name,
        description: current.description ?? '',
        unit: current.unit ?? ''
      });
    } catch {
      // The conflict remains visible and the dialog stays open if refresh also fails.
    }
  }
}

function optional<K extends 'description' | 'unit'>(key: K, value: string): Partial<Record<K, string>> {
  const normalized = value.trim();
  return normalized ? { [key]: normalized } as Record<K, string> : {};
}
