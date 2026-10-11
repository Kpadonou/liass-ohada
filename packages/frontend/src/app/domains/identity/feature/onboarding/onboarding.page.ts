import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { CreateInitialWorkspaceRequestSchema, type ProductCode } from '@liass-ohada/shared/shared';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { productAccessQueryKeys } from '../../../../core/product-access/product-access.queries';
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
type OnboardingStep = 'intent' | 'organization' | 'products' | 'configuration' | 'review';
type AvailableOnboardingIntent = 'COMPANY' | 'ACCOUNTING_FIRM';

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
  private readonly queryClient = inject(QueryClient);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly stepHeading = viewChild<ElementRef<HTMLElement>>('stepHeading');

  protected readonly currentStep = signal<OnboardingStep>('intent');
  protected readonly onboardingErrorKey = signal<OnboardingErrorKey | null>(null);
  protected readonly selectedIntent = signal<AvailableOnboardingIntent | null>(null);
  protected readonly intentTouched = signal(false);
  protected readonly submitting = signal(false);

  protected readonly countryOptions = ohadaCountryOptions;
  protected readonly frameworkOptions = accountingFrameworkOptions;
  protected readonly intentOptions = [
    {
      id: 'COMPANY' as const,
      icon: 'business',
      titleKey: 'IDENTITY.ONBOARDING.INTENTS.COMPANY.TITLE',
      descriptionKey: 'IDENTITY.ONBOARDING.INTENTS.COMPANY.DESCRIPTION'
    },
    {
      id: 'ACCOUNTING_FIRM' as const,
      icon: 'groups',
      titleKey: 'IDENTITY.ONBOARDING.INTENTS.ACCOUNTING_FIRM.TITLE',
      descriptionKey: 'IDENTITY.ONBOARDING.INTENTS.ACCOUNTING_FIRM.DESCRIPTION'
    }
  ];
  protected readonly productOptions: readonly {
    code: ProductCode;
    icon: string;
    titleKey: string;
    descriptionKey: string;
  }[] = [
    {
      code: 'ACCOUNTING',
      icon: 'account_balance',
      titleKey: 'IDENTITY.ONBOARDING.PRODUCTS.ACCOUNTING.TITLE',
      descriptionKey: 'IDENTITY.ONBOARDING.PRODUCTS.ACCOUNTING.DESCRIPTION'
    },
    {
      code: 'SALES',
      icon: 'receipt_long',
      titleKey: 'IDENTITY.ONBOARDING.PRODUCTS.SALES.TITLE',
      descriptionKey: 'IDENTITY.ONBOARDING.PRODUCTS.SALES.DESCRIPTION'
    },
    {
      code: 'RESTAURANTS',
      icon: 'restaurant',
      titleKey: 'IDENTITY.ONBOARDING.PRODUCTS.RESTAURANTS.TITLE',
      descriptionKey: 'IDENTITY.ONBOARDING.PRODUCTS.RESTAURANTS.DESCRIPTION'
    }
  ];
  protected readonly selectedProducts = signal<readonly ProductCode[]>([]);
  protected readonly productsTouched = signal(false);
  protected readonly isAccountingFirm = computed(() => this.selectedIntent() === 'ACCOUNTING_FIRM');
  protected readonly requiresAccounting = computed(
    () => this.isAccountingFirm() || this.selectedProducts().includes('ACCOUNTING')
  );
  protected readonly steps = computed<OnboardingStep[]>(() => [
    'intent',
    'organization',
    ...(this.isAccountingFirm() ? [] : ['products' as const]),
    ...(this.requiresAccounting() ? ['configuration' as const] : []),
    'review'
  ]);
  protected readonly stepNumber = computed(() => this.steps().indexOf(this.currentStep()) + 1);
  protected readonly reviewProducts = computed(() =>
    this.productOptions.filter((option) =>
      this.isAccountingFirm()
        ? option.code === 'ACCOUNTING'
        : this.selectedProducts().includes(option.code)
    )
  );
  protected stepLabelKey(step: OnboardingStep): string {
    return `IDENTITY.ONBOARDING.STEPS.${step.toUpperCase()}`;
  }
  protected countryLabelKey(): string {
    return (
      this.countryOptions.find((option) => option.value === this.form.controls.country.value)
        ?.labelKey ?? 'IDENTITY.ONBOARDING.FIELDS.COUNTRY'
    );
  }
  protected frameworkLabelKey(): string {
    return (
      this.frameworkOptions.find(
        (option) => option.value === this.form.controls.accountingFramework.value
      )?.labelKey ?? 'IDENTITY.ONBOARDING.FIELDS.ACCOUNTING_FRAMEWORK'
    );
  }

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
    organizationName: [
      '',
      [Validators.required, Validators.maxLength(160), Validators.pattern(/\S/)]
    ],
    country: ['BJ', [Validators.required]],
    accountingFramework: ['']
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
    if (this.submitting()) return;
    if (this.selectedIntent() !== intent) {
      this.selectedProducts.set([]);
      this.productsTouched.set(false);
      this.form.controls.accountingFramework.reset('');
    }

    this.selectedIntent.set(intent);
    this.form.controls.workspaceType.setValue(intent);
    this.form.controls.workspaceType.markAsTouched();
    this.intentTouched.set(true);
    this.syncAccountingValidation();
    this.onboardingErrorKey.set(null);
  }

  protected continueFromIntent(): void {
    this.intentTouched.set(true);

    if (!this.selectedIntent()) {
      this.focusInvalid();
      return;
    }

    this.moveTo('organization');
  }

  protected continueFromOrganization(): void {
    this.form.controls.organizationName.markAsTouched();
    this.form.controls.country.markAsTouched();

    if (this.form.controls.organizationName.invalid || this.form.controls.country.invalid) {
      this.focusInvalid();
      return;
    }

    this.moveTo(this.isAccountingFirm() ? 'configuration' : 'products');
  }

  protected toggleProduct(product: ProductCode): void {
    if (this.submitting()) return;
    const current = this.selectedProducts();
    this.selectedProducts.set(
      this.productOptions
        .filter((option) =>
          option.code === product ? !current.includes(product) : current.includes(option.code)
        )
        .map((option) => option.code)
    );
    this.productsTouched.set(true);
    this.syncAccountingValidation();
  }

  protected continueFromProducts(): void {
    this.productsTouched.set(true);
    if (!this.selectedProducts().length) {
      this.focusInvalid();
      return;
    }
    this.moveTo(this.requiresAccounting() ? 'configuration' : 'review');
  }

  protected continueFromConfiguration(): void {
    this.form.controls.accountingFramework.markAsTouched();
    if (this.form.controls.accountingFramework.invalid) {
      this.focusInvalid();
      return;
    }
    this.moveTo('review');
  }

  protected back(): void {
    if (this.submitting()) return;
    const steps = this.steps();
    this.moveTo(steps[Math.max(0, steps.indexOf(this.currentStep()) - 1)]);
  }

  private syncAccountingValidation(): void {
    const framework = this.form.controls.accountingFramework;
    if (this.requiresAccounting()) framework.setValidators(Validators.required);
    else {
      framework.clearValidators();
      framework.reset('');
    }
    framework.updateValueAndValidity();
  }

  private moveTo(step: OnboardingStep): void {
    this.onboardingErrorKey.set(null);
    this.currentStep.set(step);
    // Focus after Angular has rendered the next step; never steal focus during creation.
    setTimeout(() => this.stepHeading()?.nativeElement.focus());
  }

  private focusInvalid(): void {
    setTimeout(() =>
      this.element.nativeElement
        .querySelector<HTMLElement>(
          'input.ng-invalid, mat-select.ng-invalid, button[aria-describedby="products-error"], button[aria-describedby="intent-error"]'
        )
        ?.focus()
    );
  }

  protected async submitOnboarding(): Promise<void> {
    this.form.markAllAsTouched();
    this.onboardingErrorKey.set(null);

    if (this.form.invalid || this.submitting() || this.currentStep() !== 'review') {
      return;
    }

    if (!this.isAccountingFirm() && !this.selectedProducts().length) {
      this.moveTo('products');
      this.productsTouched.set(true);
      return;
    }
    const rawValue = this.form.getRawValue();
    const request = CreateInitialWorkspaceRequestSchema.safeParse({
      workspaceType: rawValue.workspaceType,
      organizationName: rawValue.organizationName,
      country: rawValue.country,
      ...(!this.isAccountingFirm() ? { products: [...this.selectedProducts()] } : {}),
      ...(this.requiresAccounting() ? { accountingFramework: rawValue.accountingFramework } : {})
    });
    if (!request.success) {
      this.onboardingErrorKey.set('IDENTITY.ONBOARDING.ERRORS.VALIDATION');
      return;
    }

    this.submitting.set(true);

    try {
      const result = await this.onboardingApi.createInitialWorkspace(request.data);
      const createdWorkspace: ActiveWorkspaceSummary = {
        ...result.workspace,
        cabinet: result.cabinet,
        organization: result.organization
      };
      this.authStore.setCreatedWorkspace(createdWorkspace, result.activeOrgId);
      const accessKey = productAccessQueryKeys.list(result.activeOrgId);
      if (result.productAccess) this.queryClient.setQueryData(accessKey, result.productAccess);
      else await this.queryClient.invalidateQueries({ queryKey: accessKey, exact: true });
      const activeProducts =
        result.productAccess
          ?.filter((access) => access.status === 'ACTIVE')
          .map((access) => access.productCode) ?? [];
      const destination =
        result.workspace.workspaceType === 'ACCOUNTING_FIRM'
          ? '/cabinet/dashboard'
          : activeProducts.length === 1 && activeProducts[0] === 'RESTAURANTS'
            ? '/restaurants'
            : activeProducts.length === 1 && activeProducts[0] === 'SALES'
              ? '/sales'
              : '/dashboard';
      await this.router.navigate([destination], { replaceUrl: true });
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
