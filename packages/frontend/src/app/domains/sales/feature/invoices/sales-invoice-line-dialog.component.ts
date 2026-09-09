import { Component, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, type ValidationErrors, type ValidatorFn, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import {
  SalesInvoiceQuantitySchema,
  SalesInvoiceTaxRateSchema,
  SalesInvoiceUnitPriceSchema,
  type AddSalesInvoiceLineRequest,
  type SalesCatalogItem,
  type SalesInvoice,
  type SalesInvoiceLine,
  type UpdateSalesInvoiceLineRequest
} from '@liass-ohada/shared/sales';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import type { ZodType } from 'zod';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { SalesInvoicesApi } from '../../data-access/sales-invoices.api';
import { SalesInvoicesQueries } from '../../data-access/sales-invoices.queries';
import { SalesItemsQueries } from '../../data-access/sales-items.queries';
import { isSalesInvoiceVersionConflict, salesInvoiceErrorCode } from '../../utils/sales-invoice-errors';

export interface SalesInvoiceLineDialogData {
  invoice: SalesInvoice;
  line?: SalesInvoiceLine;
}

const PAGE_SIZE = 25;

export function invoiceLineUnitPatch(
  unit: string,
  dirty: boolean
): Pick<UpdateSalesInvoiceLineRequest, 'unit'> {
  if (!dirty) return {};
  const trimmed = unit.trim();
  return { unit: trimmed || null };
}

@Component({
  selector: 'liass-sales-invoice-line-dialog',
  imports: [LiassButtonComponent, LiassSkeletonComponent, MatButtonToggleModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, ReactiveFormsModule, TranslocoModule],
  templateUrl: './sales-invoice-line-dialog.component.html'
})
export class SalesInvoiceLineDialogComponent {
  protected readonly data = inject<SalesInvoiceLineDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(SalesInvoicesApi);
  private readonly dialogRef = inject<MatDialogRef<SalesInvoiceLineDialogComponent, SalesInvoice | null>>(MatDialogRef);
  private readonly invoiceQueries = inject(SalesInvoicesQueries);
  private readonly itemQueries = inject(SalesItemsQueries);
  private readonly notification = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly transloco = inject(TranslocoService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly isEdit = !!this.data.line;
  protected readonly sourceMode = signal<'catalog' | 'free'>(this.data.line?.catalogItemId ? 'catalog' : 'free');
  protected readonly selectedItem = signal<SalesCatalogItem | null>(null);
  protected readonly cursor = signal<string | undefined>(undefined);
  protected readonly cursorHistory = signal<string[]>([]);
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly itemsQuery = injectQuery(() => this.itemQueries.list(
    { limit: PAGE_SIZE, cursor: this.cursor() }, !this.isEdit && this.sourceMode() === 'catalog'
  ));
  protected readonly items = computed(() => this.itemsQuery.data()?.items ?? []);
  protected readonly hasPrevious = computed(() => this.cursorHistory().length > 0);
  protected readonly hasNext = computed(() => !!this.itemsQuery.data()?.nextCursor);
  protected readonly form = this.formBuilder.nonNullable.group({
    description: [this.data.line?.description ?? '', [Validators.maxLength(2000)]],
    unit: [this.data.line?.unit ?? '', [Validators.maxLength(80)]],
    quantity: [this.data.line?.quantity ?? '1', [Validators.required, zodValidator(SalesInvoiceQuantitySchema)]],
    unitPrice: [this.data.line?.unitPrice ?? '0', [Validators.required, zodValidator(SalesInvoiceUnitPriceSchema)]],
    taxRate: [this.data.line?.taxRate ?? '0', [Validators.required, zodValidator(SalesInvoiceTaxRateSchema)]]
  });

  protected setMode(mode: 'catalog' | 'free'): void {
    if (this.isEdit) return;
    this.sourceMode.set(mode);
    this.selectedItem.set(null);
    this.errorMessage.set(null);
  }

  protected selectItem(item: SalesCatalogItem): void {
    if (item.isActive) this.selectedItem.set(item);
  }

  protected nextPage(): void {
    const next = this.itemsQuery.data()?.nextCursor;
    if (!next) return;
    this.cursorHistory.update((history) => [...history, this.cursor() ?? '']);
    this.cursor.set(next);
  }

  protected previousPage(): void {
    const history = [...this.cursorHistory()];
    const previous = history.pop();
    this.cursorHistory.set(history);
    this.cursor.set(previous || undefined);
  }

  protected async submit(): Promise<void> {
    const freeDescriptionMissing = !this.isEdit && this.sourceMode() === 'free' && !this.form.controls.description.value.trim();
    const catalogMissing = !this.isEdit && this.sourceMode() === 'catalog' && !this.selectedItem();
    if (this.form.invalid || freeDescriptionMissing || catalogMissing || this.submitting()) {
      this.form.markAllAsTouched();
      if (freeDescriptionMissing || catalogMissing) this.errorMessage.set(this.transloco.translate(freeDescriptionMissing ? 'SALES.INVOICES.VALIDATION.DESCRIPTION_REQUIRED' : 'SALES.INVOICES.VALIDATION.ITEM_REQUIRED'));
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);
    try {
      const result = this.isEdit
        ? await this.api.updateLine(this.data.invoice.id, this.data.line!.id, this.updatePayload())
        : await this.api.addLine(this.data.invoice.id, this.addPayload());
      this.notification.success(result.message ?? this.transloco.translate(this.isEdit ? 'SALES.INVOICES.NOTIFICATIONS.LINE_UPDATED' : 'SALES.INVOICES.NOTIFICATIONS.LINE_ADDED'));
      this.dialogRef.close(result.data);
    } catch (error) {
      const code = salesInvoiceErrorCode(error);
      const key = isSalesInvoiceVersionConflict(error) ? 'SALES.INVOICES.ERRORS.CONFLICT'
        : code === 'SALES_ITEM_INACTIVE' ? 'SALES.INVOICES.ERRORS.ITEM_INACTIVE'
        : code === 'SALES_ITEM_NOT_FOUND' ? 'SALES.INVOICES.ERRORS.ITEM_NOT_FOUND'
        : code === 'MAX_INVOICE_LINES_EXCEEDED' ? 'SALES.INVOICES.ERRORS.MAX_LINES'
        : this.isEdit ? 'SALES.INVOICES.ERRORS.LINE_UPDATE_FAILED' : 'SALES.INVOICES.ERRORS.LINE_ADD_FAILED';
      const knownDomainError = isSalesInvoiceVersionConflict(error) || code === 'SALES_ITEM_INACTIVE' || code === 'SALES_ITEM_NOT_FOUND' || code === 'MAX_INVOICE_LINES_EXCEEDED';
      const message = knownDomainError
        ? this.transloco.translate<string>(key) ?? key
        : safeMessageFromError(error) ?? this.transloco.translate<string>(key) ?? key;
      this.errorMessage.set(message);
      this.notification.error(message);
      if (code === 'SALES_ITEM_INACTIVE' || code === 'SALES_ITEM_NOT_FOUND') {
        await this.queryClient.invalidateQueries({ queryKey: this.itemQueries.rootKey() });
      }
      if (isSalesInvoiceVersionConflict(error)) {
        await Promise.all([
          this.queryClient.invalidateQueries({ queryKey: this.invoiceQueries.detailKey(this.data.invoice.id) }),
          this.queryClient.invalidateQueries({ queryKey: this.invoiceQueries.rootKey() })
        ]);
      }
    } finally { this.submitting.set(false); }
  }

  protected cancel(): void { if (!this.submitting()) this.dialogRef.close(null); }

  private addPayload(): AddSalesInvoiceLineRequest {
    const raw = this.form.getRawValue();
    const catalogItemId = this.sourceMode() === 'catalog' ? this.selectedItem()!.id : undefined;
    return {
      expectedVersion: this.data.invoice.version,
      ...(catalogItemId ? { catalogItemId } : {}),
      ...((this.sourceMode() === 'free' || this.form.controls.description.dirty) && raw.description.trim() ? { description: raw.description.trim() } : {}),
      ...(this.form.controls.unit.dirty && raw.unit.trim() ? { unit: raw.unit.trim() } : {}),
      quantity: raw.quantity,
      unitPrice: raw.unitPrice,
      taxRate: raw.taxRate
    };
  }

  private updatePayload(): UpdateSalesInvoiceLineRequest {
    const raw = this.form.getRawValue();
    return {
      expectedVersion: this.data.invoice.version,
      description: raw.description.trim(),
      ...invoiceLineUnitPatch(raw.unit, this.form.controls.unit.dirty),
      quantity: raw.quantity,
      unitPrice: raw.unitPrice,
      taxRate: raw.taxRate
    };
  }
}

function zodValidator(schema: ZodType): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => schema.safeParse(control.value).success ? null : { decimal: true };
}
