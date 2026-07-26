import { Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import type { CabinetDashboardResponse, CabinetDashboardScope } from '@liass-ohada/shared/shared';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import {
  LiassStatCardComponent,
  type LiassStatTone
} from '../../../../shared/ui/stat-card/stat-card.component';
import {
  LiassStatusChipComponent,
  type LiassStatusTone
} from '../../../../shared/ui/status-chip/status-chip.component';
import { AuthStore } from '../../data-access/auth.store';
import { CabinetDashboardQueries } from '../../data-access/cabinet-dashboard.queries';
import { CabinetOperationsCapabilities } from '../../data-access/cabinet-operations-capabilities';
import { backendErrorCode } from '../cabinet-team/cabinet-team.presentation';
import {
  deadlineTypeKey,
  priorityKey,
  priorityTone,
  userDisplayLabel,
  workTypeKey
} from '../cabinet-operations/cabinet-operations.presentation';

type WorkAttentionItem = CabinetDashboardResponse['attention']['overdueWorks'][number];
type DeadlineAttentionItem = CabinetDashboardResponse['attention']['overdueDeadlines'][number];

interface MetricCard {
  icon: string;
  labelKey: string;
  metaKey: string;
  tone: LiassStatTone;
  value: string;
}

interface SummaryRow {
  icon: string;
  labelKey: string;
  tone: LiassStatusTone;
  value: number;
}

interface DashboardErrorState {
  descriptionKey: string;
  titleKey: string;
  variant: 'generic' | 'limit';
}

@Component({
  selector: 'liass-cabinet-dashboard-page',
  imports: [
    LiassButtonComponent,
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassStatCardComponent,
    LiassStatusChipComponent,
    MatIconModule,
    TranslocoModule
  ],
  templateUrl: './cabinet-dashboard.page.html'
})
export class CabinetDashboardPage {
  protected readonly authStore = inject(AuthStore);
  protected readonly capabilities = inject(CabinetOperationsCapabilities);
  private readonly dashboardQueries = inject(CabinetDashboardQueries);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  protected readonly dashboardQuery = injectQuery(() => this.dashboardQueries.detail());
  protected readonly dashboard = computed(() => this.dashboardQuery.data() ?? null);
  protected readonly errorState = computed<DashboardErrorState>(() => {
    const code = backendErrorCode(this.dashboardQuery.error());
    if (code === 'CABINET_DASHBOARD_AGGREGATION_LIMIT_EXCEEDED') {
      return {
        descriptionKey: 'IDENTITY.CABINET_DASHBOARD.ERRORS.AGGREGATION_LIMIT_DESCRIPTION',
        titleKey: 'IDENTITY.CABINET_DASHBOARD.ERRORS.AGGREGATION_LIMIT_TITLE',
        variant: 'limit'
      };
    }
    return {
      descriptionKey: 'IDENTITY.CABINET_DASHBOARD.ERRORS.LOAD_DESCRIPTION',
      titleKey: 'IDENTITY.CABINET_DASHBOARD.ERRORS.LOAD_TITLE',
      variant: 'generic'
    };
  });
  protected readonly canCreateWork = computed(() => this.capabilities.canCreateCabinetWork());
  protected readonly canCreateDeadline = computed(() =>
    this.capabilities.canCreateCabinetDeadline()
  );

  protected readonly metricCards = computed<MetricCard[]>(() => {
    const dashboard = this.dashboard();
    if (!dashboard) return [];

    const portfolioKey =
      dashboard.scope === 'SUPERVISED_DOSSIERS'
        ? 'SUPERVISED_DOSSIERS'
        : dashboard.scope === 'CABINET'
          ? 'ACTIVE_DOSSIERS'
          : 'ACCESSIBLE_DOSSIERS';
    const personal = dashboard.scope === 'PERSONAL_ACTIVITY';

    return [
      {
        icon: portfolioKey === 'ACTIVE_DOSSIERS' ? 'folder_managed' : 'folder_shared',
        labelKey: `IDENTITY.CABINET_DASHBOARD.METRICS.${portfolioKey}`,
        metaKey: `IDENTITY.CABINET_DASHBOARD.METRICS_META.${portfolioKey}`,
        tone: 'accent',
        value:
          portfolioKey === 'ACCESSIBLE_DOSSIERS'
            ? `${dashboard.portfolio.accessibleDossiers}`
            : `${dashboard.portfolio.activeDossiers}`
      },
      {
        icon: 'task_alt',
        labelKey: personal
          ? 'IDENTITY.CABINET_DASHBOARD.METRICS.MY_ACTIVE_WORK'
          : 'IDENTITY.CABINET_DASHBOARD.METRICS.ACTIVE_WORK',
        metaKey: personal
          ? 'IDENTITY.CABINET_DASHBOARD.METRICS_META.MY_ACTIVE_WORK'
          : 'IDENTITY.CABINET_DASHBOARD.METRICS_META.ACTIVE_WORK',
        tone: 'info',
        value: `${dashboard.work.totalActive}`
      },
      {
        icon: 'priority_high',
        labelKey: personal
          ? 'IDENTITY.CABINET_DASHBOARD.METRICS.MY_OVERDUE_WORK'
          : 'IDENTITY.CABINET_DASHBOARD.METRICS.OVERDUE_WORK',
        metaKey: personal
          ? 'IDENTITY.CABINET_DASHBOARD.METRICS_META.MY_OVERDUE_WORK'
          : 'IDENTITY.CABINET_DASHBOARD.METRICS_META.OVERDUE_WORK',
        tone: dashboard.work.overdue > 0 ? 'danger' : 'success',
        value: `${dashboard.work.overdue}`
      },
      {
        icon: 'event_busy',
        labelKey: personal
          ? 'IDENTITY.CABINET_DASHBOARD.METRICS.MY_OVERDUE_DEADLINES'
          : 'IDENTITY.CABINET_DASHBOARD.METRICS.OVERDUE_DEADLINES',
        metaKey: personal
          ? 'IDENTITY.CABINET_DASHBOARD.METRICS_META.MY_OVERDUE_DEADLINES'
          : 'IDENTITY.CABINET_DASHBOARD.METRICS_META.OVERDUE_DEADLINES',
        tone: dashboard.deadlines.overdue > 0 ? 'danger' : 'success',
        value: `${dashboard.deadlines.overdue}`
      }
    ];
  });

  protected workRows(dashboard: CabinetDashboardResponse): SummaryRow[] {
    const rows: SummaryRow[] = [
      {
        icon: 'pending_actions',
        labelKey: 'IDENTITY.CABINET_DASHBOARD.WORK.TO_PLAN',
        tone: 'neutral',
        value: dashboard.work.toPlan
      },
      {
        icon: 'checklist',
        labelKey: 'IDENTITY.CABINET_DASHBOARD.WORK.TO_DO',
        tone: 'info',
        value: dashboard.work.toDo
      },
      {
        icon: 'play_circle',
        labelKey: 'IDENTITY.CABINET_DASHBOARD.WORK.IN_PROGRESS',
        tone: 'brand',
        value: dashboard.work.inProgress
      },
      {
        icon: 'hourglass_top',
        labelKey: 'IDENTITY.CABINET_DASHBOARD.WORK.WAITING',
        tone: 'warning',
        value: dashboard.work.waiting
      }
    ];

    if (dashboard.work.unassigned !== undefined) {
      rows.push({
        icon: 'person_off',
        labelKey: 'IDENTITY.CABINET_DASHBOARD.WORK.UNASSIGNED',
        tone: dashboard.work.unassigned > 0 ? 'warning' : 'neutral',
        value: dashboard.work.unassigned
      });
    }

    return rows;
  }

  protected deadlineRows(dashboard: CabinetDashboardResponse): SummaryRow[] {
    return [
      {
        icon: 'event_busy',
        labelKey: 'IDENTITY.CABINET_DASHBOARD.DEADLINES.OVERDUE',
        tone: dashboard.deadlines.overdue > 0 ? 'danger' : 'success',
        value: dashboard.deadlines.overdue
      },
      {
        icon: 'today',
        labelKey: 'IDENTITY.CABINET_DASHBOARD.DEADLINES.TODAY',
        tone: dashboard.deadlines.dueToday > 0 ? 'warning' : 'neutral',
        value: dashboard.deadlines.dueToday
      },
      {
        icon: 'date_range',
        labelKey: 'IDENTITY.CABINET_DASHBOARD.DEADLINES.NEXT_7_DAYS',
        tone: 'info',
        value: dashboard.deadlines.next7Days
      },
      {
        icon: 'calendar_month',
        labelKey: 'IDENTITY.CABINET_DASHBOARD.DEADLINES.DAYS_8_30',
        tone: 'neutral',
        value: dashboard.deadlines.next30Days
      }
    ];
  }

  protected teamRows(dashboard: CabinetDashboardResponse): SummaryRow[] {
    if (!dashboard.team) return [];
    const rows: SummaryRow[] = [
      {
        icon: 'admin_panel_settings',
        labelKey: 'IDENTITY.CABINET_DASHBOARD.TEAM.ADMINISTRATORS',
        tone: 'brand',
        value: dashboard.team.administrators
      },
      {
        icon: 'supervisor_account',
        labelKey: 'IDENTITY.CABINET_DASHBOARD.TEAM.SUPERVISORS',
        tone: 'info',
        value: dashboard.team.supervisors
      },
      {
        icon: 'groups',
        labelKey: 'IDENTITY.CABINET_DASHBOARD.TEAM.COLLABORATORS',
        tone: 'neutral',
        value: dashboard.team.collaborators
      },
      {
        icon: 'visibility',
        labelKey: 'IDENTITY.CABINET_DASHBOARD.TEAM.READERS',
        tone: 'neutral',
        value: dashboard.team.readers
      }
    ];

    if (dashboard.team.pendingInvitations !== undefined) {
      rows.push({
        icon: 'mail',
        labelKey: 'IDENTITY.CABINET_DASHBOARD.TEAM.PENDING_INVITATIONS',
        tone: dashboard.team.pendingInvitations > 0 ? 'warning' : 'neutral',
        value: dashboard.team.pendingInvitations
      });
    }

    return rows;
  }

  protected scopeLabelKey(scope: CabinetDashboardScope): string {
    return `IDENTITY.CABINET_DASHBOARD.SCOPE.${scope}`;
  }

  protected subtitleKey(scope: CabinetDashboardScope): string {
    return `IDENTITY.CABINET_DASHBOARD.SUBTITLE.${scope}`;
  }

  protected portfolioTitleKey(scope: CabinetDashboardScope): string {
    return scope === 'CABINET'
      ? 'IDENTITY.CABINET_DASHBOARD.PORTFOLIO.TITLE_CABINET'
      : 'IDENTITY.CABINET_DASHBOARD.PORTFOLIO.TITLE_SCOPED';
  }

  protected emptyTitleKey(scope: CabinetDashboardScope): string {
    return scope === 'CABINET'
      ? 'IDENTITY.CABINET_DASHBOARD.EMPTY.CABINET_TITLE'
      : 'IDENTITY.CABINET_DASHBOARD.EMPTY.SCOPED_TITLE';
  }

  protected emptyDescriptionKey(scope: CabinetDashboardScope): string {
    return scope === 'CABINET'
      ? 'IDENTITY.CABINET_DASHBOARD.EMPTY.CABINET_DESCRIPTION'
      : 'IDENTITY.CABINET_DASHBOARD.EMPTY.SCOPED_DESCRIPTION';
  }

  protected isEmptyDashboard(dashboard: CabinetDashboardResponse): boolean {
    return (
      dashboard.portfolio.activeDossiers === 0 &&
      dashboard.portfolio.accessibleDossiers === 0 &&
      dashboard.work.totalActive === 0 &&
      dashboard.work.toPlan === 0 &&
      dashboard.work.toDo === 0 &&
      dashboard.work.inProgress === 0 &&
      dashboard.work.waiting === 0 &&
      dashboard.work.overdue === 0 &&
      dashboard.work.dueSoon === 0 &&
      dashboard.deadlines.pending === 0 &&
      dashboard.deadlines.overdue === 0 &&
      dashboard.deadlines.dueToday === 0 &&
      dashboard.deadlines.next7Days === 0 &&
      dashboard.deadlines.next30Days === 0
    );
  }

  protected hasOverdueAttention(dashboard: CabinetDashboardResponse): boolean {
    return (
      dashboard.work.overdue > 0 ||
      dashboard.deadlines.overdue > 0 ||
      dashboard.attention.overdueWorks.length > 0 ||
      dashboard.attention.overdueDeadlines.length > 0
    );
  }

  protected responsibleName(item: WorkAttentionItem | DeadlineAttentionItem): string {
    return (
      item.responsibleDisplayName?.trim() ||
      userDisplayLabel(null, this.transloco.translate('IDENTITY.CABINET_OPERATIONS.UNASSIGNED'))
    );
  }

  protected dossierName(item: WorkAttentionItem | DeadlineAttentionItem): string {
    return (
      item.dossierName?.trim() ||
      this.transloco.translate('IDENTITY.CABINET_OPERATIONS.UNKNOWN_DOSSIER')
    );
  }

  protected dateLabel(value: string): string {
    return formatDateOnly(value, this.transloco.getActiveLang());
  }

  protected dateBadge(value: string, asOfDate: string): string {
    if (value === asOfDate) {
      return this.transloco.translate('IDENTITY.CABINET_DASHBOARD.DATE.TODAY');
    }
    if (value === nextDateOnly(asOfDate)) {
      return this.transloco.translate('IDENTITY.CABINET_DASHBOARD.DATE.TOMORROW');
    }
    return formatDateOnly(value, this.transloco.getActiveLang(), 'short');
  }

  protected snapshotLabel(dashboard: CabinetDashboardResponse): string {
    return this.transloco.translate('IDENTITY.CABINET_DASHBOARD.SNAPSHOT', {
      date: this.dateLabel(dashboard.asOfDate),
      time: new Intl.DateTimeFormat(this.transloco.getActiveLang(), {
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(dashboard.generatedAt))
    });
  }

  protected readonly workTypeKey = workTypeKey;
  protected readonly deadlineTypeKey = deadlineTypeKey;
  protected readonly priorityKey = priorityKey;
  protected readonly priorityTone = priorityTone;

  protected retry(): void {
    void this.dashboardQuery.refetch();
  }

  protected openDossiers(): void {
    void this.router.navigate(['/cabinet/dossiers']);
  }

  protected openTeam(): void {
    void this.router.navigate(['/cabinet/team']);
  }

  protected openWorks(): void {
    void this.router.navigate(['/cabinet/works']);
  }

  protected openDeadlines(): void {
    void this.router.navigate(['/cabinet/deadlines']);
  }
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDateOnly(
  value: string,
  locale: string,
  month: 'numeric' | 'short' = 'numeric'
): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month,
    year: month === 'short' ? undefined : 'numeric'
  }).format(parseDateOnly(value));
}

function nextDateOnly(value: string): string {
  const date = parseDateOnly(value);
  date.setDate(date.getDate() + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
