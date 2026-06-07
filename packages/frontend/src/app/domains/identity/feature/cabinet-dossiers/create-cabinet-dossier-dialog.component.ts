import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { CabinetDossierSummary, CreateCabinetDossierRequest } from '@liass-ohada/shared/shared';
import { TranslocoModule } from '@ngneat/transloco';
import { ZodError } from 'zod';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassSearchableSelectComponent } from '../../../../shared/ui/searchable-select/searchable-select.component';
import { AuthStore } from '../../data-access/auth.store';
import { CabinetDossiersApi } from '../../data-access/cabinet-dossiers.api';

type AccountingFramework = 'SYSCOHADA_REVISED' | 'SYCEBNL';
type DossierErrorKey =
  | 'IDENTITY.CABINET_DOSSIERS.ERRORS.CREATE_FAILED'
  | 'IDENTITY.CABINET_DOSSIERS.ERRORS.DUPLICATE'
  | 'IDENTITY.CABINET_DOSSIERS.ERRORS.NETWORK'
  | 'IDENTITY.CABINET_DOSSIERS.ERRORS.VALIDATION';

interface SelectOption<T extends string> {
  value: T;
  labelKey: string;
}

@Component({
  selector: 'liass-create-cabinet-dossier-dialog',
  imports: [
    LiassButtonComponent,
    LiassSearchableSelectComponent,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslocoModule
  ],
  templateUrl: './create-cabinet-dossier-dialog.component.html'
})
export class CreateCabinetDossierDialogComponent {
  private readonly authStore = inject(AuthStore);
  private readonly cabinetDossiersApi = inject(CabinetDossiersApi);
  private readonly dialogRef = inject<
    MatDialogRef<CreateCabinetDossierDialogComponent, CabinetDossierSummary | null>
  >(MatDialogRef);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<DossierErrorKey | null>(null);

  protected readonly countryOptions: SelectOption<string>[] = [
    { value: 'BJ', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.BENIN' },
    { value: 'TG', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.TOGO' },
    { value: 'CI', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.COTE_D_IVOIRE' },
    { value: 'SN', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.SENEGAL' },
    { value: 'BF', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.BURKINA_FASO' },
    { value: 'ML', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.MALI' },
    { value: 'NE', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.NIGER' },
    { value: 'CM', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.CAMEROON' },
    { value: 'CG', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.CONGO' },
    { value: 'GA', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.GABON' },
    { value: 'TD', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.CHAD' },
    { value: 'CF', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.CENTRAL_AFRICAN_REPUBLIC' },
    { value: 'GN', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.GUINEA' },
    { value: 'GW', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.GUINEA_BISSAU' },
    { value: 'GQ', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.EQUATORIAL_GUINEA' },
    { value: 'CD', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.DEMOCRATIC_REPUBLIC_OF_CONGO' },
    { value: 'KM', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.COMOROS' }
  ];

  protected readonly frameworkOptions: SelectOption<AccountingFramework>[] = [
    { value: 'SYSCOHADA_REVISED', labelKey: 'IDENTITY.ONBOARDING.FRAMEWORKS.SYSCOHADA_REVISED' },
    { value: 'SYCEBNL', labelKey: 'IDENTITY.ONBOARDING.FRAMEWORKS.SYCEBNL' }
  ];

  protected readonly form = this.formBuilder.nonNullable.group({
    companyName: ['', [Validators.required]],
    country: ['BJ', [Validators.required]],
    accountingFramework: ['SYSCOHADA_REVISED' as AccountingFramework, [Validators.required]]
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    const rawValue = this.form.getRawValue();
    const request: CreateCabinetDossierRequest = {
      companyName: rawValue.companyName,
      country: rawValue.country as CreateCabinetDossierRequest['country'],
      accountingFramework:
        rawValue.accountingFramework as CreateCabinetDossierRequest['accountingFramework']
    };

    try {
      const result = await this.cabinetDossiersApi.createDossier(request);
      this.authStore.upsertDossier(result.dossier);
      this.dialogRef.close(result.dossier);
    } catch (error) {
      this.errorKey.set(errorKeyFromFailure(error));
    } finally {
      this.submitting.set(false);
    }
  }

  protected cancel(): void {
    if (this.submitting()) {
      return;
    }

    this.dialogRef.close(null);
  }
}

function errorKeyFromFailure(error: unknown): DossierErrorKey {
  if (error instanceof ZodError) {
    return 'IDENTITY.CABINET_DOSSIERS.ERRORS.VALIDATION';
  }

  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return 'IDENTITY.CABINET_DOSSIERS.ERRORS.NETWORK';
    }

    const message = `${error.error?.message?.code ?? error.error?.message ?? ''}`;

    if (message.includes('CABINET_DOSSIER_ALREADY_EXISTS')) {
      return 'IDENTITY.CABINET_DOSSIERS.ERRORS.DUPLICATE';
    }
  }

  return 'IDENTITY.CABINET_DOSSIERS.ERRORS.CREATE_FAILED';
}
