import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  type AccountEntryDto,
  type LetteringResultDto,
  type LetteringSuggestionDto
} from '@liass-ohada/shared/accounting';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';

import {
  LiassSearchableSelectComponent,
  type LiassSearchableSelectOption
} from '../../../../shared/ui/searchable-select/searchable-select.component';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { AccountingApi } from '../../data-access/accounting.api';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { FiscalYearRequiredComponent } from '../../ui/fiscal-year-required/fiscal-year-required.component';

interface LetteringScope {
  accountId: string;
  thirdPartyId: string;
  projectId?: string;
}

type LetteringAction = 'post' | 'cancel' | null;

@Component({
  selector: 'liass-lettering-page',
  imports: [
    LiassButtonComponent,
    LiassCardComponent,
    FiscalYearRequiredComponent,
    LiassPageHeaderComponent,
    LiassSearchableSelectComponent,
    LiassSkeletonComponent,
    LiassStatusChipComponent,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    TranslocoModule
  ],
  templateUrl: './lettering.page.html'
})
export class LetteringPage {
  private readonly accountingApi = inject(AccountingApi);
  protected readonly fiscalYearContext = inject(AccountingFiscalYearContextService);
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly selectedLineKeys = signal(new Set<string>());
  protected readonly pendingAction = signal<LetteringAction>(null);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly successKey = signal<string | null>(null);
  protected readonly result = signal<LetteringResultDto | null>(null);
  protected readonly scope = signal<LetteringScope>({
    accountId: '41100000',
    thirdPartyId: ''
  });

  protected readonly form = this.formBuilder.nonNullable.group({
    accountId: ['41100000', [Validators.required, Validators.pattern(/^\d{2,8}$/)]],
    thirdPartyId: ['', [Validators.required]],
    projectId: [''],
    letteringCode: ['LET001', [Validators.required]]
  });

  protected readonly accountsQuery = injectQuery(() => this.accountingQueries.listAccounts());
  protected readonly accounts = computed(() => this.accountsQuery.data()?.items ?? []);
  protected readonly accountOptions = computed<LiassSearchableSelectOption[]>(() =>
    this.accounts().map((account) => ({
      label: `${account.accountId} - ${account.accountName}`,
      value: account.accountId
    }))
  );

  protected readonly thirdPartyLedgerQuery = injectQuery(() =>
    this.accountingQueries.thirdPartyLedger({
      accountId: this.scope().accountId,
      thirdPartyId: this.scope().thirdPartyId
    }, this.fiscalYearContext.hasActiveFiscalYear())
  );
  protected readonly matchingReportQuery = injectQuery(() =>
    this.accountingQueries.matchingReport({
      accountId: this.scope().accountId,
      thirdPartyId: this.scope().thirdPartyId
    }, this.fiscalYearContext.hasActiveFiscalYear())
  );
  protected readonly unletteredLinesQuery = injectQuery(() =>
    this.accountingQueries.unletteredLines({
      accountId: this.scope().accountId,
      thirdPartyId: this.scope().thirdPartyId,
      projectId: this.scope().projectId
    }, this.fiscalYearContext.hasActiveFiscalYear())
  );

  protected readonly thirdPartyLedger = computed(() => this.thirdPartyLedgerQuery.data() ?? null);
  protected readonly matchingReport = computed(() => this.matchingReportQuery.data() ?? null);
  protected readonly unletteredLines = computed(
    () => this.unletteredLinesQuery.data()?.unletteredLines ?? []
  );
  protected readonly suggestions = computed(
    () => this.unletteredLinesQuery.data()?.suggestions ?? []
  );
  protected readonly selectedLines = computed(() => {
    const selectedKeys = this.selectedLineKeys();

    return this.unletteredLines().filter((line) => selectedKeys.has(this.lineKey(line)));
  });
  protected readonly selectedLineRefs = computed(() =>
    this.selectedLines()
      .filter((line) => typeof line.year === 'number')
      .map((line) => ({
        year: line.year as number,
        entryId: line.entryId,
        lineId: line.lineId
      }))
  );
  protected readonly hasIncompleteSelection = computed(
    () => this.selectedLineRefs().length !== this.selectedLines().length
  );
  protected readonly canPostLettering = computed(
    () =>
      this.selectedLineRefs().length >= 2 &&
      this.fiscalYearContext.hasActiveFiscalYear() &&
      !this.hasIncompleteSelection() &&
      this.form.controls.letteringCode.valid &&
      !this.pendingAction()
  );
  protected readonly canCancelLettering = computed(
    () =>
      this.selectedLineRefs().length >= 1 &&
      this.fiscalYearContext.hasActiveFiscalYear() &&
      !this.hasIncompleteSelection() &&
      !this.pendingAction()
  );

  protected applyFilters(): void {
    if (this.form.controls.accountId.invalid || this.form.controls.thirdPartyId.invalid) {
      this.form.controls.accountId.markAsTouched();
      this.form.controls.thirdPartyId.markAsTouched();
      return;
    }

    const raw = this.form.getRawValue();

    this.scope.set({
      accountId: raw.accountId,
      thirdPartyId: raw.thirdPartyId.trim(),
      projectId: raw.projectId.trim() || undefined
    });
    this.clearSelection();
    this.errorKey.set(null);
    this.successKey.set(null);
    this.result.set(null);
  }

  protected toggleLine(line: AccountEntryDto, checked: boolean): void {
    const nextKeys = new Set(this.selectedLineKeys());
    const key = this.lineKey(line);

    if (checked) {
      nextKeys.add(key);
    } else {
      nextKeys.delete(key);
    }

    this.selectedLineKeys.set(nextKeys);
  }

  protected isSelected(line: AccountEntryDto): boolean {
    return this.selectedLineKeys().has(this.lineKey(line));
  }

  protected selectSuggestion(suggestion: LetteringSuggestionDto): void {
    const nextKeys = new Set<string>();

    for (const suggestionLine of suggestion.lines) {
      const matchingLine = this.unletteredLines().find(
        (line) =>
          line.entryId === suggestionLine.entryId &&
          line.lineId === suggestionLine.lineId
      );

      if (matchingLine) {
        nextKeys.add(this.lineKey(matchingLine));
      }
    }

    this.selectedLineKeys.set(nextKeys);
  }

  protected clearSelection(): void {
    this.selectedLineKeys.set(new Set());
  }

  protected async postLettering(): Promise<void> {
    if (!this.canPostLettering()) {
      this.errorKey.set('ACCOUNTING.LETTERING.ERRORS.SELECTION_REQUIRED');
      return;
    }

    this.pendingAction.set('post');
    this.errorKey.set(null);
    this.successKey.set(null);
    this.result.set(null);

    try {
      const result = await this.accountingApi.postLettering({
        accountId: this.scope().accountId,
        thirdPartyId: this.scope().thirdPartyId,
        letteringCode: this.form.controls.letteringCode.value.trim(),
        lines: this.selectedLineRefs()
      });
      this.result.set(result);
      this.successKey.set('ACCOUNTING.LETTERING.MESSAGES.POSTED');
      this.clearSelection();
      await this.refetchScope();
    } catch {
      this.errorKey.set('ACCOUNTING.LETTERING.ERRORS.POST_FAILED');
    } finally {
      this.pendingAction.set(null);
    }
  }

  protected async cancelSelectedLettering(): Promise<void> {
    await this.cancelLines(this.selectedLineRefs());
  }

  protected async cancelGroup(lines: AccountEntryDto[]): Promise<void> {
    const refs = lines
      .filter((line) => typeof line.year === 'number')
      .map((line) => ({
        year: line.year as number,
        entryId: line.entryId,
        lineId: line.lineId
      }));

    await this.cancelLines(refs);
  }

  protected lineKey(line: AccountEntryDto): string {
    return `${line.year ?? 'unknown'}:${line.entryId}:${line.lineId}`;
  }

  protected formatAmount(value: number): string {
    return new Intl.NumberFormat('fr-FR').format(value);
  }

  protected lineAmount(line: AccountEntryDto): number {
    return line.debit > 0 ? line.debit : line.credit;
  }

  protected lineTypeKey(line: AccountEntryDto): string {
    return line.debit > 0 ? 'ACCOUNTING.LETTERING.LINE_TYPES.DEBIT' : 'ACCOUNTING.LETTERING.LINE_TYPES.CREDIT';
  }

  protected suggestionTypeKey(suggestion: LetteringSuggestionDto): string {
    return `ACCOUNTING.LETTERING.SUGGESTIONS.TYPES.${suggestion.type}`;
  }

  protected letteredGroups(): Array<{ code: string; lines: AccountEntryDto[] }> {
    const groups = this.matchingReport()?.letteredGroups ?? {};

    return Object.entries(groups).map(([code, lines]) => ({ code, lines }));
  }

  private async cancelLines(
    lines: Array<{ year: number; entryId: string; lineId: string }>
  ): Promise<void> {
    if (lines.length < 1 || this.pendingAction()) {
      this.errorKey.set('ACCOUNTING.LETTERING.ERRORS.CANCEL_SELECTION_REQUIRED');
      return;
    }

    this.pendingAction.set('cancel');
    this.errorKey.set(null);
    this.successKey.set(null);
    this.result.set(null);

    try {
      const result = await this.accountingApi.cancelLettering({
        accountId: this.scope().accountId,
        thirdPartyId: this.scope().thirdPartyId,
        lines
      });
      this.result.set(result);
      this.successKey.set('ACCOUNTING.LETTERING.MESSAGES.CANCELLED');
      this.clearSelection();
      await this.refetchScope();
    } catch {
      this.errorKey.set('ACCOUNTING.LETTERING.ERRORS.CANCEL_FAILED');
    } finally {
      this.pendingAction.set(null);
    }
  }

  private async refetchScope(): Promise<void> {
    await Promise.all([
      this.thirdPartyLedgerQuery.refetch(),
      this.matchingReportQuery.refetch(),
      this.unletteredLinesQuery.refetch()
    ]);
  }
}
