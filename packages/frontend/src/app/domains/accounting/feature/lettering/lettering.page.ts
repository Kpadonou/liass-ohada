import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
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
import { AccountSearchSelectComponent } from '../../ui/account-search-select/account-search-select.component';
import { FiscalYearRequiredComponent } from '../../ui/fiscal-year-required/fiscal-year-required.component';

interface LetteringScope {
  accountId: string;
  thirdPartyId: string;
  thirdPartyType: ThirdPartyTypeValue;
  dateFrom?: string;
  dateTo?: string;
}

interface LetteringConfirmationDialogData {
  action: 'CREATE' | 'CANCEL';
  debitTotal?: number;
  creditTotal?: number;
  lineCount?: number;
  letteringId?: string;
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
        <dl class="grid gap-3 rounded-app-card bg-app-surface-muted p-4 text-sm sm:grid-cols-3">
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
    LiassButtonComponent,
    LiassCardComponent,
    AccountSearchSelectComponent,
    FiscalYearRequiredComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    LiassStatusChipComponent,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslocoModule
  ],
  templateUrl: './lettering.page.html'
})
export class LetteringPage {
  private readonly accountingApi = inject(AccountingApi);
  protected readonly fiscalYearContext = inject(AccountingFiscalYearContextService);
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly dialog = inject(MatDialog);
  private readonly formBuilder = inject(FormBuilder);
  private readonly notifications = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);

  protected readonly selectedLineKeys = signal(new Set<string>());
  protected readonly allocations = signal<Record<string, number>>({});
  protected readonly pendingAction = signal<'create' | 'cancel' | null>(null);
  protected readonly latestMatch = signal<LetteringMatchDto | null>(null);
  protected readonly pageErrorKey = signal<string | null>(null);

  protected readonly scope = signal<LetteringScope>({
    accountId: '41100000',
    thirdPartyId: '',
    thirdPartyType: 'CUSTOMER'
  });

  protected readonly form = this.formBuilder.nonNullable.group({
    accountId: ['41100000', [Validators.required, Validators.pattern(/^\d{2,8}$/)]],
    thirdPartyId: ['', [Validators.required]],
    thirdPartyType: ['CUSTOMER' as ThirdPartyTypeValue, [Validators.required]],
    dateFrom: [''],
    dateTo: ['']
  });

  protected readonly activeFiscalYear = computed(() => this.fiscalYearContext.activeFiscalYear());
  protected readonly activeYear = computed(() => this.fiscalYearContext.activeYear());
  protected readonly hasScope = computed(
    () => !!this.scope().thirdPartyId && !!this.activeYear()
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
  protected readonly selectedLines = computed(() => {
    const selectedKeys = this.selectedLineKeys();

    return this.candidates().filter((line) => selectedKeys.has(this.lineKey(line)));
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
  protected readonly canCreateMatch = computed(
    () =>
      this.selectedLines().length >= 2 &&
      this.selectedDebitTotal() > 0 &&
      this.selectedDebitTotal() === this.selectedCreditTotal() &&
      !this.pendingAction()
  );

  protected applyFilters(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    if (raw.dateFrom && raw.dateTo && raw.dateFrom > raw.dateTo) {
      this.pageErrorKey.set('ACCOUNTING.LETTERING.ERRORS.DATE_RANGE');
      return;
    }

    this.scope.set({
      accountId: raw.accountId,
      thirdPartyId: raw.thirdPartyId.trim(),
      thirdPartyType: raw.thirdPartyType,
      dateFrom: raw.dateFrom || undefined,
      dateTo: raw.dateTo || undefined
    });
    this.pageErrorKey.set(null);
    this.clearSelection();
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
    const amount = Math.max(0, Math.min(Number(input.value) || 0, line.remainingAmount));
    const key = this.lineKey(line);

    this.allocations.update((current) => ({
      ...current,
      [key]: amount
    }));
  }

  protected allocationAmount(line: UnletteredLineDto): number {
    return this.allocations()[this.lineKey(line)] ?? line.remainingAmount;
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
    return new Intl.NumberFormat('fr-FR').format(value);
  }

  protected lineDirectionKey(line: UnletteredLineDto): string {
    return line.debit > 0
      ? 'ACCOUNTING.LETTERING.LINE_TYPES.DEBIT'
      : 'ACCOUNTING.LETTERING.LINE_TYPES.CREDIT';
  }

  protected statusTone(line: UnletteredLineDto): 'warning' | 'info' {
    return line.letteringStatus === 'PARTIAL' ? 'info' : 'warning';
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
}
