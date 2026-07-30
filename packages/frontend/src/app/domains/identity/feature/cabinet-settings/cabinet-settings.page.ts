import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  HostListener,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  type ValidatorFn
} from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import type {
  ApplicationLanguage,
  CabinetSettings,
  OnboardingAccountingFramework,
  WorkspaceCountry
} from '@liass-ohada/shared/shared';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import {
  QueryClient,
  injectMutation,
  injectQuery
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { PendingChangesService } from '../../../../core/routing/pending-changes.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import {
  LiassConfirmationDialogComponent,
  type LiassConfirmationDialogData
} from '../../../../shared/ui/confirmation-dialog/confirmation-dialog.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSearchableSelectComponent } from '../../../../shared/ui/searchable-select/searchable-select.component';
import { AuthStore } from '../../data-access/auth.store';
import { CabinetDashboardQueries } from '../../data-access/cabinet-dashboard.queries';
import { CabinetSettingsApi } from '../../data-access/cabinet-settings.api';
import { CabinetSettingsQueries } from '../../data-access/cabinet-settings.queries';
import {
  accountingFrameworkOptions,
  applicationLanguageOptions,
  ohadaCountryOptions
} from '../../utils/workspace-presentation';
import {
  buildCabinetSettingsUpdate,
  cabinetSettingsErrorCode,
  cabinetSettingsFormValue,
  type CabinetSettingsFormValue
} from './cabinet-settings.presentation';

const websiteValidator: ValidatorFn = (control) => {
  const value = `${control.value ?? ''}`.trim();
  if (!value) return null;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:' ? null : { website: true };
  } catch {
    return { website: true };
  }
};

const noControlCharacters: ValidatorFn = (control) =>
  /[\u0000-\u001f\u007f]/.test(`${control.value ?? ''}`) ? { controlCharacters: true } : null;

type SettingsErrorKey =
  | 'IDENTITY.CABINET_SETTINGS.ERRORS.ADDRESS'
  | 'IDENTITY.CABINET_SETTINGS.ERRORS.CONTACT'
  | 'IDENTITY.CABINET_SETTINGS.ERRORS.COUNTRY'
  | 'IDENTITY.CABINET_SETTINGS.ERRORS.DATA_INCONSISTENT'
  | 'IDENTITY.CABINET_SETTINGS.ERRORS.DEFAULTS'
  | 'IDENTITY.CABINET_SETTINGS.ERRORS.GENERIC'
  | 'IDENTITY.CABINET_SETTINGS.ERRORS.LANGUAGE'
  | 'IDENTITY.CABINET_SETTINGS.ERRORS.NAME'
  | 'IDENTITY.CABINET_SETTINGS.ERRORS.VERSION_REQUIRED';

@Component({
  selector: 'liass-cabinet-settings-page',
  imports: [
    LiassButtonComponent,
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSearchableSelectComponent,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslocoModule
  ],
  templateUrl: './cabinet-settings.page.html'
})
export class CabinetSettingsPage {
  private readonly api = inject(CabinetSettingsApi);
  private readonly authStore = inject(AuthStore);
  private readonly dashboardQueries = inject(CabinetDashboardQueries);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  private readonly pendingChanges = inject(PendingChangesService);
  private readonly queryClient = inject(QueryClient);
  private readonly queries = inject(CabinetSettingsQueries);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  protected readonly countryOptions = ohadaCountryOptions;
  protected readonly frameworkOptions = accountingFrameworkOptions;
  protected readonly languageOptions = applicationLanguageOptions;
  protected readonly authoritative = signal<CabinetSettings | null>(null);
  protected readonly conflict = signal(false);
  protected readonly conflictExpanded = signal(true);
  protected readonly formErrorKey = signal<SettingsErrorKey | null>(null);
  private readonly accessRecoveryPending = signal(false);
  private readonly draftRevision = signal(0);

  protected readonly form = new FormGroup({
    organizationName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(160), noControlCharacters]
    }),
    country: new FormControl<WorkspaceCountry>('BJ', {
      nonNullable: true,
      validators: [Validators.required]
    }),
    contact: new FormGroup({
      email: new FormControl('', {
        nonNullable: true,
        validators: [Validators.email, Validators.maxLength(254)]
      }),
      phone: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(40)]
      }),
      website: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(2048), websiteValidator]
      })
    }),
    address: new FormGroup({
      line1: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
      line2: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
      city: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(120)] }),
      region: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(120)] }),
      postalCode: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(32)]
      })
    }),
    preferredLanguage: new FormControl<ApplicationLanguage>('fr', {
      nonNullable: true,
      validators: [Validators.required]
    }),
    defaults: new FormGroup({
      country: new FormControl<WorkspaceCountry | null>(null),
      accountingFramework: new FormControl<OnboardingAccountingFramework | null>(null)
    })
  });

  protected readonly settingsQuery = injectQuery(() => this.queries.detail());
  protected readonly updateMutation = injectMutation(() => ({
    mutationFn: (request: NonNullable<ReturnType<typeof buildCabinetSettingsUpdate>>) =>
      this.api.updateCabinetSettings(request)
  }));

  protected readonly pendingUpdate = computed(() => this.updateMutation.isPending());
  protected readonly loadErrorDescriptionKey = computed(() =>
    cabinetSettingsErrorCode(this.settingsQuery.error()) ===
    'CABINET_SETTINGS_DATA_INCONSISTENT'
      ? 'IDENTITY.CABINET_SETTINGS.ERRORS.DATA_INCONSISTENT'
      : 'IDENTITY.CABINET_SETTINGS.LOAD_ERROR.DESCRIPTION'
  );
  protected readonly updateRequest = computed(() => {
    this.draftRevision();
    const authoritative = this.authoritative();
    return authoritative
      ? buildCabinetSettingsUpdate(authoritative, this.form.getRawValue())
      : null;
  });
  protected readonly hasEffectiveChanges = computed(() => this.updateRequest() !== null);
  protected readonly canDiscard = computed(
    () => this.hasEffectiveChanges() && !this.pendingUpdate()
  );
  protected readonly canSave = computed(
    () =>
      this.hasEffectiveChanges() &&
      this.form.valid &&
      !this.pendingUpdate() &&
      !this.conflict()
  );

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.draftRevision.update((revision) => revision + 1));

    effect(() => {
      const data = this.settingsQuery.data();
      if (!data) return;

      const current = this.authoritative();
      if (!current || current.version === data.version) {
        if (!current) this.applyAuthoritative(data);
        return;
      }

      if (this.hasEffectiveChanges()) {
        this.conflict.set(true);
        this.conflictExpanded.set(true);
        return;
      }

      this.applyAuthoritative(data);
    });

    effect(() => {
      const code = cabinetSettingsErrorCode(this.settingsQuery.error());
      if (this.isAccessError(code)) {
        void this.recoverAccess();
      }
    });

    effect(() => this.pendingChanges.setPendingChanges(this.hasEffectiveChanges()));
    this.destroyRef.onDestroy(() => this.pendingChanges.setPendingChanges(false));
  }

  @HostListener('window:beforeunload', ['$event'])
  protected beforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasEffectiveChanges()) {
      event.preventDefault();
    }
  }

  protected async save(): Promise<void> {
    this.form.markAllAsTouched();
    this.clearServerErrors();
    const request = this.updateRequest();
    const previous = this.authoritative();

    if (!request || !previous || !this.canSave()) {
      return;
    }

    try {
      const response = await this.updateMutation.mutateAsync(request);
      this.queryClient.setQueryData(this.queries.detailKey(), response);
      this.applyAuthoritative(response);

      if (response.organizationName !== previous.organizationName || response.country !== previous.country) {
        await this.authStore.loadWorkspaces(true);
      }
      if (response.organizationName !== previous.organizationName) {
        await this.queryClient.invalidateQueries({ queryKey: this.dashboardQueries.all() });
      }

      this.notification.success(
        this.transloco.translate('IDENTITY.CABINET_SETTINGS.NOTIFICATIONS.SAVED')
      );
    } catch (error) {
      await this.handleUpdateError(error);
    }
  }

  protected discard(): void {
    const settings = this.authoritative();
    if (!settings || this.pendingUpdate()) return;
    this.applyAuthoritative(settings);
  }

  protected async retry(): Promise<void> {
    await this.settingsQuery.refetch();
  }

  protected keepDraft(): void {
    this.conflictExpanded.set(false);
  }

  protected async reloadLatest(): Promise<void> {
    const confirmed = await this.confirm({
      titleKey: 'IDENTITY.CABINET_SETTINGS.CONFLICT.RELOAD_TITLE',
      descriptionKey: 'IDENTITY.CABINET_SETTINGS.CONFLICT.RELOAD_DESCRIPTION',
      confirmKey: 'IDENTITY.CABINET_SETTINGS.ACTIONS.RELOAD',
      cancelKey: 'IDENTITY.CABINET_SETTINGS.CONFLICT.KEEP_DRAFT',
      tone: 'warning'
    });
    if (!confirmed) return;

    const result = await this.settingsQuery.refetch();
    if (result.data) {
      this.applyAuthoritative(result.data);
    }
  }

  private applyAuthoritative(settings: CabinetSettings): void {
    this.authoritative.set(settings);
    this.form.reset(cabinetSettingsFormValue(settings), { emitEvent: false });
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.conflict.set(false);
    this.conflictExpanded.set(true);
    this.formErrorKey.set(null);
    this.draftRevision.update((revision) => revision + 1);
  }

  private async handleUpdateError(error: unknown): Promise<void> {
    const code = cabinetSettingsErrorCode(error);
    if (code === 'CABINET_SETTINGS_UPDATE_CONFLICT') {
      this.conflict.set(true);
      this.conflictExpanded.set(true);
      return;
    }

    if (this.isAccessError(code)) {
      await this.recoverAccess();
      return;
    }

    const key = this.validationErrorKey(code);
    this.formErrorKey.set(key);
    this.applyFieldError(code);
    const safeMessage = safeMessageFromError(error);
    this.notification.error(safeMessage ?? this.transloco.translate(key));
  }

  private validationErrorKey(code: string | null): SettingsErrorKey {
    const keys: Record<string, SettingsErrorKey> = {
      CABINET_SETTINGS_ADDRESS_INVALID: 'IDENTITY.CABINET_SETTINGS.ERRORS.ADDRESS',
      CABINET_SETTINGS_CONTACT_INVALID: 'IDENTITY.CABINET_SETTINGS.ERRORS.CONTACT',
      CABINET_SETTINGS_COUNTRY_INVALID: 'IDENTITY.CABINET_SETTINGS.ERRORS.COUNTRY',
      CABINET_SETTINGS_DATA_INCONSISTENT:
        'IDENTITY.CABINET_SETTINGS.ERRORS.DATA_INCONSISTENT',
      CABINET_SETTINGS_DEFAULTS_INVALID: 'IDENTITY.CABINET_SETTINGS.ERRORS.DEFAULTS',
      CABINET_SETTINGS_LANGUAGE_INVALID: 'IDENTITY.CABINET_SETTINGS.ERRORS.LANGUAGE',
      CABINET_SETTINGS_ORGANIZATION_NAME_INVALID: 'IDENTITY.CABINET_SETTINGS.ERRORS.NAME',
      CABINET_SETTINGS_VERSION_REQUIRED:
        'IDENTITY.CABINET_SETTINGS.ERRORS.VERSION_REQUIRED'
    };
    return code ? (keys[code] ?? 'IDENTITY.CABINET_SETTINGS.ERRORS.GENERIC') : 'IDENTITY.CABINET_SETTINGS.ERRORS.GENERIC';
  }

  private applyFieldError(code: string | null): void {
    if (code === 'CABINET_SETTINGS_ORGANIZATION_NAME_INVALID') {
      this.form.controls.organizationName.setErrors({ server: true });
    } else if (code === 'CABINET_SETTINGS_COUNTRY_INVALID') {
      this.form.controls.country.setErrors({ server: true });
    } else if (code === 'CABINET_SETTINGS_LANGUAGE_INVALID') {
      this.form.controls.preferredLanguage.setErrors({ server: true });
    } else if (code === 'CABINET_SETTINGS_DEFAULTS_INVALID') {
      this.form.controls.defaults.setErrors({ server: true });
    } else if (code === 'CABINET_SETTINGS_CONTACT_INVALID') {
      this.form.controls.contact.setErrors({ server: true });
    } else if (code === 'CABINET_SETTINGS_ADDRESS_INVALID') {
      this.form.controls.address.setErrors({ server: true });
    }
  }

  private clearServerErrors(): void {
    this.formErrorKey.set(null);
    for (const control of [
      this.form.controls.organizationName,
      this.form.controls.country,
      this.form.controls.preferredLanguage,
      this.form.controls.contact,
      this.form.controls.address,
      this.form.controls.defaults
    ]) {
      const errors = control.errors;
      if (!errors?.['server']) continue;
      const { server: _server, ...remaining } = errors;
      control.setErrors(Object.keys(remaining).length > 0 ? remaining : null);
    }
  }

  private isAccessError(code: string | null): boolean {
    return (
      code === 'CABINET_SETTINGS_ACCESS_FORBIDDEN' ||
      code === 'CABINET_SETTINGS_CONTEXT_INVALID' ||
      code === 'CABINET_MEMBER_NOT_ACTIVE' ||
      code === 'CABINET_MEMBER_ACCESS_REVOKED' ||
      code === 'CABINET_MEMBER_ROLE_FORBIDDEN' ||
      code === 'CABINET_MEMBER_ROLE_REQUIRED' ||
      code === 'CABINET_WORKSPACE_REQUIRED' ||
      code === 'ERROR_ORG_ACCESS_DENIED'
    );
  }

  private async recoverAccess(): Promise<void> {
    if (this.accessRecoveryPending()) return;
    this.accessRecoveryPending.set(true);
    this.pendingChanges.setPendingChanges(false);
    this.queryClient.removeQueries({ queryKey: this.queries.all() });
    try {
      await this.authStore.loadWorkspaces(true);
    } finally {
      await this.router.navigate([
        this.authStore.activeWorkspaceType() === 'ACCOUNTING_FIRM'
          ? '/cabinet/dashboard'
          : '/dashboard'
      ]);
      this.accessRecoveryPending.set(false);
    }
  }

  private async confirm(data: LiassConfirmationDialogData): Promise<boolean> {
    const result = await firstValueFrom(
      this.dialog.open(LiassConfirmationDialogComponent, {
        autoFocus: 'dialog',
        data,
        disableClose: true,
        maxWidth: 'calc(100vw - 2rem)',
        restoreFocus: true,
        width: '30rem'
      }).afterClosed()
    );
    return result === true;
  }
}
