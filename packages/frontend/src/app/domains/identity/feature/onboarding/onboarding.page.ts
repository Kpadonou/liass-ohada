import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import type { CreateInitialWorkspaceRequest } from '@liass-ohada/shared/shared';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassSearchableSelectComponent } from '../../../../shared/ui/searchable-select/searchable-select.component';
import { AuthStore, type ActiveWorkspaceSummary } from '../../data-access/auth.store';
import { OnboardingApi } from '../../data-access/onboarding.api';

type AccountingFramework = 'SYSCOHADA_REVISED' | 'SYCEBNL';
type OnboardingErrorKey =
  | 'IDENTITY.ONBOARDING.ERRORS.AUTH_REQUIRED'
  | 'IDENTITY.ONBOARDING.ERRORS.CREATE_FAILED'
  | 'IDENTITY.ONBOARDING.ERRORS.DUPLICATE_WORKSPACE'
  | 'IDENTITY.ONBOARDING.ERRORS.MISSING_ROUTE'
  | 'IDENTITY.ONBOARDING.ERRORS.NETWORK'
  | 'IDENTITY.ONBOARDING.ERRORS.SERVER'
  | 'IDENTITY.ONBOARDING.ERRORS.VALIDATION';
type OnboardingStep = 'workspaceType' | 'organizationDetails';
type WorkspaceType = 'ACCOUNTING_FIRM' | 'COMPANY';

interface SelectOption<T extends string> {
  value: T;
  labelKey: string;
}

@Component({
  selector: 'liass-onboarding-page',
  imports: [
    LiassButtonComponent,
    LiassCardComponent,
    LiassSearchableSelectComponent,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslocoModule
  ],
  templateUrl: './onboarding.page.html'
})
export class OnboardingPage implements OnInit {
  protected readonly authStore = inject(AuthStore);
  private readonly formBuilder = inject(FormBuilder);
  private readonly onboardingApi = inject(OnboardingApi);
  private readonly router = inject(Router);

  protected readonly currentStep = signal<OnboardingStep>('workspaceType');
  protected readonly onboardingErrorKey = signal<OnboardingErrorKey | null>(null);
  protected readonly selectedWorkspaceType = signal<WorkspaceType | null>(null);
  protected readonly submitting = signal(false);

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
    workspaceType: ['', [Validators.required]],
    organizationName: ['', [Validators.required]],
    country: ['BJ', [Validators.required]],
    accountingFramework: ['SYSCOHADA_REVISED' as AccountingFramework, [Validators.required]]
  });

  protected readonly organizationNameLabelKey = computed(() =>
    this.selectedWorkspaceType() === 'ACCOUNTING_FIRM'
      ? 'IDENTITY.ONBOARDING.FIELDS.ACCOUNTING_FIRM_NAME'
      : 'IDENTITY.ONBOARDING.FIELDS.COMPANY_NAME'
  );

  async ngOnInit(): Promise<void> {
    if (!this.authStore.workspacesLoaded()) {
      await this.authStore.loadWorkspaces();
    }

    const destination = this.authStore.workspaceDestination();
    if (destination && destination !== '/onboarding') {
      await this.router.navigate([destination], { replaceUrl: true });
    }
  }

  protected selectWorkspaceType(workspaceType: WorkspaceType): void {
    this.selectedWorkspaceType.set(workspaceType);
    this.form.controls.workspaceType.setValue(workspaceType);
    this.form.controls.workspaceType.markAsTouched();
    this.onboardingErrorKey.set(null);
  }

  protected continueToDetails(): void {
    this.form.controls.workspaceType.markAsTouched();

    if (this.form.controls.workspaceType.invalid) {
      return;
    }

    this.currentStep.set('organizationDetails');
  }

  protected backToWorkspaceType(): void {
    this.onboardingErrorKey.set(null);
    this.currentStep.set('workspaceType');
  }

  protected async submitOnboarding(): Promise<void> {
    this.form.markAllAsTouched();
    this.onboardingErrorKey.set(null);

    if (this.form.invalid || this.submitting()) {
      return;
    }

    const rawValue = this.form.getRawValue();
    const request: CreateInitialWorkspaceRequest = {
      workspaceType: rawValue.workspaceType as WorkspaceType,
      organizationName: rawValue.organizationName,
      country: rawValue.country as CreateInitialWorkspaceRequest['country'],
      accountingFramework:
        rawValue.accountingFramework as CreateInitialWorkspaceRequest['accountingFramework']
    };

    this.submitting.set(true);

    try {
      const result = await this.onboardingApi.createInitialWorkspace(request);
      const createdWorkspace: ActiveWorkspaceSummary = {
        ...result.workspace,
        cabinet: result.cabinet,
        organization: result.organization
      };
      this.authStore.setCreatedWorkspace(createdWorkspace, result.activeOrgId);
      await this.router.navigate([this.authStore.workspaceDestination() ?? '/dashboard'], {
        replaceUrl: true
      });
    } catch (error) {
      this.onboardingErrorKey.set(this.errorKeyFrom(error));
    } finally {
      this.submitting.set(false);
    }
  }

  private errorKeyFrom(error: unknown): OnboardingErrorKey {
    const httpError = this.httpErrorLike(error);

    if (httpError) {
      if (httpError.status === 0) {
        return 'IDENTITY.ONBOARDING.ERRORS.NETWORK';
      }

      if (httpError.code === 'WORKSPACE_ALREADY_EXISTS') {
        return 'IDENTITY.ONBOARDING.ERRORS.DUPLICATE_WORKSPACE';
      }

      if (httpError.status === 400) {
        return 'IDENTITY.ONBOARDING.ERRORS.VALIDATION';
      }

      if (httpError.status === 401 || httpError.status === 403) {
        return 'IDENTITY.ONBOARDING.ERRORS.AUTH_REQUIRED';
      }

      if (httpError.status === 404) {
        return 'IDENTITY.ONBOARDING.ERRORS.MISSING_ROUTE';
      }

      if (httpError.status >= 500) {
        return 'IDENTITY.ONBOARDING.ERRORS.SERVER';
      }

      return 'IDENTITY.ONBOARDING.ERRORS.CREATE_FAILED';
    }

    if (error instanceof Error && error.name === 'ZodError') {
      return 'IDENTITY.ONBOARDING.ERRORS.VALIDATION';
    }

    return 'IDENTITY.ONBOARDING.ERRORS.CREATE_FAILED';
  }

  private httpErrorLike(error: unknown): { code?: string; status: number } | null {
    if (error instanceof HttpErrorResponse) {
      return {
        code: error.error?.message?.code,
        status: error.status
      };
    }

    if (!error || typeof error !== 'object' || !('status' in error)) {
      return null;
    }

    const status = Number((error as { status: unknown }).status);

    if (!Number.isFinite(status)) {
      return null;
    }

    const body = (error as { error?: { message?: { code?: unknown } } }).error;
    const code = body?.message?.code;

    return {
      code: typeof code === 'string' ? code : undefined,
      status
    };
  }
}
