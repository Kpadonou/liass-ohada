import { Component, computed, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassCardComponent } from '../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { LiassSectionContainerComponent } from '../../../shared/ui/section-container/section-container.component';
import { LiassSkeletonComponent } from '../../../shared/ui/skeleton/skeleton.component';
import { LiassStatCardComponent } from '../../../shared/ui/stat-card/stat-card.component';
import { LiassStatusChipComponent, type LiassStatusTone } from '../../../shared/ui/status-chip/status-chip.component';
import {
  LiassTablePlaceholderComponent,
  type LiassTableColumn,
  type LiassTableRow,
  type LiassTableState
} from '../../../shared/ui/table-placeholder/table-placeholder.component';

type DashboardFocus = 'accounting' | 'projects' | 'treasury' | 'reports';

const sectionSummaryKeys: Record<DashboardFocus, string> = {
  accounting: 'DASHBOARD.SECTIONS.ACCOUNTING.SUMMARY',
  projects: 'DASHBOARD.SECTIONS.PROJECTS.SUMMARY',
  treasury: 'DASHBOARD.SECTIONS.TREASURY.SUMMARY',
  reports: 'DASHBOARD.SECTIONS.REPORTS.SUMMARY'
};

@Component({
  selector: 'liass-dashboard-page',
  imports: [
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSectionContainerComponent,
    LiassSkeletonComponent,
    LiassStatCardComponent,
    LiassStatusChipComponent,
    LiassTablePlaceholderComponent,
    MatIconModule,
    TranslocoModule
  ],
  templateUrl: './dashboard.page.html'
})
export class DashboardPage {
  private readonly dashboardFocus = signal<DashboardFocus>('accounting');

  protected readonly activeSectionSummaryKey = computed(
    () => sectionSummaryKeys[this.dashboardFocus()]
  );
  protected readonly activityColumns: readonly LiassTableColumn[] = [
    {
      key: 'item',
      labelKey: 'DASHBOARD.ACTIVITY.COLUMNS.ITEM'
    },
    {
      key: 'domain',
      labelKey: 'DASHBOARD.ACTIVITY.COLUMNS.DOMAIN'
    },
    {
      key: 'owner',
      labelKey: 'DASHBOARD.ACTIVITY.COLUMNS.OWNER'
    },
    {
      key: 'status',
      labelKey: 'DASHBOARD.ACTIVITY.COLUMNS.STATUS'
    }
  ];
  protected readonly activityState: LiassTableState = 'default';
  protected readonly chartLoading = false;

  protected readonly activityRows: readonly LiassTableRow[] = [
    {
      id: 'opening-balance',
      cells: {
        domain: { valueKey: 'DASHBOARD.ACTIVITY.ROWS.OPENING.DOMAIN' },
        item: { emphasis: true, valueKey: 'DASHBOARD.ACTIVITY.ROWS.OPENING.ITEM' },
        owner: { valueKey: 'DASHBOARD.ACTIVITY.ROWS.OPENING.OWNER' },
        status: { tone: 'success', valueKey: 'DASHBOARD.ACTIVITY.ROWS.OPENING.STATUS' }
      }
    },
    {
      id: 'project-funding',
      cells: {
        domain: { valueKey: 'DASHBOARD.ACTIVITY.ROWS.PROJECT.DOMAIN' },
        item: { emphasis: true, valueKey: 'DASHBOARD.ACTIVITY.ROWS.PROJECT.ITEM' },
        owner: { valueKey: 'DASHBOARD.ACTIVITY.ROWS.PROJECT.OWNER' },
        status: { tone: 'info', valueKey: 'DASHBOARD.ACTIVITY.ROWS.PROJECT.STATUS' }
      }
    },
    {
      id: 'bank-close',
      cells: {
        domain: { valueKey: 'DASHBOARD.ACTIVITY.ROWS.BANK.DOMAIN' },
        item: { emphasis: true, valueKey: 'DASHBOARD.ACTIVITY.ROWS.BANK.ITEM' },
        owner: { valueKey: 'DASHBOARD.ACTIVITY.ROWS.BANK.OWNER' },
        status: { tone: 'warning', valueKey: 'DASHBOARD.ACTIVITY.ROWS.BANK.STATUS' }
      }
    }
  ];

  protected readonly quickActions = [
    {
      descriptionKey: 'DASHBOARD.QUICK_ACTIONS.ITEMS.ENTRY.DESCRIPTION',
      icon: 'post_add',
      labelKey: 'DASHBOARD.QUICK_ACTIONS.ITEMS.ENTRY.LABEL',
      focus: 'accounting'
    },
    {
      descriptionKey: 'DASHBOARD.QUICK_ACTIONS.ITEMS.PROJECT.DESCRIPTION',
      icon: 'topic',
      labelKey: 'DASHBOARD.QUICK_ACTIONS.ITEMS.PROJECT.LABEL',
      focus: 'projects'
    },
    {
      descriptionKey: 'DASHBOARD.QUICK_ACTIONS.ITEMS.RECONCILIATION.DESCRIPTION',
      icon: 'account_balance_wallet',
      labelKey: 'DASHBOARD.QUICK_ACTIONS.ITEMS.RECONCILIATION.LABEL',
      focus: 'treasury'
    },
    {
      descriptionKey: 'DASHBOARD.QUICK_ACTIONS.ITEMS.REPORT.DESCRIPTION',
      icon: 'summarize',
      labelKey: 'DASHBOARD.QUICK_ACTIONS.ITEMS.REPORT.LABEL',
      focus: 'reports'
    }
  ] satisfies readonly {
    descriptionKey: string;
    focus: DashboardFocus;
    icon: string;
    labelKey: string;
  }[];

  protected readonly suggestions = [
    {
      descriptionKey: 'DASHBOARD.AI_SUGGESTIONS.ITEMS.CLOSING.DESCRIPTION',
      labelKey: 'DASHBOARD.AI_SUGGESTIONS.ITEMS.CLOSING.LABEL',
      tone: 'success'
    },
    {
      descriptionKey: 'DASHBOARD.AI_SUGGESTIONS.ITEMS.GRANT.DESCRIPTION',
      labelKey: 'DASHBOARD.AI_SUGGESTIONS.ITEMS.GRANT.LABEL',
      tone: 'info'
    },
    {
      descriptionKey: 'DASHBOARD.AI_SUGGESTIONS.ITEMS.RISK.DESCRIPTION',
      labelKey: 'DASHBOARD.AI_SUGGESTIONS.ITEMS.RISK.LABEL',
      tone: 'warning'
    }
  ] satisfies readonly {
    descriptionKey: string;
    labelKey: string;
    tone: LiassStatusTone;
  }[];

  protected setDashboardFocus(focus: DashboardFocus): void {
    this.dashboardFocus.set(focus);
  }
}
