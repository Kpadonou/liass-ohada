import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  type CreateSalesCustomerRequest,
  type SalesCustomer,
  type SalesCustomerAddress,
  type UpdateSalesCustomerRequest
} from '@liass-ohada/shared/sales';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { SalesCustomersApi } from '../../data-access/sales-customers.api';
import { SalesCustomersQueries } from '../../data-access/sales-customers.queries';

export interface SalesCustomerDialogData {
  mode: 'create' | 'edit';
  customer?: SalesCustomer;
}

@Component({
  selector: 'liass-sales-customer-dialog',
  imports: [LiassButtonComponent, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, ReactiveFormsModule, TranslocoModule],
  templateUrl: './sales-customer-dialog.component.html'
})
export class SalesCustomerDialogComponent {
  private readonly api = inject(SalesCustomersApi);
  protected readonly data = inject<SalesCustomerDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<SalesCustomerDialogComponent, SalesCustomer | null>>(MatDialogRef);
  private readonly notification = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly queries = inject(SalesCustomersQueries);
  private readonly transloco = inject(TranslocoService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly errorMessage = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly isEdit = this.data.mode === 'edit';
  private readonly authoritativeCustomer = signal(this.data.customer);
  protected readonly form = this.formBuilder.nonNullable.group({
    customerType: [this.data.customer?.customerType ?? 'BUSINESS', Validators.required],
    name: [this.data.customer?.name ?? '', [Validators.required, Validators.maxLength(160)]],
    email: [this.data.customer?.email ?? '', [Validators.email, Validators.maxLength(254)]],
    phone: [this.data.customer?.phone ?? '', Validators.maxLength(40)],
    taxIdentifier: [this.data.customer?.taxIdentifier ?? '', Validators.maxLength(100)],
    line1: [this.data.customer?.billingAddress?.line1 ?? '', Validators.maxLength(200)],
    line2: [this.data.customer?.billingAddress?.line2 ?? '', Validators.maxLength(200)],
    city: [this.data.customer?.billingAddress?.city ?? '', Validators.maxLength(120)],
    postalCode: [this.data.customer?.billingAddress?.postalCode ?? '', Validators.maxLength(32)],
    country: [this.data.customer?.billingAddress?.country ?? '']
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
        ? await this.api.update(this.data.customer!.id, this.updatePayload())
        : await this.api.create(this.createPayload());
      const fallback = this.isEdit ? 'SALES.CUSTOMERS.NOTIFICATIONS.UPDATED' : 'SALES.CUSTOMERS.NOTIFICATIONS.CREATED';
      this.notification.success(result.message ?? this.transloco.translate(fallback));
      this.dialogRef.close(result.data);
    } catch (error) {
      const conflict = this.isEdit && error instanceof HttpErrorResponse && error.status === 409;
      const fallback = conflict
        ? 'SALES.CUSTOMERS.ERRORS.CONFLICT'
        : this.isEdit ? 'SALES.CUSTOMERS.ERRORS.UPDATE_FAILED' : 'SALES.CUSTOMERS.ERRORS.CREATE_FAILED';
      const fallbackMessage = this.transloco.translate<string>(fallback);
      const message = conflict
        ? fallbackMessage
        : safeMessageFromError(error) ?? fallbackMessage;
      this.errorMessage.set(message);
      this.notification.error(message);
      if (conflict && this.data.customer) {
        await this.reloadAfterConflict(this.data.customer.id);
      }
    } finally {
      this.submitting.set(false);
    }
  }

  protected cancel(): void { if (!this.submitting()) this.dialogRef.close(null); }

  private createPayload(): CreateSalesCustomerRequest {
    const raw = this.form.getRawValue();
    return {
      customerType: raw.customerType as 'BUSINESS' | 'INDIVIDUAL',
      name: raw.name.trim(),
      ...optional('email', raw.email),
      ...optional('phone', raw.phone),
      ...optional('taxIdentifier', raw.taxIdentifier),
      ...addressPayload(raw)
    };
  }

  private updatePayload(): UpdateSalesCustomerRequest {
    return { ...this.createPayload(), expectedVersion: this.authoritativeCustomer()!.version };
  }

  private async reloadAfterConflict(customerId: string): Promise<void> {
    await this.queryClient.invalidateQueries({ queryKey: this.queries.rootKey() });
    await this.queryClient.invalidateQueries({ queryKey: this.queries.detailKey(customerId) });
    try {
      const current = await this.queryClient.fetchQuery(this.queries.detail(customerId));
      this.authoritativeCustomer.set(current);
      this.form.reset({
        customerType: current.customerType,
        name: current.name,
        email: current.email ?? '',
        phone: current.phone ?? '',
        taxIdentifier: current.taxIdentifier ?? '',
        line1: current.billingAddress?.line1 ?? '',
        line2: current.billingAddress?.line2 ?? '',
        city: current.billingAddress?.city ?? '',
        postalCode: current.billingAddress?.postalCode ?? '',
        country: current.billingAddress?.country ?? ''
      });
    } catch {
      // The conflict remains visible and the dialog stays open if the refresh also fails.
    }
  }
}

function optional<K extends 'email' | 'phone' | 'taxIdentifier'>(key: K, value: string): Partial<Record<K, string>> {
  const normalized = value.trim();
  return normalized ? { [key]: normalized } as Record<K, string> : {};
}

function addressPayload(raw: { line1: string; line2: string; city: string; postalCode: string; country: string }): { billingAddress?: SalesCustomerAddress } {
  const address = {
    ...optionalAddress('line1', raw.line1),
    ...optionalAddress('line2', raw.line2),
    ...optionalAddress('city', raw.city),
    ...optionalAddress('postalCode', raw.postalCode),
    ...(raw.country ? { country: raw.country as SalesCustomerAddress['country'] } : {})
  };
  return Object.keys(address).length ? { billingAddress: address } : {};
}

function optionalAddress<K extends 'line1' | 'line2' | 'city' | 'postalCode'>(key: K, value: string): Partial<Record<K, string>> {
  const normalized = value.trim();
  return normalized ? { [key]: normalized } as Record<K, string> : {};
}
