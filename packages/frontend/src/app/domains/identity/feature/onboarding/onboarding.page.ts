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
import {
  accountingFrameworkOptions,
  ohadaCountryOptions
} from '../../utils/workspace-presentation';

type OnboardingErrorKey =
  | 'IDENTITY.ONBOARDING.ERRORS.AUTH_REQUIRED'
  | 'IDENTITY.ONBOARDING.ERRORS.CREATE_FAILED'
  | 'IDENTITY.ONBOARDING.ERRORS.DUPLICATE_WORKSPACE'
  | 'IDENTITY.ONBOARDING.ERRORS.MISSING_ROUTE'
  | 'IDENTITY.ONBOARDING.ERRORS.NETWORK'
  | 'IDENTITY.ONBOARDING.ERRORS.SERVER'
  | 'IDENTITY.ONBOARDING.ERRORS.VALIDATION';
type OnboardingStep = 'intent' | 'organization' | 'configuration';
type AvailableOnboardingIntent = 'ACCOUNTING' | 'ACCOUNTING_FIRM';
type OnboardingIntent = AvailableOnboardingIntent | 'BENIN_INVOICING';
type WorkspaceType = 'ACCOUNTING_FIRM' | 'COMPANY';

type OnboardingIntentOption =
  | {
      id: AvailableOnboardingIntent;
      icon: string;
      available: true;
      titleKey: string;
      descriptionKey: string;
    }
  | {
      id: Exclude<OnboardingIntent, AvailableOnboardingIntent>;
      icon: string;
      available: false;
      titleKey: string;
      descriptionKey: string;
      brandKey: string;
    };

const WORKSPACE_TYPE_BY_INTENT: Record<AvailableOnboardingIntent, WorkspaceType> = {
  ACCOUNTING: 'COMPANY',
  ACCOUNTING_FIRM: 'ACCOUNTING_FIRM'
};

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

  protected readonly currentStep = signal<OnboardingStep>('intent');
  protected readonly onboardingErrorKey = signal<OnboardingErrorKey | null>(null);
  protected readonly selectedIntent = signal<AvailableOnboardingIntent | null>(null);
  protected readonly intentTouched = signal(false);
  protected readonly submitting = signal(false);

  protected readonly countryOptions = ohadaCountryOptions;
  protected readonly frameworkOptions = accountingFrameworkOptions;
  protected readonly intentOptions: readonly OnboardingIntentOption[] = [
    {
      id: 'ACCOUNTING',
      icon: 'account_balance',
      available: true,
      titleKey: 'IDENTITY.ONBOARDING.INTENTS.ACCOUNTING.TITLE',
      descriptionKey: 'IDENTITY.ONBOARDING.INTENTS.ACCOUNTING.DESCRIPTION'
    },
    {
      id: 'BENIN_INVOICING',
      icon: 'receipt_long',
      available: false,
      brandKey: 'IDENTITY.ONBOARDING.INTENTS.BENIN_INVOICING.BRAND',
      titleKey: 'IDENTITY.ONBOARDING.INTENTS.BENIN_INVOICING.TITLE',
      descriptionKey: 'IDENTITY.ONBOARDING.INTENTS.BENIN_INVOICING.DESCRIPTION'
    },
    {
      id: 'ACCOUNTING_FIRM',
      icon: 'groups',
      available: true,
      titleKey: 'IDENTITY.ONBOARDING.INTENTS.ACCOUNTING_FIRM.TITLE',
      descriptionKey: 'IDENTITY.ONBOARDING.INTENTS.ACCOUNTING_FIRM.DESCRIPTION'
    }
  ];

  protected readonly stepNumber = computed(() => {
    switch (this.currentStep()) {
      case 'intent':
        return 1;
      case 'organization':
        return 2;
      case 'configuration':
        return 3;
    }
  });
  protected readonly isAccountingFirm = computed(() => this.selectedIntent() === 'ACCOUNTING_FIRM');
  protected readonly organizationHeadingKey = computed(() =>
    this.isAccountingFirm()
      ? 'IDENTITY.ONBOARDING.ORGANIZATION.CABINET_TITLE'
      : 'IDENTITY.ONBOARDING.ORGANIZATION.COMPANY_TITLE'
  );
  protected readonly organizationDescriptionKey = computed(() =>
    this.isAccountingFirm()
      ? 'IDENTITY.ONBOARDING.ORGANIZATION.CABINET_DESCRIPTION'
      : 'IDENTITY.ONBOARDING.ORGANIZATION.COMPANY_DESCRIPTION'
  );
  protected readonly organizationNameLabelKey = computed(() =>
    this.isAccountingFirm()
      ? 'IDENTITY.ONBOARDING.FIELDS.ACCOUNTING_FIRM_NAME'
      : 'IDENTITY.ONBOARDING.FIELDS.COMPANY_NAME'
  );
  protected readonly configurationHeadingKey = computed(() =>
    this.isAccountingFirm()
      ? 'IDENTITY.ONBOARDING.CONFIGURATION.CABINET_TITLE'
      : 'IDENTITY.ONBOARDING.CONFIGURATION.ACCOUNTING_TITLE'
  );
  protected readonly configurationDescriptionKey = computed(() =>
    this.isAccountingFirm()
      ? 'IDENTITY.ONBOARDING.CONFIGURATION.CABINET_DESCRIPTION'
      : 'IDENTITY.ONBOARDING.CONFIGURATION.ACCOUNTING_DESCRIPTION'
  );
  protected readonly accountingFrameworkLabelKey = computed(() =>
    this.isAccountingFirm()
      ? 'IDENTITY.ONBOARDING.FIELDS.DEFAULT_ACCOUNTING_FRAMEWORK'
      : 'IDENTITY.ONBOARDING.FIELDS.ACCOUNTING_FRAMEWORK'
  );

  protected readonly form = this.formBuilder.nonNullable.group({
    workspaceType: ['', [Validators.required]],
    organizationName: ['', [Validators.required]],
    country: ['BJ', [Validators.required]],
    accountingFramework: ['', [Validators.required]]
  });

  async ngOnInit(): Promise<void> {
    if (!this.authStore.workspacesLoaded()) {
      await this.authStore.loadWorkspaces();
    }

    const destination = this.authStore.workspaceDestination();
    if (destination && destination !== '/onboarding') {
      await this.router.navigate([destination], { replaceUrl: true });
    }
  }

  protected selectIntent(intent: AvailableOnboardingIntent): void {
    if (this.selectedIntent() !== intent) {
      this.form.controls.accountingFramework.reset('');
    }

    this.selectedIntent.set(intent);
    this.form.controls.workspaceType.setValue(WORKSPACE_TYPE_BY_INTENT[intent]);
    this.form.controls.workspaceType.markAsTouched();
    this.intentTouched.set(true);
    this.onboardingErrorKey.set(null);
  }

  protected continueFromIntent(): void {
    this.intentTouched.set(true);

    if (!this.selectedIntent()) {
      return;
    }

    this.currentStep.set('organization');
  }

  protected continueFromOrganization(): void {
    this.form.controls.organizationName.markAsTouched();
    this.form.controls.country.markAsTouched();

    if (this.form.controls.organizationName.invalid || this.form.controls.country.invalid) {
      return;
    }

    this.currentStep.set('configuration');
  }

  protected back(): void {
    this.onboardingErrorKey.set(null);

    if (this.currentStep() === 'configuration') {
      this.currentStep.set('organization');
      return;
    }

    this.currentStep.set('intent');
  }

  protected async submitOnboarding(): Promise<void> {
    this.form.markAllAsTouched();
    this.onboardingErrorKey.set(null);

    if (this.form.invalid || this.submitting() || this.currentStep() !== 'configuration') {
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
