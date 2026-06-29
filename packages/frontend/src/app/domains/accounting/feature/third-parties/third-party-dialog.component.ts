import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { type CreateThirdPartyRequest, type ThirdPartyDto, type ThirdPartyTypeValue, type UpdateThirdPartyRequest } from '@liass-ohada/shared/accounting';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { AccountingApi } from '../../data-access/accounting.api';

export interface ThirdPartyDialogData {
  mode: 'create' | 'edit';
  type: ThirdPartyTypeValue;
  thirdParty?: ThirdPartyDto;
}

@Component({
  selector: 'liass-third-party-dialog',
  imports: [LiassButtonComponent, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, ReactiveFormsModule, TranslocoModule],
  templateUrl: './third-party-dialog.component.html'
})
export class ThirdPartyDialogComponent {
  private readonly accountingApi = inject(AccountingApi);
  private readonly data = inject<ThirdPartyDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<ThirdPartyDialogComponent, ThirdPartyDto | null>>(MatDialogRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly notification = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);

  protected readonly errorMessage = signal<string | null>(null);
  protected readonly isEditMode = this.data.mode === 'edit';
  protected readonly submitting = signal(false);
  protected readonly type = this.data.type;
  protected readonly typeLabelKey = `ACCOUNTING.THIRD_PARTIES.TYPES.${this.type}`;
  protected readonly titleKey = computed(() =>
    this.isEditMode
      ? 'ACCOUNTING.THIRD_PARTIES.DIALOG.EDIT_TITLE'
      : this.type === 'CUSTOMER'
        ? 'ACCOUNTING.THIRD_PARTIES.DIALOG.CREATE_CUSTOMER_TITLE'
        : 'ACCOUNTING.THIRD_PARTIES.DIALOG.CREATE_SUPPLIER_TITLE'
  );

  protected readonly form = this.formBuilder.nonNullable.group({
    type: [{ disabled: true, value: this.transloco.translate(this.typeLabelKey) }],
    code: [{ disabled: this.isEditMode, value: this.data.thirdParty?.code ?? '' }, [Validators.required, Validators.maxLength(50)]],
    displayName: [this.data.thirdParty?.displayName ?? '', [Validators.required, Validators.maxLength(255)]],
    email: [this.data.thirdParty?.email ?? '', [Validators.email]],
    phone: [this.data.thirdParty?.phone ?? '', [Validators.maxLength(50)]],
    address: [this.data.thirdParty?.address ?? '', [Validators.maxLength(500)]],
    country: [this.data.thirdParty?.country ?? '', [Validators.maxLength(100)]],
    taxIdentifier: [this.data.thirdParty?.taxIdentifier ?? '', [Validators.maxLength(100)]]
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    try {
      const result = this.isEditMode
        ? await this.accountingApi.updateThirdParty(this.data.thirdParty!.thirdPartyId, this.data.thirdParty!.type, this.editPayload())
        : await this.accountingApi.createThirdParty(this.createPayload());
      const fallbackKey = this.isEditMode ? 'ACCOUNTING.THIRD_PARTIES.NOTIFICATIONS.UPDATED' : 'ACCOUNTING.THIRD_PARTIES.NOTIFICATIONS.CREATED';

      this.notification.success(result.message ?? this.transloco.translate(fallbackKey));
      this.dialogRef.close(result.data);
    } catch (error) {
      if (error instanceof NoThirdPartyChangesError) {
        const message = this.transloco.translate('ACCOUNTING.THIRD_PARTIES.NOTIFICATIONS.NO_CHANGES');

        this.notification.info(message);
        return;
      }

      const fallbackKey = this.isEditMode ? 'ACCOUNTING.THIRD_PARTIES.ERRORS.UPDATE_FAILED' : 'ACCOUNTING.THIRD_PARTIES.ERRORS.CREATE_FAILED';
      const message = safeMessageFromError(error) || String(this.transloco.translate(fallbackKey) || fallbackKey);

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

  private createPayload(): CreateThirdPartyRequest {
    const raw = this.form.getRawValue();

    return {
      ...normalizedMutableFields(raw),
      code: raw.code.trim().toUpperCase(),
      type: this.type
    };
  }

  private editPayload(): UpdateThirdPartyRequest {
    const original = this.data.thirdParty!;
    const patch: Partial<Record<MutableThirdPartyField, string>> = {};

    for (const field of MUTABLE_THIRD_PARTY_FIELDS) {
      const value = normalizedFormValue(this.form.getRawValue()[field]);
      const existing = normalizedDtoValue(original[field]);

      if (value && value !== existing) {
        patch[field] = value;
      }
    }

    if (Object.keys(patch).length === 0) {
      throw new NoThirdPartyChangesError();
    }

    return patch;
  }
}

const MUTABLE_THIRD_PARTY_FIELDS = ['displayName', 'email', 'phone', 'address', 'country', 'taxIdentifier'] as const;

type MutableThirdPartyField = (typeof MUTABLE_THIRD_PARTY_FIELDS)[number];

class NoThirdPartyChangesError extends Error {
  constructor() {
    super('No third-party changes detected');
    this.name = 'NoThirdPartyChangesError';
  }
}

function normalizedMutableFields(raw: Record<MutableThirdPartyField, string>): MutableThirdPartyPayload {
  return {
    displayName: normalizedFormValue(raw.displayName),
    ...optionalField('email', raw.email),
    ...optionalField('phone', raw.phone),
    ...optionalField('address', raw.address),
    ...optionalField('country', raw.country),
    ...optionalField('taxIdentifier', raw.taxIdentifier)
  };
}

type MutableThirdPartyPayload = {
  displayName: string;
} & Partial<Record<Exclude<MutableThirdPartyField, 'displayName'>, string>>;

function optionalField(field: Exclude<MutableThirdPartyField, 'displayName'>, value: string): Partial<MutableThirdPartyPayload> {
  const normalized = normalizedFormValue(value);

  return normalized ? { [field]: normalized } : {};
}

function normalizedFormValue(value: string): string {
  return value.trim();
}

function normalizedDtoValue(value: string | undefined): string {
  return value?.trim() ?? '';
}
