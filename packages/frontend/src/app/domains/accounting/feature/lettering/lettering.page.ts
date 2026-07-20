import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  type AccountDto,
  type LetteringMatchDto,
  type ThirdPartyTypeValue,
  type UnletteredLineDto
} from '@liass-ohada/shared/accounting';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { NotificationService } from '../../../../core/notifications/notification.service';
import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { AccountingApi } from '../../data-access/accounting.api';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { AccountSearchSelectComponent } from '../../ui/account-search-select/account-search-select.component';
import { FiscalYearRequiredComponent } from '../../ui/fiscal-year-required/fiscal-year-required.component';
import {
  ThirdPartySelectComponent,
  type ThirdPartySelectedValue
} from '../../ui/third-party-search-select/third-party-search-select.component';

interface LetteringScope {
  accountId: string;
  thirdPartyId: string;
  thirdPartyType: ThirdPartyTypeValue;
  thirdPartyCode?: string;
  thirdPartyName?: string;
  dateFrom?: string;
  dateTo?: string;
  reference?: string;
  minRemaining?: number;
  maxRemaining?: number;
}

interface LetteringConfirmationDialogData {
  action: 'CREATE' | 'CANCEL';
  accountLabel?: string;
  thirdPartyLabel?: string;
  debitTotal?: number;
  creditTotal?: number;
  lineCount?: number;
  letteringId?: string;
}

interface LetteringSuggestion {
  id: string;
  tone: 'success' | 'info';
  labelKey: string;
  amount: number;
  debitLine: UnletteredLineDto;
  creditLine: UnletteredLineDto;
}

@Component({
  selector: 'liass-lettering-confirmation-dialog',
  imports: [LiassButtonComponent, MatDialogModule, MatIconModule, TranslocoModule],
  template: `
    <div class="space-y-5 p-6">
      <div class="flex items-start gap-3">
        <div class="rounded-full bg-brand-50 p-2 text-brand-700 dark:bg-brand-950/35 dark:text-brand-300">
          <mat-icon>{{ data.action === 'CREATE' ? 'done_all' : 'link_off' }}</mat-icon>
        </div>
        <div>
          <h2 class="text-lg font-semibold text-app-text">
            {{ (data.action === 'CREATE' ? 'ACCOUNTING.LETTERING.CONFIRM.CREATE_TITLE' : 'ACCOUNTING.LETTERING.CONFIRM.CANCEL_TITLE') | transloco }}
          </h2>
          <p class="mt-1 text-sm leading-6 text-app-muted">
            {{ (data.action === 'CREATE' ? 'ACCOUNTING.LETTERING.CONFIRM.CREATE_MESSAGE' : 'ACCOUNTING.LETTERING.CONFIRM.CANCEL_MESSAGE') | transloco }}
          </p>
        </div>
      </div>

      @if (data.action === 'CREATE') {
        <dl class="grid gap-3 rounded-app-card bg-app-surface-muted p-4 text-sm sm:grid-cols-2">
          <div class="sm:col-span-2">
            <dt class="text-app-muted">{{ 'ACCOUNTING.LETTERING.FIELDS.ACCOUNT' | transloco }}</dt>
            <dd class="mt-1 font-semibold text-app-text">{{ data.accountLabel }}</dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="text-app-muted">{{ 'ACCOUNTING.LETTERING.FIELDS.THIRD_PARTY' | transloco }}</dt>
            <dd class="mt-1 font-semibold text-app-text">{{ data.thirdPartyLabel }}</dd>
          </div>
          <div>
            <dt class="text-app-muted">{{ 'ACCOUNTING.LETTERING.METRICS.SELECTED_LINES' | transloco }}</dt>
            <dd class="mt-1 font-semibold text-app-text">{{ data.lineCount }}</dd>
          </div>
          <div>
            <dt class="text-app-muted">{{ 'ACCOUNTING.LETTERING.METRICS.SELECTED_DEBIT' | transloco }}</dt>
            <dd class="mt-1 font-semibold text-app-text">{{ data.debitTotal }}</dd>
          </div>
          <div>
            <dt class="text-app-muted">{{ 'ACCOUNTING.LETTERING.METRICS.SELECTED_CREDIT' | transloco }}</dt>
            <dd class="mt-1 font-semibold text-app-text">{{ data.creditTotal }}</dd>
          </div>
        </dl>
      } @else {
        <p class="rounded-app-card bg-warning-50 p-4 text-sm text-warning-700 dark:bg-amber-950/25 dark:text-amber-200">
          {{ 'ACCOUNTING.LETTERING.CONFIRM.CANCEL_WARNING' | transloco }}
        </p>
      }

      <div class="flex justify-end gap-3">
        <liass-button variant="ghost" tone="neutral" (pressed)="close(false)">
          {{ 'COMMON.ACTIONS.CANCEL' | transloco }}
        </liass-button>
        <liass-button
          variant="solid"
          [tone]="data.action === 'CREATE' ? 'brand' : 'warning'"
          [icon]="data.action === 'CREATE' ? 'done_all' : 'link_off'"
          (pressed)="close(true)"
        >
          {{ (data.action === 'CREATE' ? 'ACCOUNTING.LETTERING.ACTIONS.POST' : 'ACCOUNTING.LETTERING.ACTIONS.CANCEL_GROUP') | transloco }}
        </liass-button>
      </div>
    </div>
  `
})
export class LetteringConfirmationDialogComponent {
  protected readonly data = inject<LetteringConfirmationDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<LetteringConfirmationDialogComponent, boolean>>(
    MatDialogRef
  );

  protected close(confirmed: boolean): void {
    this.dialogRef.close(confirmed);
  }
}

@Component({
  selector: 'liass-lettering-page',
  imports: [
    AccountSearchSelectComponent,
    FiscalYearRequiredComponent,
    LiassButtonComponent,
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    LiassStatusChipComponent,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    ThirdPartySelectComponent,
    TranslocoModule
  ],
  templateUrl: './lettering.page.html'
})
export class LetteringPage {
  protected readonly authStore = inject(AuthStore);
  protected readonly canWriteAccounting = () => !this.authStore.isAccountingReadOnly?.();
  private readonly accountingApi = inject(AccountingApi);
  protected readonly fiscalYearContext = inject(AccountingFiscalYearContextService);
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly dialog = inject(MatDialog);
  private readonly formBuilder = inject(FormBuilder);
  private readonly notifications = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);
  private currentThirdPartyType: ThirdPartyTypeValue = 'CUSTOMER';

  protected readonly selectedLineKeys = signal(new Set<string>());
  protected readonly allocations = signal<Record<string, number>>({});
  protected readonly pendingAction = signal<'create' | 'cancel' | null>(null);
  protected readonly latestMatch = signal<LetteringMatchDto | null>(null);
  protected readonly pageErrorKey = signal<string | null>(null);
  protected readonly selectedAccount = signal<AccountDto | null>(null);
  protected readonly selectedThirdParty = signal<ThirdPartySelectedValue | null>(null);
  protected readonly hasAppliedScope = signal(false);
  protected readonly advancedFiltersOpen = signal(false);

  protected readonly scope = signal<LetteringScope>({
    accountId: '',
    thirdPartyId: '',
    thirdPartyType: 'CUSTOMER'
  });

  protected readonly form = this.formBuilder.nonNullable.group({
    accountId: ['', [Validators.required, Validators.pattern(/^\d{2,8}$/)]],
    thirdPartyId: ['', [Validators.required]],
    thirdPartyType: ['CUSTOMER' as ThirdPartyTypeValue, [Validators.required]],
    dateFrom: [''],
    dateTo: [''],
    reference: [''],
    minRemaining: [''],
    maxRemaining: ['']
  });

  protected readonly activeFiscalYear = computed(() => this.fiscalYearContext.activeFiscalYear());
  protected readonly activeYear = computed(() => this.fiscalYearContext.activeYear());
  protected readonly hasScope = computed(
    () =>
      this.hasAppliedScope() &&
      !!this.scope().accountId &&
      !!this.scope().thirdPartyId &&
      !!this.activeYear()
  );

  protected readonly candidatesQuery = injectQuery(() =>
    this.accountingQueries.letteringCandidates(
      {
        fiscalYear: this.activeYear() ?? 0,
        accountId: this.scope().accountId,
        thirdPartyId: this.scope().thirdPartyId,
        thirdPartyType: this.scope().thirdPartyType,
        dateFrom: this.scope().dateFrom,
        dateTo: this.scope().dateTo,
        limit: 100
      },
      this.hasScope()
    )
  );

  protected readonly candidates = computed(() => this.candidatesQuery.data()?.lines ?? []);
  protected readonly filteredCandidates = computed(() => {
    const scope = this.scope();
    return this.candidates().filter((line) => {
      if (scope.reference) {
        const haystack = `${line.reference ?? ''} ${line.label ?? ''}`.toLowerCase();
        if (!haystack.includes(scope.reference.toLowerCase())) {
          return false;
        }
      }
      if (scope.minRemaining !== undefined && line.remainingAmount < scope.minRemaining) {
        return false;
      }
      if (scope.maxRemaining !== undefined && line.remainingAmount > scope.maxRemaining) {
        return false;
      }
      return true;
    });
  });
  protected readonly selectedLines = computed(() => {
    const selectedKeys = this.selectedLineKeys();
    return this.filteredCandidates().filter((line) => selectedKeys.has(this.lineKey(line)));
  });
  protected readonly selectedDebitTotal = computed(() =>
    this.selectedLines().reduce(
      (total, line) => total + (line.debit > 0 ? this.allocationAmount(line) : 0),
      0
    )
  );
  protected readonly selectedCreditTotal = computed(() =>
    this.selectedLines().reduce(
      (total, line) => total + (line.credit > 0 ? this.allocationAmount(line) : 0),
      0
    )
  );
  protected readonly selectedDifference = computed(
    () => this.selectedDebitTotal() - this.selectedCreditTotal()
  );
  protected readonly hasDebitSelection = computed(() =>
    this.selectedLines().some((line) => line.debit > 0)
  );
  protected readonly hasCreditSelection = computed(() =>
    this.selectedLines().some((line) => line.credit > 0)
  );
  protected readonly hasInvalidAllocations = computed(() =>
    this.selectedLines().some((line) => !this.isAllocationValid(line))
  );
  protected readonly canCreateMatch = computed(
    () =>
      this.selectedLines().length >= 2 &&
      this.hasDebitSelection() &&
      this.hasCreditSelection() &&
      this.selectedDebitTotal() > 0 &&
      this.selectedDebitTotal() === this.selectedCreditTotal() &&
      !this.hasInvalidAllocations() &&
      !this.pendingAction()
  );
  protected readonly balanceStatusKey = computed(() =>
    this.canCreateMatch()
      ? 'ACCOUNTING.LETTERING.SUMMARY.BALANCED'
      : 'ACCOUNTING.LETTERING.SUMMARY.DIFFERENCE'
  );
  protected readonly balanceStatusTone = computed(() =>
    this.canCreateMatch() ? ('success' as const) : ('warning' as const)
  );
  protected readonly accountContextLabel = computed<string | null>(() => {
    const selectedAccount = this.selectedAccount();
    if (selectedAccount) {
      return `${selectedAccount.accountId} — ${selectedAccount.accountName}`;
    }

    return null;
  });
  protected readonly thirdPartyContextLabel = computed<string | null>(() => {
    const scope = this.scope();
    const name =
      scope.thirdPartyName ||
      this.selectedThirdParty()?.thirdPartyName;

    return name || null;
  });
  protected readonly suggestions = computed(() => buildSuggestions(this.filteredCandidates()));

  constructor() {
    this.form.controls.thirdPartyType.valueChanges.subscribe((type) => {
      if (type === this.currentThirdPartyType) {
        return;
      }
      this.currentThirdPartyType = type;
      this.form.controls.accountId.setValue('');
      this.form.controls.thirdPartyId.setValue('');
      this.selectedAccount.set(null);
      this.selectedThirdParty.set(null);
      this.clearSelection();
      this.hasAppliedScope.set(false);
      this.scope.update((scope) => ({
        ...scope,
        accountId: '',
        thirdPartyId: '',
        thirdPartyCode: undefined,
        thirdPartyName: undefined,
        thirdPartyType: type
      }));
    });
  }

  protected applyFilters(): void {
    if (!this.canLoadScope()) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    if (raw.dateFrom && raw.dateTo && raw.dateFrom > raw.dateTo) {
      this.pageErrorKey.set('ACCOUNTING.LETTERING.ERRORS.DATE_RANGE');
      return;
    }

    const minRemaining = parseOptionalAmount(raw.minRemaining);
    const maxRemaining = parseOptionalAmount(raw.maxRemaining);
    if (
      minRemaining !== undefined &&
      maxRemaining !== undefined &&
      minRemaining > maxRemaining
    ) {
      this.pageErrorKey.set('ACCOUNTING.LETTERING.ERRORS.AMOUNT_RANGE');
      return;
    }

    const selectedThirdParty = this.selectedThirdParty();
    this.scope.set({
      accountId: raw.accountId,
      thirdPartyId: raw.thirdPartyId.trim(),
      thirdPartyType: raw.thirdPartyType,
      thirdPartyCode: selectedThirdParty?.thirdPartyCode,
      thirdPartyName: selectedThirdParty?.thirdPartyName,
      dateFrom: raw.dateFrom || undefined,
      dateTo: raw.dateTo || undefined,
      reference: raw.reference.trim() || undefined,
      minRemaining,
      maxRemaining
    });
    this.hasAppliedScope.set(true);
    this.pageErrorKey.set(null);
    this.clearSelection();
  }

  protected toggleAdvancedFilters(): void {
    this.advancedFiltersOpen.update((isOpen) => !isOpen);
  }

  protected handleAccountSelected(account: AccountDto | null): void {
    this.selectedAccount.set(account);
  }

  protected handleThirdPartySelected(thirdParty: ThirdPartySelectedValue | null): void {
    this.selectedThirdParty.set(thirdParty);
  }

  protected canLoadScope(): boolean {
    return (
      !!this.activeYear() &&
      this.form.controls.thirdPartyType.valid &&
      this.form.controls.accountId.valid &&
      this.form.controls.thirdPartyId.valid &&
      !!this.selectedAccount() &&
      !!this.selectedThirdParty()
    );
  }

  protected toggleLine(line: UnletteredLineDto, checked: boolean): void {
    const key = this.lineKey(line);
    const nextKeys = new Set(this.selectedLineKeys());
    const nextAllocations = { ...this.allocations() };

    if (checked) {
      nextKeys.add(key);
      nextAllocations[key] = nextAllocations[key] ?? line.remainingAmount;
    } else {
      nextKeys.delete(key);
      delete nextAllocations[key];
    }

    this.selectedLineKeys.set(nextKeys);
    this.allocations.set(nextAllocations);
  }

  protected isSelected(line: UnletteredLineDto): boolean {
    return this.selectedLineKeys().has(this.lineKey(line));
  }

  protected updateAllocation(line: UnletteredLineDto, event: Event): void {
    const input = event.target as HTMLInputElement;
    const amount = Number(input.value);
    const key = this.lineKey(line);

    this.allocations.update((current) => ({
      ...current,
      [key]: amount
    }));
  }

  protected allocationAmount(line: UnletteredLineDto): number {
    return this.allocations()[this.lineKey(line)] ?? line.remainingAmount;
  }

  protected allocationErrorKey(line: UnletteredLineDto): string | null {
    if (!this.isSelected(line)) {
      return null;
    }
    const amount = this.allocationAmount(line);
    if (!Number.isFinite(amount) || amount <= 0) {
      return 'ACCOUNTING.LETTERING.ERRORS.ALLOCATION_POSITIVE';
    }
    if (amount > line.remainingAmount) {
      return 'ACCOUNTING.LETTERING.ERRORS.ALLOCATION_TOO_HIGH';
    }
    return null;
  }

  protected clearSelection(): void {
    this.selectedLineKeys.set(new Set());
    this.allocations.set({});
  }

  protected async confirmCreateMatch(): Promise<void> {
    if (!this.canCreateMatch() || !this.activeYear()) {
      this.pageErrorKey.set('ACCOUNTING.LETTERING.ERRORS.SELECTION_REQUIRED');
      return;
    }

    const confirmed = await firstValueFrom(
      this.dialog
        .open(LetteringConfirmationDialogComponent, {
          width: 'min(560px, 96vw)',
          disableClose: true,
          data: {
            action: 'CREATE',
            accountLabel: this.accountContextLabel() ?? this.scope().accountId,
            thirdPartyLabel: this.thirdPartyContextLabel() ?? '',
            debitTotal: this.selectedDebitTotal(),
            creditTotal: this.selectedCreditTotal(),
            lineCount: this.selectedLines().length
          } satisfies LetteringConfirmationDialogData
        })
        .afterClosed()
    );

    if (!confirmed) {
      return;
    }

    await this.createMatch();
  }

  protected async confirmCancelLatestMatch(): Promise<void> {
    const match = this.latestMatch();
    if (!match || this.pendingAction()) {
      return;
    }

    const confirmed = await firstValueFrom(
      this.dialog
        .open(LetteringConfirmationDialogComponent, {
          width: 'min(560px, 96vw)',
          disableClose: true,
          data: {
            action: 'CANCEL',
            letteringId: match.letteringId
          } satisfies LetteringConfirmationDialogData
        })
        .afterClosed()
    );

    if (!confirmed) {
      return;
    }

    await this.cancelMatch(match);
  }

  protected lineKey(line: UnletteredLineDto): string {
    return `${line.fiscalYear}:${line.entryId}:${line.lineId}`;
  }

  protected formatAmount(value: number): string {
    return new Intl.NumberFormat('fr-FR').format(Math.abs(value));
  }

  protected lineDisplayReference(line: UnletteredLineDto): string {
    return line.reference || line.entryNumber || '—';
  }

  protected lineDisplayDirectionKey(line: UnletteredLineDto): string {
    return line.debit > 0
      ? 'ACCOUNTING.LETTERING.LINE_TYPES.DEBIT'
      : 'ACCOUNTING.LETTERING.LINE_TYPES.CREDIT';
  }

  protected lineDisplayAmount(line: UnletteredLineDto): number {
    return this.allocationAmount(line);
  }

  protected signedDifference(): string {
    const difference = this.selectedDifference();
    if (difference === 0) {
      return this.formatAmount(0);
    }
    return `${difference > 0 ? '+' : '-'}${this.formatAmount(difference)}`;
  }

  protected statusTone(line: UnletteredLineDto): 'warning' | 'info' {
    return line.letteringStatus === 'PARTIAL' ? 'info' : 'warning';
  }

  protected applySuggestion(suggestion: LetteringSuggestion): void {
    const nextKeys = new Set(this.selectedLineKeys());
    const nextAllocations = { ...this.allocations() };
    nextKeys.add(this.lineKey(suggestion.debitLine));
    nextKeys.add(this.lineKey(suggestion.creditLine));
    nextAllocations[this.lineKey(suggestion.debitLine)] = suggestion.amount;
    nextAllocations[this.lineKey(suggestion.creditLine)] = suggestion.amount;
    this.selectedLineKeys.set(nextKeys);
    this.allocations.set(nextAllocations);
  }

  private async createMatch(): Promise<void> {
    const fiscalYear = this.activeYear();
    if (!fiscalYear) {
      return;
    }

    this.pendingAction.set('create');
    this.pageErrorKey.set(null);

    try {
      const result = await this.accountingApi.createLetteringMatch({
        fiscalYear,
        accountId: this.scope().accountId,
        thirdPartyId: this.scope().thirdPartyId,
        thirdPartyType: this.scope().thirdPartyType,
        allocations: this.selectedLines().map((line) => ({
          entryId: line.entryId,
          lineId: line.lineId,
          amount: this.allocationAmount(line)
        }))
      });
      this.latestMatch.set(result.data);
      this.clearSelection();
      this.notifications.success(
        result.message || this.transloco.translate('ACCOUNTING.LETTERING.MESSAGES.POSTED')
      );
      await this.candidatesQuery.refetch();
    } catch (error) {
      this.notifications.error(
        safeMessageFromError(error) ||
          this.transloco.translate('ACCOUNTING.LETTERING.ERRORS.POST_FAILED')
      );
    } finally {
      this.pendingAction.set(null);
    }
  }

  private async cancelMatch(match: LetteringMatchDto): Promise<void> {
    this.pendingAction.set('cancel');

    try {
      const result = await this.accountingApi.cancelLetteringMatch({
        fiscalYear: match.fiscalYear,
        letteringId: match.letteringId
      });
      this.latestMatch.set(result.data);
      this.notifications.success(
        result.message || this.transloco.translate('ACCOUNTING.LETTERING.MESSAGES.CANCELLED')
      );
      await this.candidatesQuery.refetch();
    } catch (error) {
      this.notifications.error(
        safeMessageFromError(error) ||
          this.transloco.translate('ACCOUNTING.LETTERING.ERRORS.CANCEL_FAILED')
      );
    } finally {
      this.pendingAction.set(null);
    }
  }

  private isAllocationValid(line: UnletteredLineDto): boolean {
    const amount = this.allocationAmount(line);
    return Number.isFinite(amount) && amount > 0 && amount <= line.remainingAmount;
  }
}

function parseOptionalAmount(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function buildSuggestions(lines: UnletteredLineDto[]): LetteringSuggestion[] {
  const debitLines = lines.filter((line) => line.debit > 0 && line.remainingAmount > 0);
  const creditLines = lines.filter((line) => line.credit > 0 && line.remainingAmount > 0);
  const suggestions: LetteringSuggestion[] = [];

  for (const debitLine of debitLines) {
    for (const creditLine of creditLines) {
      if (debitLine.remainingAmount === creditLine.remainingAmount) {
        suggestions.push({
          id: `exact:${debitLine.lineId}:${creditLine.lineId}`,
          tone: 'success',
          labelKey: 'ACCOUNTING.LETTERING.SUGGESTIONS.EXACT',
          amount: debitLine.remainingAmount,
          debitLine,
          creditLine
        });
      } else if (creditLine.remainingAmount < debitLine.remainingAmount) {
        suggestions.push({
          id: `partial:${debitLine.lineId}:${creditLine.lineId}`,
          tone: 'info',
          labelKey: 'ACCOUNTING.LETTERING.SUGGESTIONS.PARTIAL',
          amount: creditLine.remainingAmount,
          debitLine,
          creditLine
        });
      }
    }
  }

  return suggestions.slice(0, 6);
}
