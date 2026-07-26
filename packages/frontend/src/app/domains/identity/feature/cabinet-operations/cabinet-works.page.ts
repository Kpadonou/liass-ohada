import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import type {
  AccountingWork,
  AccountingWorkStatus,
  AccountingWorkType,
  CabinetPriority,
  ListAccountingWorksRequest
} from '@liass-ohada/shared/shared';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { AuthStore } from '../../data-access/auth.store';
import { CabinetDashboardQueries } from '../../data-access/cabinet-dashboard.queries';
import { CabinetOperationsApi } from '../../data-access/cabinet-operations.api';
import { CabinetOperationsCapabilities } from '../../data-access/cabinet-operations-capabilities';
import { CabinetOperationsQueries } from '../../data-access/cabinet-operations.queries';
import { CabinetTeamQueries } from '../../data-access/cabinet-team.queries';
import {
  CabinetOperationConfirmDialogComponent,
  type CabinetOperationConfirmDialogData
} from './cabinet-operation-confirm-dialog.component';
import {
  CabinetWorkDialogComponent,
  type CabinetWorkDialogResult
} from './cabinet-work-dialog.component';
import {
  ACCOUNTING_WORK_STATUSES,
  ACCOUNTING_WORK_TYPES,
  CABINET_PRIORITIES,
  allowedWorkTransitions,
  cabinetOperationsErrorKey,
  isWorkOverdue,
  priorityKey,
  priorityTone,
  todayDateOnly,
  userDisplayLabel,
  workStatusKey,
  workStatusTone,
  workTransitionKey,
  workTypeKey
} from './cabinet-operations.presentation';

type WorkFilterStatus = AccountingWorkStatus | 'ALL';
type WorkFilterType = AccountingWorkType | 'ALL';
type WorkFilterPriority = CabinetPriority | 'ALL';

@Component({
  selector: 'liass-cabinet-works-page',
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
    MatProgressSpinnerModule,
    MatSelectModule,
    TranslocoModule
  ],
  templateUrl: './cabinet-works.page.html'
})
export class CabinetWorksPage implements OnInit {
  private readonly api = inject(CabinetOperationsApi);
  protected readonly authStore = inject(AuthStore);
  protected readonly capabilities = inject(CabinetOperationsCapabilities);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly dashboardQueries = inject(CabinetDashboardQueries);
  protected readonly queries = inject(CabinetOperationsQueries);
  protected readonly teamQueries = inject(CabinetTeamQueries);
  private readonly transloco = inject(TranslocoService);

  protected readonly priorities = CABINET_PRIORITIES;
  protected readonly statuses = ACCOUNTING_WORK_STATUSES;
  protected readonly types = ACCOUNTING_WORK_TYPES;
  protected readonly cursor = signal<string | undefined>(undefined);
  protected readonly cursorHistory = signal<(string | undefined)[]>([]);
  protected readonly dossierOrgId = signal('ALL');
  protected readonly dueFrom = signal('');
  protected readonly dueTo = signal('');
  protected readonly periodStart = signal('');
  protected readonly periodEnd = signal('');
  protected readonly priority = signal<WorkFilterPriority>('ALL');
  protected readonly responsibleUserId = signal('ALL');
  protected readonly status = signal<WorkFilterStatus>('ALL');
  protected readonly type = signal<WorkFilterType>('ALL');
  protected readonly actionErrorKey = signal<string | null>(null);
  protected readonly mutatingId = signal<string | null>(null);

  protected readonly filters = computed<ListAccountingWorksRequest>(() => ({
    cursor: this.cursor(),
    dossierOrgId: valueOrUndefined(this.dossierOrgId()),
    dueFrom: valueOrUndefined(this.dueFrom()),
    dueTo: valueOrUndefined(this.dueTo()),
    limit: 25,
    periodEnd: valueOrUndefined(this.periodEnd()),
    periodStart: valueOrUndefined(this.periodStart()),
    priority: priorityFilter(this.priority()),
    responsibleUserId: valueOrUndefined(this.responsibleUserId()),
    status: workStatusFilter(this.status()),
    type: workTypeFilter(this.type())
  }));
  protected readonly worksQuery = injectQuery(() => this.queries.works(this.filters()));
  protected readonly membersQuery = injectQuery(() =>
    this.teamQueries.members({ limit: 100, status: 'ACTIVE' })
  );
  protected readonly activeDossiers = computed(() =>
    this.authStore.dossiers().filter((dossier) => dossier.status === 'ACTIVE')
  );
  protected readonly eligibleMembers = computed(() =>
    (this.membersQuery.data()?.members ?? []).filter(
      (member) =>
        member.status === 'ACTIVE' &&
        (member.cabinetRole === 'CABINET_ADMIN' ||
          member.cabinetRole === 'SUPERVISOR' ||
          member.cabinetRole === 'COLLABORATOR')
    )
  );
  protected readonly hasFilters = computed(
    () =>
      this.dossierOrgId() !== 'ALL' ||
      this.dueFrom() ||
      this.dueTo() ||
      this.periodStart() ||
      this.periodEnd() ||
      this.priority() !== 'ALL' ||
      this.responsibleUserId() !== 'ALL' ||
      this.status() !== 'ALL' ||
      this.type() !== 'ALL'
  );

  async ngOnInit(): Promise<void> {
    if (!this.authStore.dossiersLoaded()) {
      await this.authStore.loadDossiers();
    }
  }

  protected openCreateDialog(): void {
    if (!this.capabilities.canCreateCabinetWork()) return;
    this.openDialog({ mode: 'create' });
  }

  protected openDetails(work: AccountingWork): void {
    this.openDialog({ mode: 'view', work });
  }

  protected openEdit(work: AccountingWork): void {
    if (!this.capabilities.canEditCabinetWork(work)) return;
    this.openDialog({ mode: 'edit', work });
  }

  protected async updateStatus(work: AccountingWork, status: AccountingWorkStatus): Promise<void> {
    if (!this.capabilities.canChangeCabinetWorkStatus(work, status)) return;
    if (status === 'CANCELLED') {
      const confirmed = await this.confirm({
        confirmKey: 'IDENTITY.CABINET_OPERATIONS.WORK.TRANSITIONS.CANCELLED',
        danger: true,
        descriptionKey: 'IDENTITY.CABINET_OPERATIONS.WORK.CONFIRM_CANCEL',
        name: work.title,
        titleKey: 'IDENTITY.CABINET_OPERATIONS.WORK.CANCEL_TITLE'
      });
      if (!confirmed) return;
    }
    await this.runMutation(
      work.workId,
      () => this.api.updateWorkStatus({ currentStatus: work.status, status, workId: work.workId }),
      status === 'CANCELLED'
        ? 'IDENTITY.CABINET_OPERATIONS.NOTIFICATIONS.WORK_CANCELLED'
        : 'IDENTITY.CABINET_OPERATIONS.NOTIFICATIONS.WORK_STATUS_UPDATED'
    );
  }

  protected validTransitions(work: AccountingWork): readonly AccountingWorkStatus[] {
    return allowedWorkTransitions(work.status).filter((status) =>
      this.capabilities.canChangeCabinetWorkStatus(work, status)
    );
  }

  protected nextPage(): void {
    const cursor = this.worksQuery.data()?.nextCursor;
    if (!cursor) return;
    this.cursorHistory.update((history) => [...history, this.cursor()]);
    this.cursor.set(cursor);
  }

  protected previousPage(): void {
    const history = [...this.cursorHistory()];
    if (!history.length) return;
    this.cursor.set(history.pop());
    this.cursorHistory.set(history);
  }

  protected resetFilters(): void {
    this.dossierOrgId.set('ALL');
    this.dueFrom.set('');
    this.dueTo.set('');
    this.periodStart.set('');
    this.periodEnd.set('');
    this.priority.set('ALL');
    this.responsibleUserId.set('ALL');
    this.status.set('ALL');
    this.type.set('ALL');
    this.resetPagination();
  }

  protected setMyWork(): void {
    const userId = this.authStore.currentUserId();
    if (!userId) return;
    this.responsibleUserId.set(userId);
    this.resetPagination();
  }

  protected setUpcoming(): void {
    this.status.set('TO_DO');
    this.dueFrom.set(todayDateOnly());
    this.resetPagination();
  }

  protected updateSignal(target: { set: (value: string) => void }, value: string): void {
    target.set(value);
    this.resetPagination();
  }

  protected updateDate(target: { set: (value: string) => void }, event: Event): void {
    target.set((event.target as HTMLInputElement).value);
    this.resetPagination();
  }

  protected dateLabel(value: string | undefined): string {
    return value
      ? new Intl.DateTimeFormat(this.transloco.getActiveLang()).format(new Date(`${value}T00:00:00`))
      : this.transloco.translate('IDENTITY.CABINET_OPERATIONS.NONE');
  }

  protected dossierName(work: AccountingWork): string {
    return (
      this.activeDossiers().find((dossier) => dossier.orgId === work.dossierOrgId)?.displayName ??
      work.dossierName ??
      this.transloco.translate('IDENTITY.CABINET_OPERATIONS.UNKNOWN_DOSSIER')
    );
  }

  protected memberName(userId: string | undefined, displayName?: string): string {
    const member = this.membersQuery.data()?.members.find((candidate) => candidate.userId === userId);
    const fallbackKey = userId
      ? 'IDENTITY.CABINET_OPERATIONS.ASSIGNED_MEMBER'
      : 'IDENTITY.CABINET_OPERATIONS.UNASSIGNED';
    return displayName?.trim() || userDisplayLabel(member, this.transloco.translate(fallbackKey));
  }

  protected periodLabel(work: AccountingWork): string {
    if (!work.periodStart && !work.periodEnd) return this.transloco.translate('IDENTITY.CABINET_OPERATIONS.NONE');
    return [work.periodStart, work.periodEnd].filter(Boolean).map((date) => this.dateLabel(date)).join(' - ');
  }

  protected priorityKey = priorityKey;
  protected priorityTone = priorityTone;
  protected workStatusKey = workStatusKey;
  protected workStatusTone = workStatusTone;
  protected workTransitionKey = workTransitionKey;
  protected workTypeKey = workTypeKey;
  protected isWorkOverdue = isWorkOverdue;

  private openDialog(options: { mode: 'create' } | { mode: 'edit' | 'view'; work: AccountingWork }): void {
    firstValueFrom(
      this.dialog
        .open(CabinetWorkDialogComponent, {
          data: {
            dossiers: this.activeDossiers(),
            members: this.eligibleMembers(),
            ...options
          },
          maxWidth: 'calc(100vw - 32px)',
          panelClass: 'liass-dialog-panel',
          restoreFocus: true,
          width: '820px'
        })
        .afterClosed()
    ).then((result: CabinetWorkDialogResult | undefined) => {
      if (!result) return;
      const operation =
        result.mode === 'create'
          ? () => this.api.createWork(result.payload)
          : () => this.api.updateWork(result.payload);
      void this.runMutation(
        result.mode === 'edit' ? result.payload.workId : null,
        operation,
        result.mode === 'create'
          ? 'IDENTITY.CABINET_OPERATIONS.NOTIFICATIONS.WORK_CREATED'
          : 'IDENTITY.CABINET_OPERATIONS.NOTIFICATIONS.WORK_UPDATED'
      );
    });
  }

  private async runMutation(
    id: string | null,
    operation: () => Promise<AccountingWork>,
    successKey: string
  ): Promise<void> {
    this.mutatingId.set(id);
    this.actionErrorKey.set(null);
    try {
      const work = await operation();
      await Promise.all([
        this.queryClient.invalidateQueries({ queryKey: this.dashboardQueries.all() }),
        this.queryClient.invalidateQueries({ queryKey: this.queries.worksRoot() }),
        this.queryClient.invalidateQueries({
          queryKey: ['cabinet-operations', this.queries.scope(), 'works', work.workId]
        })
      ]);
      this.notification.success(this.transloco.translate(successKey));
    } catch (error) {
      this.actionErrorKey.set(
        cabinetOperationsErrorKey(error, 'IDENTITY.CABINET_OPERATIONS.ERRORS.WORK_MUTATION_FAILED')
      );
      await this.queryClient.invalidateQueries({ queryKey: this.queries.worksRoot() });
    } finally {
      this.mutatingId.set(null);
    }
  }

  private async confirm(data: CabinetOperationConfirmDialogData): Promise<boolean> {
    return (
      (await firstValueFrom(
        this.dialog
          .open(CabinetOperationConfirmDialogComponent, {
            data,
            maxWidth: 'calc(100vw - 32px)',
            panelClass: 'liass-dialog-panel',
            restoreFocus: true,
            width: '480px'
          })
          .afterClosed()
      )) ?? false
    );
  }

  private resetPagination(): void {
    this.cursor.set(undefined);
    this.cursorHistory.set([]);
  }
}

function valueOrUndefined(value: string): string | undefined {
  return value === 'ALL' || value.trim() === '' ? undefined : value;
}

function priorityFilter(value: WorkFilterPriority): CabinetPriority | undefined {
  return value === 'ALL' ? undefined : value;
}

function workStatusFilter(value: WorkFilterStatus): AccountingWorkStatus | undefined {
  return value === 'ALL' ? undefined : value;
}

function workTypeFilter(value: WorkFilterType): AccountingWorkType | undefined {
  return value === 'ALL' ? undefined : value;
}
