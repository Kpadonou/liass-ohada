import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import {
  type AccountDto,
  type ThirdPartyBalanceDto,
  type ThirdPartyBalanceLineDto,
  type ThirdPartyStatusValue,
  type ThirdPartyTypeValue
} from '@liass-ohada/shared/accounting';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { AccountingApi, type ThirdPartyBalanceParams } from '../../data-access/accounting.api';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { AccountSearchSelectComponent } from '../../ui/account-search-select/account-search-select.component';
import { FiscalYearRequiredComponent } from '../../ui/fiscal-year-required/fiscal-year-required.component';

const AUXILIARY_BALANCE_PAGE_SIZE = 100;

type AuxiliaryBalanceStatusFilter = ThirdPartyStatusValue | 'ALL';

interface AuxiliaryBalanceScope {
  accountId: string;
  thirdPartyType: ThirdPartyTypeValue;
  status?: ThirdPartyStatusValue;
  startDate: string;
  endDate: string;
}

@Component({
  selector: 'liass-auxiliary-balance-page',
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
    MatMenuModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslocoModule
  ],
  templateUrl: './auxiliary-balance.page.html'
})
export class AuxiliaryBalancePage {
  private readonly accountingApi = inject(AccountingApi);
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);
  protected readonly fiscalYearContext = inject(AccountingFiscalYearContextService);

  protected readonly selectedAccount = signal<AccountDto | null>(null);
  protected readonly selectedType = signal<ThirdPartyTypeValue>('CUSTOMER');
  protected readonly appliedScope = signal<AuxiliaryBalanceScope | null>(null);
  protected readonly extraRows = signal<ThirdPartyBalanceLineDto[]>([]);
  protected readonly paginationState = signal<{ hasMore?: boolean; nextCursor?: string }>({});
  protected readonly loadingMore = signal(false);
  protected readonly loadMoreError = signal(false);
  private readonly formRevision = signal(0);

  protected readonly form = this.formBuilder.nonNullable.group({
    thirdPartyType: ['CUSTOMER' as ThirdPartyTypeValue, [Validators.required]],
    accountId: ['', [Validators.required, Validators.pattern(/^\d{2,8}$/)]],
    status: ['ACTIVE' as AuxiliaryBalanceStatusFilter, [Validators.required]],
    startDate: [''],
    endDate: ['']
  });

  protected readonly activeFiscalYear = computed(() => this.fiscalYearContext.activeFiscalYear());
  protected readonly activeYear = computed(() => this.fiscalYearContext.activeYear());
  protected readonly selectedTypeLabelKey = computed(
    () => `ACCOUNTING.AUXILIARY_BALANCE.TYPES.${this.selectedType()}`
  );
  protected readonly selectedStatusLabelKey = computed(
    () => `ACCOUNTING.AUXILIARY_BALANCE.STATUS.${this.form.controls.status.value}`
  );
  protected readonly canLoad = computed(() => {
    this.formRevision();
    return !!this.activeFiscalYear() && this.form.valid && !!this.form.controls.accountId.value;
  });
  protected readonly hasAppliedScope = computed(() => !!this.appliedScope());

  protected readonly balanceQuery = injectQuery(() => {
    const scope = this.appliedScope();
    const year = this.activeYear();

    return this.accountingQueries.thirdPartyBalance(
      {
        fiscalYear: year ? String(year) : '',
        accountId: scope?.accountId ?? '',
        thirdPartyType: scope?.thirdPartyType ?? this.selectedType(),
        ...(scope?.status ? { status: scope.status } : {}),
        startDate: scope?.startDate,
        endDate: scope?.endDate,
        limit: AUXILIARY_BALANCE_PAGE_SIZE
      },
      !!scope && !!year
    );
  });

  protected readonly report = computed(() => this.balanceQuery.data());
  protected readonly rows = computed(() =>
    dedupeRows([...(this.report()?.rows ?? []), ...this.extraRows()])
  );
  protected readonly showInitialLoading = computed(
    () => this.hasAppliedScope() && !this.report() && this.balanceQuery.isPending()
  );
  protected readonly hasMore = computed(() => {
    const pagination = this.paginationState();
    return pagination.hasMore ?? this.report()?.hasMore ?? false;
  });
  protected readonly nextCursor = computed(() => {
    const pagination = this.paginationState();
    return pagination.nextCursor ?? this.report()?.nextCursor;
  });
  protected readonly errorMessage = computed(() => safeMessageFromError(this.balanceQuery.error()));

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.formRevision.update((revision) => revision + 1);
      this.appliedScope.set(null);
      this.resetPagination();
    });

    this.form.controls.thirdPartyType.valueChanges.pipe(takeUntilDestroyed()).subscribe((type) => {
      this.selectedType.set(type);
      this.selectedAccount.set(null);
      this.form.controls.accountId.setValue('', { emitEvent: false });
      this.appliedScope.set(null);
      this.resetPagination();
    });

    effect(() => {
      const fiscalYear = this.activeFiscalYear();
      if (!fiscalYear) {
        return;
      }

      const current = this.form.getRawValue();
      if (current.startDate === fiscalYear.startDate && current.endDate === fiscalYear.endDate) {
        return;
      }

      this.form.patchValue({
        startDate: fiscalYear.startDate,
        endDate: fiscalYear.endDate
      });
    });
  }

  protected updateSelectedAccountDto(account: AccountDto | null): void {
    this.selectedAccount.set(account);
  }

  protected loadBalance(): void {
    const fiscalYear = this.activeFiscalYear();

    if (!fiscalYear || !this.canLoad()) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    this.appliedScope.set({
      accountId: raw.accountId,
      thirdPartyType: raw.thirdPartyType,
      ...(raw.status !== 'ALL' ? { status: raw.status } : {}),
      startDate: raw.startDate || fiscalYear.startDate,
      endDate: raw.endDate || fiscalYear.endDate
    });
    this.resetPagination();
  }

  protected async retryInitialLoad(): Promise<void> {
    this.resetPagination();
    await this.balanceQuery.refetch();
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
      const result = await this.accountingApi.getThirdPartyBalance({
        ...scope,
        fiscalYear: String(year),
        cursor,
        limit: AUXILIARY_BALANCE_PAGE_SIZE
      });
      this.extraRows.update((rows) => dedupeRows([...rows, ...result.rows]));
      this.paginationState.set({
        hasMore: result.hasMore,
        nextCursor: result.nextCursor
      });
    } catch {
      this.loadMoreError.set(true);
    } finally {
      this.loadingMore.set(false);
    }
  }

  protected viewAuxiliaryLedger(row: ThirdPartyBalanceLineDto): void {
    const scope = this.appliedScope();
    const report = this.report();
    const year = this.activeYear();

    void this.router.navigate(['/accounting/auxiliary-ledger'], {
      queryParams: {
        accountId: row.accountId,
        account: row.accountCode,
        thirdPartyId: row.thirdPartyId,
        thirdPartyType: row.thirdPartyType,
        year: year ? String(year) : report?.period.fiscalYear,
        startDate: scope?.startDate ?? report?.period.startDate,
        endDate: scope?.endDate ?? report?.period.endDate
      }
    });
  }

  protected formatAmount(amount: number | undefined, explicitZero = false): string {
    const value = amount ?? 0;
    if (value === 0 && !explicitZero) {
      return '-';
    }

    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value);
  }

  protected accountLabel(report: ThirdPartyBalanceDto): string {
    return `${report.accountId} — ${report.account.accountName}`;
  }

  protected typeLabelKey(report: ThirdPartyBalanceDto): string {
    return `ACCOUNTING.AUXILIARY_BALANCE.TYPES_PLURAL.${report.thirdPartyType}`;
  }

  protected periodLabel(report: ThirdPartyBalanceDto): string {
    return `${report.period.startDate} — ${report.period.endDate}`;
  }

  protected thirdPartyLabel(row: ThirdPartyBalanceLineDto): string {
    return `${row.thirdPartyCode} — ${row.thirdPartyName}`;
  }

  protected remainingAmount(row: ThirdPartyBalanceLineDto): number | null {
    return row.remainingAmount ?? row.unletteredAmount ?? row.letteringStatusSummary?.remainingAmount ?? null;
  }

  protected loadMoreParams(): ThirdPartyBalanceParams | null {
    const scope = this.appliedScope();
    const year = this.activeYear();
    const cursor = this.nextCursor();

    if (!scope || !year || !cursor) {
      return null;
    }

    return {
      ...scope,
      fiscalYear: String(year),
      cursor,
      limit: AUXILIARY_BALANCE_PAGE_SIZE
    };
  }

  private resetPagination(): void {
    this.extraRows.set([]);
    this.paginationState.set({});
    this.loadingMore.set(false);
    this.loadMoreError.set(false);
  }
}

function dedupeRows(rows: readonly ThirdPartyBalanceLineDto[]): ThirdPartyBalanceLineDto[] {
  const rowsByThirdParty = new Map<string, ThirdPartyBalanceLineDto>();

  for (const row of rows) {
    rowsByThirdParty.set(row.thirdPartyId, row);
  }

  return [...rowsByThirdParty.values()];
}
