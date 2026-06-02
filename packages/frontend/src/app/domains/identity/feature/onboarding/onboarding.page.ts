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
import { AuthStore } from '../../data-access/auth.store';
import { OnboardingApi } from '../../data-access/onboarding.api';

type AccountingFramework = 'SYSCOHADA_REVISED' | 'SYCEBNL';
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
  protected readonly createErrorVisible = signal(false);
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
    this.createErrorVisible.set(false);
  }

  protected continueToDetails(): void {
    this.form.controls.workspaceType.markAsTouched();

    if (this.form.controls.workspaceType.invalid) {
      return;
    }

    this.currentStep.set('organizationDetails');
  }

  protected backToWorkspaceType(): void {
    this.createErrorVisible.set(false);
    this.currentStep.set('workspaceType');
  }

  protected async submitOnboarding(): Promise<void> {
    this.form.markAllAsTouched();
    this.createErrorVisible.set(false);

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
      this.authStore.setCreatedWorkspace(result.workspace, result.activeOrgId);
      await this.router.navigate(['/dashboard'], { replaceUrl: true });
    } catch {
      this.createErrorVisible.set(true);
    } finally {
      this.submitting.set(false);
    }
  }
}
