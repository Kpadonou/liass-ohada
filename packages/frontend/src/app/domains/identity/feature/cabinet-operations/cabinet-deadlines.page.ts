import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import type {
  CabinetDeadline,
  CabinetDeadlineStatus,
  CabinetDeadlineType,
  CabinetPriority,
  ListAccountingWorksRequest,
  ListCabinetDeadlinesRequest
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
import { CabinetOperationsApi } from '../../data-access/cabinet-operations.api';
import { CabinetOperationsCapabilities } from '../../data-access/cabinet-operations-capabilities';
import { CabinetOperationsQueries } from '../../data-access/cabinet-operations.queries';
import { CabinetTeamQueries } from '../../data-access/cabinet-team.queries';
import { CabinetDeadlineDialogComponent, type CabinetDeadlineDialogResult } from './cabinet-deadline-dialog.component';
import {
  CabinetOperationConfirmDialogComponent,
  type CabinetOperationConfirmDialogData
} from './cabinet-operation-confirm-dialog.component';
import {
  CABINET_DEADLINE_STATUSES,
  CABINET_DEADLINE_TYPES,
  CABINET_PRIORITIES,
  allowedDeadlineTransitions,
  cabinetOperationsErrorKey,
  deadlineStatusKey,
  deadlineStatusTone,
  deadlineTransitionKey,
  deadlineTypeKey,
  isDeadlineOverdue,
  priorityKey,
  priorityTone,
  todayDateOnly,
  userDisplayLabel
} from './cabinet-operations.presentation';

type DeadlineFilterStatus = CabinetDeadlineStatus | 'ALL';
type DeadlineFilterType = CabinetDeadlineType | 'ALL';
type DeadlineFilterPriority = CabinetPriority | 'ALL';

@Component({
  selector: 'liass-cabinet-deadlines-page',
  imports: [
    LiassButtonComponent,
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    LiassStatusChipComponent,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    TranslocoModule
  ],
  templateUrl: './cabinet-deadlines.page.html'
})
export class CabinetDeadlinesPage implements OnInit {
  private readonly api = inject(CabinetOperationsApi);
  protected readonly authStore = inject(AuthStore);
  protected readonly capabilities = inject(CabinetOperationsCapabilities);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  protected readonly queries = inject(CabinetOperationsQueries);
  protected readonly teamQueries = inject(CabinetTeamQueries);
  private readonly transloco = inject(TranslocoService);

  protected readonly priorities = CABINET_PRIORITIES;
  protected readonly statuses = CABINET_DEADLINE_STATUSES;
  protected readonly types = CABINET_DEADLINE_TYPES;
  protected readonly cursor = signal<string | undefined>(undefined);
  protected readonly cursorHistory = signal<(string | undefined)[]>([]);
  protected readonly dossierOrgId = signal('ALL');
  protected readonly dueFrom = signal('');
  protected readonly dueTo = signal('');
  protected readonly overdue = signal(false);
  protected readonly priority = signal<DeadlineFilterPriority>('ALL');
  protected readonly responsibleUserId = signal('ALL');
  protected readonly status = signal<DeadlineFilterStatus>('ALL');
  protected readonly type = signal<DeadlineFilterType>('ALL');
  protected readonly actionErrorKey = signal<string | null>(null);
  protected readonly mutatingId = signal<string | null>(null);

  protected readonly filters = computed<ListCabinetDeadlinesRequest>(() => ({
    cursor: this.cursor(),
    dossierOrgId: valueOrUndefined(this.dossierOrgId()),
    dueFrom: valueOrUndefined(this.dueFrom()),
    dueTo: valueOrUndefined(this.dueTo()),
    limit: 25,
    overdue: this.overdue() ? true : undefined,
    priority: priorityFilter(this.priority()),
    responsibleUserId: valueOrUndefined(this.responsibleUserId()),
    status: deadlineStatusFilter(this.status()),
    type: deadlineTypeFilter(this.type())
  }));
  protected readonly workSelectorFilters = computed<ListAccountingWorksRequest>(() => ({
    dossierOrgId: valueOrUndefined(this.dossierOrgId()),
    limit: 100
  }));
  protected readonly deadlinesQuery = injectQuery(() => this.queries.deadlines(this.filters()));
  protected readonly worksQuery = injectQuery(() => this.queries.works(this.workSelectorFilters()));
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
      this.overdue() ||
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
    if (!this.capabilities.canCreateCabinetDeadline()) return;
    this.openDialog({ mode: 'create' });
  }

  protected openDetails(deadline: CabinetDeadline): void {
    this.openDialog({ mode: 'view', deadline });
  }

  protected openEdit(deadline: CabinetDeadline): void {
    if (!this.capabilities.canEditCabinetDeadline(deadline)) return;
    this.openDialog({ mode: 'edit', deadline });
  }

  protected async updateStatus(
    deadline: CabinetDeadline,
    status: CabinetDeadlineStatus
  ): Promise<void> {
    if (!this.capabilities.canChangeCabinetDeadlineStatus(deadline, status)) return;
    if (status === 'CANCELLED') {
      const confirmed = await this.confirm({
        confirmKey: 'IDENTITY.CABINET_OPERATIONS.DEADLINE.TRANSITIONS.CANCELLED',
        danger: true,
        descriptionKey: 'IDENTITY.CABINET_OPERATIONS.DEADLINE.CONFIRM_CANCEL',
        name: deadline.title,
        titleKey: 'IDENTITY.CABINET_OPERATIONS.DEADLINE.CANCEL_TITLE'
      });
      if (!confirmed) return;
    }
    await this.runMutation(
      deadline.deadlineId,
      () =>
        this.api.updateDeadlineStatus({
          currentStatus: deadline.status,
          deadlineId: deadline.deadlineId,
          status
        }),
      status === 'CANCELLED'
        ? 'IDENTITY.CABINET_OPERATIONS.NOTIFICATIONS.DEADLINE_CANCELLED'
        : 'IDENTITY.CABINET_OPERATIONS.NOTIFICATIONS.DEADLINE_COMPLETED'
    );
  }

  protected validTransitions(deadline: CabinetDeadline): readonly CabinetDeadlineStatus[] {
    return allowedDeadlineTransitions(deadline.status).filter((status) =>
      this.capabilities.canChangeCabinetDeadlineStatus(deadline, status)
    );
  }

  protected applyQuickFilter(filter: 'ALL' | 'OVERDUE' | 'UPCOMING' | 'COMPLETED'): void {
    this.overdue.set(filter === 'OVERDUE');
    this.status.set(filter === 'COMPLETED' ? 'COMPLETED' : filter === 'UPCOMING' ? 'PENDING' : 'ALL');
    this.dueFrom.set(filter === 'UPCOMING' ? todayDateOnly() : '');
    this.resetPagination();
  }

  protected nextPage(): void {
    const cursor = this.deadlinesQuery.data()?.nextCursor;
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
    this.overdue.set(false);
    this.priority.set('ALL');
    this.responsibleUserId.set('ALL');
    this.status.set('ALL');
    this.type.set('ALL');
    this.resetPagination();
  }

  protected setMyDeadlines(): void {
    const userId = this.authStore.currentUserId();
    if (!userId) return;
    this.responsibleUserId.set(userId);
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

  protected dossierName(deadline: CabinetDeadline): string {
    return (
      this.activeDossiers().find((dossier) => dossier.orgId === deadline.dossierOrgId)?.displayName ??
      deadline.dossierName ??
      this.transloco.translate('IDENTITY.CABINET_OPERATIONS.UNKNOWN_DOSSIER')
    );
  }

  protected linkedWorkLabel(deadline: CabinetDeadline): string {
    if (!deadline.linkedWorkId) {
      return this.transloco.translate('IDENTITY.CABINET_OPERATIONS.NONE');
    }
    return (
      this.worksQuery.data()?.works.find((work) => work.workId === deadline.linkedWorkId)?.title ??
      this.transloco.translate('IDENTITY.CABINET_OPERATIONS.LINKED_WORK_AVAILABLE')
    );
  }

  protected memberName(userId: string | undefined, displayName?: string): string {
    const member = this.membersQuery.data()?.members.find((candidate) => candidate.userId === userId);
    const fallbackKey = userId
      ? 'IDENTITY.CABINET_OPERATIONS.ASSIGNED_MEMBER'
      : 'IDENTITY.CABINET_OPERATIONS.UNASSIGNED';
    return displayName?.trim() || userDisplayLabel(member, this.transloco.translate(fallbackKey));
  }

  protected deadlineStatusKey = deadlineStatusKey;
  protected deadlineStatusTone = deadlineStatusTone;
  protected deadlineTransitionKey = deadlineTransitionKey;
  protected deadlineTypeKey = deadlineTypeKey;
  protected isDeadlineOverdue = isDeadlineOverdue;
  protected priorityKey = priorityKey;
  protected priorityTone = priorityTone;

  private openDialog(
    options: { mode: 'create' } | { deadline: CabinetDeadline; mode: 'edit' | 'view' }
  ): void {
    firstValueFrom(
      this.dialog
        .open(CabinetDeadlineDialogComponent, {
          data: {
            dossiers: this.activeDossiers(),
            members: this.eligibleMembers(),
            works: this.worksQuery.data()?.works ?? [],
            ...options
          },
          maxWidth: 'calc(100vw - 32px)',
          panelClass: 'liass-dialog-panel',
          restoreFocus: true,
          width: '760px'
        })
        .afterClosed()
    ).then((result: CabinetDeadlineDialogResult | undefined) => {
      if (!result) return;
      const operation =
        result.mode === 'create'
          ? () => this.api.createDeadline(result.payload)
          : () => this.api.updateDeadline(result.payload);
      void this.runMutation(
        result.mode === 'edit' ? result.payload.deadlineId : null,
        operation,
        result.mode === 'create'
          ? 'IDENTITY.CABINET_OPERATIONS.NOTIFICATIONS.DEADLINE_CREATED'
          : 'IDENTITY.CABINET_OPERATIONS.NOTIFICATIONS.DEADLINE_UPDATED'
      );
    });
  }

  private async runMutation(
    id: string | null,
    operation: () => Promise<CabinetDeadline>,
    successKey: string
  ): Promise<void> {
    this.mutatingId.set(id);
    this.actionErrorKey.set(null);
    try {
      const deadline = await operation();
      await Promise.all([
        this.queryClient.invalidateQueries({ queryKey: this.queries.deadlinesRoot() }),
        this.queryClient.invalidateQueries({
          queryKey: ['cabinet-operations', this.queries.scope(), 'deadlines', deadline.deadlineId]
        })
      ]);
      this.notification.success(this.transloco.translate(successKey));
    } catch (error) {
      this.actionErrorKey.set(
        cabinetOperationsErrorKey(
          error,
          'IDENTITY.CABINET_OPERATIONS.ERRORS.DEADLINE_MUTATION_FAILED'
        )
      );
      await this.queryClient.invalidateQueries({ queryKey: this.queries.deadlinesRoot() });
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

function priorityFilter(value: DeadlineFilterPriority): CabinetPriority | undefined {
  return value === 'ALL' ? undefined : value;
}

function deadlineStatusFilter(value: DeadlineFilterStatus): CabinetDeadlineStatus | undefined {
  return value === 'ALL' ? undefined : value;
}

function deadlineTypeFilter(value: DeadlineFilterType): CabinetDeadlineType | undefined {
  return value === 'ALL' ? undefined : value;
}
