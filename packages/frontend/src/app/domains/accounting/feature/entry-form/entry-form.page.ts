import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
  type FormGroup
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router } from '@angular/router';
import {
  type AccountDto,
  type CreateEntryDraftRequest,
  type EntryDetailDto,
  type ThirdPartyTypeValue
} from '@liass-ohada/shared/accounting';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import {
  LiassSearchableSelectComponent,
  type LiassSearchableSelectOption
} from '../../../../shared/ui/searchable-select/searchable-select.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AccountingApi } from '../../data-access/accounting.api';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { AccountSearchSelectComponent } from '../../ui/account-search-select/account-search-select.component';
import { FiscalYearRequiredComponent } from '../../ui/fiscal-year-required/fiscal-year-required.component';
import {
  ThirdPartySelectComponent,
  type ThirdPartySelectedValue
} from '../../ui/third-party-search-select/third-party-search-select.component';

type EntryLineForm = FormGroup<{
  accountId: FormControl<string>;
  credit: FormControl<number>;
  debit: FormControl<number>;
  label: FormControl<string>;
  lineId: FormControl<string>;
  thirdPartyId: FormControl<string>;
  thirdPartyType: FormControl<ThirdPartyTypeValue | ''>;
}>;

@Component({
  selector: 'liass-entry-form-page',
  host: {
    class: 'block'
  },
  imports: [
    FiscalYearRequiredComponent,
    AccountSearchSelectComponent,
    LiassButtonComponent,
    LiassCardComponent,
    LiassSearchableSelectComponent,
    LiassSkeletonComponent,
    LiassStatusChipComponent,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    ThirdPartySelectComponent,
    TranslocoModule
  ],
  templateUrl: './entry-form.page.html'
})
export class EntryFormPage {
  private readonly accountingApi = inject(AccountingApi);
  private readonly accountingQueries = inject(AccountingQueries);
  protected readonly fiscalYearContext = inject(AccountingFiscalYearContextService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly notification = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  protected readonly entryId = this.route.snapshot.paramMap.get('entryId');
  protected readonly isEditMode = !!this.entryId;
  protected readonly activeFiscalYear = computed(() => this.fiscalYearContext.activeFiscalYear());
  protected readonly pageTitleKey = this.isEditMode
    ? 'ACCOUNTING.ENTRIES.FORM.EDIT_TITLE'
    : 'ACCOUNTING.ENTRIES.FORM.NEW_TITLE';
  protected readonly pageSubtitleKey = this.isEditMode
    ? 'ACCOUNTING.ENTRIES.FORM.EDIT_SUBTITLE'
    : 'ACCOUNTING.ENTRIES.FORM.NEW_SUBTITLE';

  protected readonly form = this.formBuilder.nonNullable.group({
    entryDate: [this.initialEntryDate(), [Validators.required]],
    journalCode: ['', [Validators.required]],
    voucherNumber: [''],
    label: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]],
    lines: this.formBuilder.array<EntryLineForm>(
      [this.createLine(), this.createLine()],
      [Validators.minLength(2)]
    )
  });
  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue()
  });

  protected readonly journalsQuery = injectQuery(() => ({
    ...this.accountingQueries.listJournals(),
    enabled: this.fiscalYearContext.hasActiveFiscalYear()
  }));
  protected readonly entryQuery = injectQuery(() =>
    this.accountingQueries.entryDetail(
      this.entryId ?? '',
      this.fiscalYearContext.activeYear(),
      this.isEditMode && this.fiscalYearContext.hasActiveFiscalYear()
    )
  );

  protected readonly journals = computed(() => {
    const activeYear = this.fiscalYearContext.activeYear();

    return (this.journalsQuery.data() ?? []).filter((journal) => journal.year === activeYear);
  });
  protected readonly journalOptions = computed<LiassSearchableSelectOption[]>(() =>
    this.journals().map((journal) => ({
      label: `${journal.journalCode} - ${journal.journalName}`,
      value: journal.journalCode
    }))
  );
  protected readonly useSearchableJournalSelect = computed(() => this.journals().length > 10);
  protected readonly minEntryDate = computed(() => this.activeFiscalYear()?.startDate ?? null);
  protected readonly maxEntryDate = computed(() => this.activeFiscalYear()?.endDate ?? null);
  protected readonly totalDebit = computed(() =>
    this.sumLineAmounts(this.formValue().lines ?? [], 'debit')
  );
  protected readonly totalCredit = computed(() =>
    this.sumLineAmounts(this.formValue().lines ?? [], 'credit')
  );
  protected readonly difference = computed(() => this.totalDebit() - this.totalCredit());
  protected readonly isBalanced = computed(
    () =>
      this.lines.length >= 2 &&
      this.totalDebit() > 0 &&
      this.totalDebit() === this.totalCredit() &&
      this.lines.valid
  );
  protected readonly formValid = computed(() => {
    this.formValue();
    return this.form.valid;
  });
  protected readonly publishAvailable = computed(
    () =>
      this.fiscalYearContext.hasActiveFiscalYear() &&
      this.formValid() &&
      this.isBalanced() &&
      !this.submittingDraft() &&
      !this.submittingPost()
  );
  protected readonly submittingDraft = signal(false);
  protected readonly submittingPost = signal(false);
  private readonly selectedLineAccounts = signal<ReadonlyMap<EntryLineForm, AccountDto>>(new Map());
  private readonly accountHydrationCache = new Map<string, Promise<AccountDto>>();

  constructor() {
    effect(() => {
      const fiscalYear = this.activeFiscalYear();

      if (!fiscalYear || this.isEditMode) {
        return;
      }

      const entryDate = this.form.controls.entryDate.value;
      if (entryDate < fiscalYear.startDate || entryDate > fiscalYear.endDate) {
        this.form.controls.entryDate.setValue(fiscalYear.startDate);
      }
    });

    effect(() => {
      const entry = this.entryQuery.data();

      if (!entry || entry.status !== 'DRAFT') {
        return;
      }

      this.form.patchValue({
        entryDate: entry.entryDate,
        journalCode: entry.journalCode,
        voucherNumber: entry.voucherNumber ?? '',
        label: entry.label ?? ''
      });
      this.lines.clear();
      for (const line of entry.lines) {
        this.lines.push(
          this.createLine({
            accountId: line.accountId,
            credit: line.credit,
            debit: line.debit,
            label: line.label ?? line.description ?? '',
            lineId: line.lineId,
            thirdPartyId: line.thirdPartyId ?? '',
            thirdPartyType: line.thirdPartyType ?? ''
          })
        );
        const createdLine = this.lines.at(this.lines.length - 1);
        void this.hydrateLineAccount(createdLine);
      }

      while (this.lines.length < 2) {
        this.lines.push(this.createLine());
      }
    });
  }

  protected get lines(): FormArray<EntryLineForm> {
    return this.form.controls.lines;
  }

  protected addLine(): void {
    this.lines.push(this.createLine());
  }

  protected removeLine(index: number): void {
    if (this.lines.length <= 2) {
      return;
    }

    const line = this.lines.at(index);
    this.lines.removeAt(index);
    this.selectedLineAccounts.update((accounts) => {
      const next = new Map(accounts);
      next.delete(line);
      return next;
    });
    this.lines.markAsDirty();
  }

  protected lineHasAmountConflict(line: EntryLineForm): boolean {
    return line.hasError('bothDebitAndCredit');
  }

  protected lineHasNoAmount(line: EntryLineForm): boolean {
    return line.hasError('amountRequired');
  }

  protected handleAmountInput(
    line: EntryLineForm,
    side: 'credit' | 'debit',
    event: Event
  ): void {
    const amount = Number((event.target as HTMLInputElement).value || 0);

    if (amount <= 0) {
      return;
    }

    const oppositeSide = side === 'debit' ? 'credit' : 'debit';
    const oppositeControl = line.controls[oppositeSide];

    if (oppositeControl.value !== 0) {
      oppositeControl.setValue(0);
      oppositeControl.markAsDirty();
    }
  }

  protected formatAmount(amount: number): string {
    return new Intl.NumberFormat('fr-FR', {
      maximumFractionDigits: 0
    }).format(amount);
  }

  protected handleLineAccountSelected(line: EntryLineForm, account: AccountDto | null): void {
    this.applyLineAccount(line, account, { markRequiredAsTouched: true });
  }

  protected handleLineThirdPartySelected(
    line: EntryLineForm,
    thirdParty: ThirdPartySelectedValue | null
  ): void {
    if (!thirdParty) {
      line.controls.thirdPartyType.setValue('', { emitEvent: false });
      return;
    }

    line.controls.thirdPartyType.setValue(thirdParty.thirdPartyType, { emitEvent: false });
    line.controls.thirdPartyId.setValue(thirdParty.thirdPartyId);
    line.controls.thirdPartyId.markAsDirty();
  }

  protected lineRequiresThirdParty(line: EntryLineForm): boolean {
    const account = this.selectedLineAccounts().get(line);
    return accountRequiresThirdParty(account);
  }

  protected lineThirdPartySelectorType(line: EntryLineForm): ThirdPartyTypeValue | null {
    return concreteThirdPartyType(this.selectedLineAccounts().get(line));
  }

  protected lineThirdPartyUnsupported(line: EntryLineForm): boolean {
    const account = this.selectedLineAccounts().get(line);
    return accountRequiresThirdParty(account) && !concreteThirdPartyType(account);
  }

  protected draftModel(): CreateEntryDraftRequest {
    const raw = this.form.getRawValue();
    const activeYear = this.fiscalYearContext.activeYear();

    if (!activeYear) {
      throw new Error('Active fiscal year is required to build a draft payload.');
    }

    return {
      year: activeYear,
      entryDate: raw.entryDate,
      journalCode: raw.journalCode,
      ...(raw.voucherNumber ? { voucherNumber: raw.voucherNumber } : {}),
      entryType: 'STANDARD' as const,
      label: raw.label,
      lines: raw.lines.map((line, index) => {
        const lineForm = this.lines.at(index);
        const thirdPartyType = this.lineThirdPartySelectorType(lineForm);
        const includeThirdParty =
          this.lineRequiresThirdParty(lineForm) && thirdPartyType && line.thirdPartyId;

        return {
          ...(line.lineId ? { lineId: line.lineId } : {}),
          accountId: line.accountId,
          ...(includeThirdParty
            ? { thirdPartyId: line.thirdPartyId, thirdPartyType }
            : {}),
          ...(line.label ? { label: line.label } : {}),
          debit: Number(line.debit),
          credit: Number(line.credit)
        };
      })
    };
  }

  protected async saveDraft(): Promise<void> {
    if (
      !this.fiscalYearContext.hasActiveFiscalYear() ||
      this.form.invalid ||
      this.submittingDraft()
    ) {
      this.form.markAllAsTouched();
      return;
    }

    this.submittingDraft.set(true);

    try {
      const result = await this.persistDraft();
      const fallbackKey =
        this.isEditMode
          ? 'ACCOUNTING.ENTRIES.FORM.NOTIFICATIONS.UPDATED'
          : 'ACCOUNTING.ENTRIES.FORM.NOTIFICATIONS.CREATED';

      this.notification.success(result.message ?? this.transloco.translate(fallbackKey));
      this.form.markAsPristine();
      await this.invalidateEntryLists();

      if (!this.isEditMode) {
        await this.router.navigate(
          ['/accounting/entries', result.data.entryId, 'edit'],
          { replaceUrl: true }
        );
      }
    } catch (error) {
      const fallbackKey =
        this.isEditMode
          ? 'ACCOUNTING.ENTRIES.FORM.ERRORS.UPDATE_FAILED'
          : 'ACCOUNTING.ENTRIES.FORM.ERRORS.CREATE_FAILED';

      this.notification.error(
        safeMessageFromError(error) ?? this.transloco.translate(fallbackKey)
      );
    } finally {
      this.submittingDraft.set(false);
    }
  }

  protected async publishEntry(): Promise<void> {
    const activeYear = this.fiscalYearContext.activeYear();

    if (!this.publishAvailable() || !activeYear) {
      this.form.markAllAsTouched();
      if (!activeYear) {
        this.notification.error(
          this.transloco.translate('ACCOUNTING.ENTRIES.NOTIFICATIONS.FISCAL_YEAR_REQUIRED')
        );
      }
      return;
    }

    this.submittingPost.set(true);

    try {
      const draft = await this.persistDraft();
      const result = await this.accountingApi.postEntryDraft(
        draft.data.entryId,
        activeYear
      );

      this.notification.success(
        result.message ?? this.transloco.translate('ACCOUNTING.ENTRIES.NOTIFICATIONS.POSTED')
      );
      this.form.markAsPristine();
      await this.invalidateEntryLists();
      await this.router.navigate(['/accounting/entries']);
    } catch (error) {
      this.notification.error(
        safeMessageFromError(error) ??
          this.transloco.translate('ACCOUNTING.ENTRIES.NOTIFICATIONS.POST_FAILED')
      );
    } finally {
      this.submittingPost.set(false);
    }
  }

  protected async goBack(): Promise<void> {
    await this.router.navigate(['/accounting/entries']);
  }

  private async persistDraft(): Promise<{ data: EntryDetailDto; message?: string | null }> {
    const payload = this.draftModel();

    return this.isEditMode && this.entryId
      ? this.accountingApi.updateEntryDraft(this.entryId, payload)
      : this.accountingApi.createEntryDraft(payload);
  }

  private async invalidateEntryLists(): Promise<void> {
    await this.queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;

        return (
          key[0] === 'accounting' &&
          key[1] === this.accountingQueries.tenantScope() &&
          key[2] === 'entries' &&
          typeof key[3] === 'object'
        );
      }
    });
  }

  private initialEntryDate(): string {
    const fiscalYear = this.fiscalYearContext.activeFiscalYear();
    const today = new Date().toISOString().slice(0, 10);

    if (!fiscalYear) {
      return today;
    }

    if (today < fiscalYear.startDate || today > fiscalYear.endDate) {
      return fiscalYear.startDate;
    }

    return today;
  }

  private createLine(
    value: Partial<{
      accountId: string;
      credit: number;
      debit: number;
      label: string;
      lineId: string;
      thirdPartyId: string;
      thirdPartyType: ThirdPartyTypeValue | '';
    }> = {}
  ): EntryLineForm {
    return this.formBuilder.nonNullable.group(
      {
        lineId: [value.lineId ?? ''],
        accountId: [
          value.accountId ?? '',
          [Validators.required, Validators.pattern(/^\d{8}$/)]
        ],
        label: [value.label ?? '', [Validators.maxLength(255)]],
        thirdPartyId: [value.thirdPartyId ?? ''],
        thirdPartyType: [value.thirdPartyType ?? ''],
        debit: [
          value.debit ?? 0,
          [Validators.required, Validators.min(0), Validators.pattern(/^\d+$/)]
        ],
        credit: [
          value.credit ?? 0,
          [Validators.required, Validators.min(0), Validators.pattern(/^\d+$/)]
        ]
      },
      { validators: [entryLineAmountValidator()] }
    ) as EntryLineForm;
  }

  private async hydrateLineAccount(line: EntryLineForm): Promise<void> {
    const accountId = line.controls.accountId.value;

    if (!accountId) {
      return;
    }

    try {
      const account = await this.getAccountMetadata(accountId);
      if (line.controls.accountId.value === account.accountId) {
        this.applyLineAccount(line, account, { markRequiredAsTouched: false });
      }
    } catch {
      this.applyLineAccount(line, null, { markRequiredAsTouched: false });
    }
  }

  private getAccountMetadata(accountId: string): Promise<AccountDto> {
    const cached = this.accountHydrationCache.get(accountId);

    if (cached) {
      return cached;
    }

    const request = this.accountingApi.getAccount(accountId);
    this.accountHydrationCache.set(accountId, request);
    return request;
  }

  private applyLineAccount(
    line: EntryLineForm,
    account: AccountDto | null,
    options: { markRequiredAsTouched: boolean }
  ): void {
    const previousType = line.controls.thirdPartyType.value;
    const nextType = concreteThirdPartyType(account);
    const requiresThirdParty = accountRequiresThirdParty(account);

    this.selectedLineAccounts.update((accounts) => {
      const next = new Map(accounts);
      if (account) {
        next.set(line, account);
      } else {
        next.delete(line);
      }
      return next;
    });

    if (!requiresThirdParty || !nextType || (previousType && previousType !== nextType)) {
      this.clearLineThirdParty(line);
    } else if (!previousType && line.controls.thirdPartyId.value) {
      line.controls.thirdPartyType.setValue(nextType, { emitEvent: false });
    }

    if (requiresThirdParty) {
      line.controls.thirdPartyId.setValidators([Validators.required]);
      if (options.markRequiredAsTouched && !line.controls.thirdPartyId.value) {
        line.controls.thirdPartyId.markAsTouched();
      }
    } else {
      line.controls.thirdPartyId.clearValidators();
    }

    line.controls.thirdPartyId.updateValueAndValidity();
    line.updateValueAndValidity();
  }

  private clearLineThirdParty(line: EntryLineForm): void {
    if (line.controls.thirdPartyId.value) {
      line.controls.thirdPartyId.setValue('');
    }
    if (line.controls.thirdPartyType.value) {
      line.controls.thirdPartyType.setValue('', { emitEvent: false });
    }
  }

  private sumLineAmounts(
    lines: readonly Partial<{ credit: number; debit: number }>[],
    side: 'credit' | 'debit'
  ): number {
    return lines.reduce((total, line) => total + Number(line[side] || 0), 0);
  }
}

function accountRequiresThirdParty(account: AccountDto | null | undefined): boolean {
  return (
    account?.requiresThirdParty === true &&
    (account.auxiliaryType === 'CUSTOMER' ||
      account.auxiliaryType === 'SUPPLIER' ||
      account.auxiliaryType === 'THIRD_PARTY')
  );
}

function concreteThirdPartyType(account: AccountDto | null | undefined): ThirdPartyTypeValue | null {
  return account?.auxiliaryType === 'CUSTOMER' || account?.auxiliaryType === 'SUPPLIER'
    ? account.auxiliaryType
    : null;
}

function entryLineAmountValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const debit = Number(control.get('debit')?.value || 0);
    const credit = Number(control.get('credit')?.value || 0);

    if (debit > 0 && credit > 0) {
      return { bothDebitAndCredit: true };
    }

    if (debit === 0 && credit === 0) {
      return { amountRequired: true };
    }

    return null;
  };
}
