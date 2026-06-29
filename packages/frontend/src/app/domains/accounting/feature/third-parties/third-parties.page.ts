import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import {
  type ThirdPartyDto,
  type ThirdPartyStatusValue,
  type ThirdPartyTypeValue
} from '@liass-ohada/shared/accounting';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { take } from 'rxjs';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { AccountingApi, type PaginatedResult } from '../../data-access/accounting.api';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { ThirdPartyDialogComponent } from './third-party-dialog.component';
import { ThirdPartyStatusDialogComponent } from './third-party-status-dialog.component';

type ThirdPartyStatusFilter = 'ACTIVE' | 'INACTIVE' | 'ALL';

const THIRD_PARTY_PAGE_SIZE = 200;

@Component({
  selector: 'liass-third-parties-page',
  host: {
    class: 'block'
  },
  imports: [
    LiassButtonComponent,
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    LiassStatusChipComponent,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatSelectModule,
    TranslocoModule
  ],
  templateUrl: './third-parties.page.html'
})
export class ThirdPartiesPage {
  private readonly accountingApi = inject(AccountingApi);
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly dialog = inject(MatDialog);
  private readonly queryClient = inject(QueryClient);

  protected readonly activeType = signal<ThirdPartyTypeValue>('CUSTOMER');
  protected readonly searchQuery = signal('');
  protected readonly statusFilter = signal<ThirdPartyStatusFilter>('ACTIVE');
  protected readonly extraPages = signal<PaginatedResult<ThirdPartyDto>[]>([]);
  protected readonly localThirdPartyUpserts = signal<ThirdPartyDto[]>([]);
  protected readonly loadMoreError = signal(false);
  protected readonly loadingMore = signal(false);

  protected readonly thirdPartiesQuery = injectQuery(() =>
    this.accountingQueries.listThirdParties(this.listRequest())
  );

  protected readonly allThirdParties = computed(() =>
    mergeThirdParties(
      [
        ...(this.thirdPartiesQuery.data()?.items ?? []),
        ...this.extraPages().flatMap((page) => page.items)
      ],
      this.localThirdPartyUpserts()
    )
  );

  protected readonly filteredThirdParties = computed(() => {
    const query = normalizeSearch(this.searchQuery());
    const status = this.statusFilter();

    return this.allThirdParties().filter((thirdParty) => {
      const matchesStatus = status === 'ALL' || thirdParty.status === status;
      const searchable = normalizeSearch(`${thirdParty.code} ${thirdParty.displayName}`);

      return matchesStatus && (!query || searchable.includes(query));
    });
  });

  protected readonly hasLoadedThirdParties = computed(() => this.allThirdParties().length > 0);
  protected readonly showSearchScopeHint = computed(() => this.hasMoreThirdParties());
  protected readonly createButtonKey = computed(() =>
    this.activeType() === 'CUSTOMER'
      ? 'ACCOUNTING.THIRD_PARTIES.ACTIONS.NEW_CUSTOMER'
      : 'ACCOUNTING.THIRD_PARTIES.ACTIONS.NEW_SUPPLIER'
  );
  protected readonly selectedTypeLabelKey = computed(() => this.typeLabelKey(this.activeType()));
  protected readonly selectedStatusLabelKey = computed(() => this.statusFilterLabelKey());

  protected readonly nextCursor = computed(() => {
    const extraPages = this.extraPages();
    const lastPage = extraPages.at(-1) ?? this.thirdPartiesQuery.data();

    return lastPage?.nextCursor ?? null;
  });

  protected readonly hasMoreThirdParties = computed(() => {
    const extraPages = this.extraPages();
    const lastPage = extraPages.at(-1) ?? this.thirdPartiesQuery.data();

    return !!lastPage?.hasMore && !!lastPage.nextCursor;
  });

  protected updateType(type: ThirdPartyTypeValue): void {
    this.activeType.set(type);
    this.searchQuery.set('');
    this.resetPagination();
  }

  protected updateSearch(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  protected updateStatusFilter(value: ThirdPartyStatusFilter): void {
    this.statusFilter.set(value);
    this.resetPagination();
  }

  protected clearFilters(): void {
    this.activeType.set('CUSTOMER');
    this.searchQuery.set('');
    this.statusFilter.set('ACTIVE');
    this.resetPagination();
  }

  protected async retryInitialLoad(): Promise<void> {
    this.extraPages.set([]);
    this.loadMoreError.set(false);
    await this.thirdPartiesQuery.refetch();
  }

  protected async loadMoreThirdParties(): Promise<void> {
    const cursor = this.nextCursor();

    if (!cursor || this.loadingMore()) {
      return;
    }

    this.loadingMore.set(true);
    this.loadMoreError.set(false);

    try {
      const page = await this.accountingApi.listThirdParties({
        ...this.listRequest(),
        cursor
      });
      this.extraPages.update((pages) => [...pages, page]);
    } catch {
      this.loadMoreError.set(true);
    } finally {
      this.loadingMore.set(false);
    }
  }

  protected openCreateThirdParty(): void {
    const dialogRef = this.dialog.open(ThirdPartyDialogComponent, {
      autoFocus: 'first-tabbable',
      data: { mode: 'create', type: this.activeType() },
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '720px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((thirdParty: ThirdPartyDto | null | undefined) => {
      if (thirdParty) {
        this.upsertThirdParty(thirdParty);
        this.refreshThirdPartiesAfterMutation();
      }
    });
  }

  protected openEditThirdParty(thirdParty: ThirdPartyDto): void {
    const dialogRef = this.dialog.open(ThirdPartyDialogComponent, {
      autoFocus: 'first-tabbable',
      data: { mode: 'edit', thirdParty, type: thirdParty.type },
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '720px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((updatedThirdParty: ThirdPartyDto | null | undefined) => {
      if (updatedThirdParty) {
        this.upsertThirdParty(updatedThirdParty);
        this.refreshThirdPartiesAfterMutation();
      }
    });
  }

  protected openStatusDialog(thirdParty: ThirdPartyDto): void {
    const dialogRef = this.dialog.open(ThirdPartyStatusDialogComponent, {
      autoFocus: 'first-tabbable',
      data: {
        action: thirdParty.status === 'ACTIVE' ? 'deactivate' : 'activate',
        thirdParty
      },
      disableClose: true,
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '520px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((updatedThirdParty: ThirdPartyDto | null | undefined) => {
      if (updatedThirdParty) {
        this.upsertThirdParty(updatedThirdParty);
        this.refreshThirdPartiesAfterMutation();
      }
    });
  }

  protected refreshThirdPartiesAfterStatusChange(): void {
    this.refreshThirdPartiesAfterMutation();
  }

  protected refreshThirdPartiesAfterMutation(): void {
    void this.thirdPartiesQuery.refetch();
  }

  protected thirdPartyLabel(thirdParty: ThirdPartyDto): string {
    return `${thirdParty.code} — ${thirdParty.displayName}`;
  }

  protected typeKey(thirdParty: ThirdPartyDto): string {
    return this.typeLabelKey(thirdParty.type);
  }

  protected statusKey(thirdParty: ThirdPartyDto): string {
    return `ACCOUNTING.THIRD_PARTIES.STATUS.${thirdParty.status}`;
  }

  protected statusTone(thirdParty: ThirdPartyDto): 'success' | 'neutral' {
    return thirdParty.status === 'ACTIVE' ? 'success' : 'neutral';
  }

  private listRequest() {
    return {
      limit: THIRD_PARTY_PAGE_SIZE,
      type: this.activeType(),
      ...(this.statusFilter() !== 'ALL' ? { status: this.statusFilter() as ThirdPartyStatusValue } : {})
    };
  }

  private resetPagination(): void {
    this.extraPages.set([]);
    this.loadMoreError.set(false);
  }

  private upsertThirdParty(thirdParty: ThirdPartyDto): void {
    this.loadMoreError.set(false);
    this.localThirdPartyUpserts.update((thirdParties) =>
      mergeThirdParties(thirdParties, [thirdParty])
    );
    this.queryClient.setQueriesData<PaginatedResult<ThirdPartyDto>>(
      { queryKey: this.accountingQueries.thirdPartiesRootQueryKey() },
      (page) =>
        page
          ? {
              ...page,
              items: mergeThirdParties(page.items, [thirdParty])
            }
          : page
    );
  }

  private typeLabelKey(type: ThirdPartyTypeValue): string {
    return `ACCOUNTING.THIRD_PARTIES.TYPES.${type}`;
  }

  private statusFilterLabelKey(): string {
    return `ACCOUNTING.THIRD_PARTIES.FILTERS.${this.statusFilter()}`;
  }
}

function mergeThirdParties(base: readonly ThirdPartyDto[], upserts: readonly ThirdPartyDto[]): ThirdPartyDto[] {
  const thirdParties = new Map<string, ThirdPartyDto>();

  for (const thirdParty of base) {
    thirdParties.set(`${thirdParty.type}:${thirdParty.thirdPartyId}`, thirdParty);
  }

  for (const thirdParty of upserts) {
    thirdParties.set(`${thirdParty.type}:${thirdParty.thirdPartyId}`, thirdParty);
  }

  return [...thirdParties.values()].sort((left, right) => left.code.localeCompare(right.code));
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
