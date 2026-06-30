import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  type AccountDto,
  type ThirdPartyLedgerDto,
  type ThirdPartyTypeValue
} from '@liass-ohada/shared/accounting';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { AccountingApi } from '../../data-access/accounting.api';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { AccountSearchSelectComponent } from '../../ui/account-search-select/account-search-select.component';
import { FiscalYearRequiredComponent } from '../../ui/fiscal-year-required/fiscal-year-required.component';
import {
  ThirdPartySelectComponent,
  type ThirdPartySelectedValue
} from '../../ui/third-party-search-select/third-party-search-select.component';

const AUXILIARY_LEDGER_PAGE_SIZE = 50;

type AuxiliaryLedgerMovement = ThirdPartyLedgerDto['movements'][number];

interface AuxiliaryLedgerScope {
  accountId: string;
  thirdPartyId: string;
  thirdPartyType: ThirdPartyTypeValue;
  startDate: string;
  endDate: string;
}

@Component({
  selector: 'liass-auxiliary-ledger-page',
  imports: [
    AccountSearchSelectComponent,
    FiscalYearRequiredComponent,
    LiassButtonComponent,
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    ThirdPartySelectComponent,
    TranslocoModule
  ],
  templateUrl: './auxiliary-ledger.page.html'
})
export class AuxiliaryLedgerPage {
  private readonly accountingApi = inject(AccountingApi);
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly formBuilder = inject(FormBuilder);
  protected readonly fiscalYearContext = inject(AccountingFiscalYearContextService);

  protected readonly selectedAccount = signal<AccountDto | null>(null);
  protected readonly selectedThirdParty = signal<ThirdPartySelectedValue | null>(null);
  protected readonly appliedScope = signal<AuxiliaryLedgerScope | null>(null);
  protected readonly extraMovements = signal<AuxiliaryLedgerMovement[]>([]);
  protected readonly paginationState = signal<{
    finalBalance?: number;
    hasMore?: boolean;
    nextCursor?: string;
  }>({});
  protected readonly loadingMore = signal(false);
  protected readonly loadMoreError = signal(false);
  private readonly formRevision = signal(0);

  protected readonly form = this.formBuilder.nonNullable.group({
    thirdPartyType: ['CUSTOMER' as ThirdPartyTypeValue, [Validators.required]],
    accountId: ['', [Validators.required, Validators.pattern(/^\d{2,8}$/)]],
    thirdPartyId: ['', [Validators.required]],
    startDate: [''],
    endDate: ['']
  });

  protected readonly activeFiscalYear = computed(() => this.fiscalYearContext.activeFiscalYear());
  protected readonly activeYear = computed(() => this.fiscalYearContext.activeYear());
  protected readonly selectedType = signal<ThirdPartyTypeValue>('CUSTOMER');
  protected readonly canLoad = computed(
    () => {
      this.formRevision();
      return (
        !!this.activeFiscalYear() &&
        this.form.valid &&
        !!this.form.controls.accountId.value &&
        !!this.form.controls.thirdPartyId.value
      );
    }
  );
  protected readonly hasAppliedScope = computed(() => !!this.appliedScope());

  protected readonly ledgerQuery = injectQuery(() => {
    const scope = this.appliedScope();
    const year = this.activeYear();

    return this.accountingQueries.thirdPartyLedger(
      {
        fiscalYear: year ? String(year) : '',
        accountId: scope?.accountId ?? '',
        thirdPartyId: scope?.thirdPartyId ?? '',
        thirdPartyType: scope?.thirdPartyType ?? this.selectedType(),
        startDate: scope?.startDate,
        endDate: scope?.endDate,
        limit: AUXILIARY_LEDGER_PAGE_SIZE
      },
      !!scope && !!year
    );
  });

  protected readonly ledger = computed(() => this.ledgerQuery.data());
  protected readonly movements = computed(() =>
    dedupeMovements([
      ...(this.ledger()?.movements ?? this.ledger()?.lines ?? []),
      ...this.extraMovements()
    ])
  );
  protected readonly showInitialLoading = computed(
    () => this.hasAppliedScope() && !this.ledger() && this.ledgerQuery.isPending()
  );
  protected readonly hasMore = computed(() => {
    const pagination = this.paginationState();
    return pagination.hasMore ?? this.ledger()?.hasMore ?? false;
  });
  protected readonly nextCursor = computed(() => {
    const pagination = this.paginationState();
    return pagination.nextCursor ?? this.ledger()?.nextCursor;
  });
  protected readonly finalBalance = computed(
    () => this.paginationState().finalBalance ?? this.ledger()?.finalBalance ?? 0
  );
  protected readonly ledgerErrorMessage = computed(() =>
    safeMessageFromError(this.ledgerQuery.error())
  );

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.formRevision.update((revision) => revision + 1);
      this.appliedScope.set(null);
      this.resetPagination();
    });

    this.form.controls.thirdPartyType.valueChanges.pipe(takeUntilDestroyed()).subscribe((type) => {
      this.selectedType.set(type);
      this.selectedAccount.set(null);
      this.selectedThirdParty.set(null);
      this.form.patchValue(
        {
          accountId: '',
          thirdPartyId: ''
        },
        { emitEvent: false }
      );
      this.appliedScope.set(null);
      this.resetPagination();
    });
  }

  protected updateSelectedAccount(accountId: string | null): void {
    this.form.controls.accountId.setValue(accountId ?? '');
    this.selectedAccount.set(null);
    this.appliedScope.set(null);
    this.resetPagination();
  }

  protected updateSelectedAccountDto(account: AccountDto | null): void {
    this.selectedAccount.set(account);
  }

  protected updateSelectedThirdParty(thirdPartyId: string | null): void {
    this.form.controls.thirdPartyId.setValue(thirdPartyId ?? '');
    if (!thirdPartyId) {
      this.selectedThirdParty.set(null);
    }
    this.appliedScope.set(null);
    this.resetPagination();
  }

  protected updateSelectedThirdPartyDto(thirdParty: ThirdPartySelectedValue | null): void {
    this.selectedThirdParty.set(thirdParty);
    if (thirdParty) {
      this.form.controls.thirdPartyId.setValue(thirdParty.thirdPartyId, { emitEvent: false });
      if (this.form.controls.thirdPartyType.value !== thirdParty.thirdPartyType) {
        this.form.controls.thirdPartyType.setValue(thirdParty.thirdPartyType);
      }
      this.selectedType.set(thirdParty.thirdPartyType);
      this.formRevision.update((revision) => revision + 1);
    }
  }

  protected loadLedger(): void {
    const fiscalYear = this.activeFiscalYear();

    if (!fiscalYear || !this.canLoad()) {
      this.form.markAllAsTouched();
      return;
    }

    this.appliedScope.set({
      accountId: this.form.controls.accountId.value,
      thirdPartyId: this.form.controls.thirdPartyId.value,
      thirdPartyType: this.form.controls.thirdPartyType.value,
      startDate: this.form.controls.startDate.value || fiscalYear.startDate,
      endDate: this.form.controls.endDate.value || fiscalYear.endDate
    });
    this.resetPagination();
  }

  protected async retryInitialLoad(): Promise<void> {
    this.resetPagination();
    await this.ledgerQuery.refetch();
  }

  protected async loadMore(): Promise<void> {
    const scope = this.appliedScope();
    const year = this.activeYear();
    const cursor = this.nextCursor();

    if (!scope || !year || !cursor || this.loadingMore()) {
      return;
    }

    this.loadingMore.set(true);
    this.loadMoreError.set(false);

    try {
      const result = await this.accountingApi.getThirdPartyLedger({
        ...scope,
        fiscalYear: String(year),
        cursor,
        limit: AUXILIARY_LEDGER_PAGE_SIZE
      });
      this.extraMovements.update((movements) =>
        dedupeMovements([...movements, ...(result.movements ?? result.lines ?? [])])
      );
      this.paginationState.set({
        finalBalance: result.finalBalance,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor
      });
    } catch {
      this.loadMoreError.set(true);
    } finally {
      this.loadingMore.set(false);
    }
  }

  protected formatAmount(amount: number): string {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.abs(amount));
  }

  protected formatSignedAmount(amount: number): string {
    return `${amount < 0 ? '-' : ''}${this.formatAmount(amount)}`;
  }

  protected balanceLabel(amount: number): string {
    if (amount > 0) {
      return 'ACCOUNTING.AUXILIARY_LEDGER.BALANCE.DEBIT';
    }

    if (amount < 0) {
      return 'ACCOUNTING.AUXILIARY_LEDGER.BALANCE.CREDIT';
    }

    return 'ACCOUNTING.AUXILIARY_LEDGER.BALANCE.ZERO';
  }

  protected letteringStatusKey(status: AuxiliaryLedgerMovement['letteringStatus']): string {
    return `ACCOUNTING.AUXILIARY_LEDGER.LETTERING_STATUS.${status ?? 'UNLETTERED'}`;
  }

  protected letteringStatusClass(status: AuxiliaryLedgerMovement['letteringStatus']): string {
    switch (status) {
      case 'LETTERED':
      case 'COMPLETE':
        return 'bg-success-50 text-success-700 dark:bg-emerald-950/35 dark:text-emerald-200';
      case 'PARTIAL':
        return 'bg-warning-50 text-warning-700 dark:bg-amber-950/35 dark:text-amber-200';
      default:
        return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
    }
  }

  protected selectedThirdPartyLabel(): string {
    const thirdParty = this.selectedThirdParty();
    if (!thirdParty) {
      return '';
    }

    return `${thirdParty.thirdPartyCode} — ${thirdParty.thirdPartyName}`;
  }

  private resetPagination(): void {
    this.extraMovements.set([]);
    this.paginationState.set({});
    this.loadMoreError.set(false);
  }
}

function dedupeMovements(movements: AuxiliaryLedgerMovement[]): AuxiliaryLedgerMovement[] {
  const byKey = new Map<string, AuxiliaryLedgerMovement>();

  for (const movement of movements) {
    byKey.set(
      movement.lineId || `${movement.entryId}:${movement.date}:${movement.reference ?? ''}`,
      movement
    );
  }

  return [...byKey.values()];
}
