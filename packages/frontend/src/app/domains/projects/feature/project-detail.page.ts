import { Component, computed, inject, signal } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTabsModule } from '@angular/material/tabs';
import { ActivatedRoute, Router } from '@angular/router';
import {
  type BudgetLineDto,
  type FundingSourceDto,
  type ProjectDto
} from '@liass-ohada/shared/projects';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { take } from 'rxjs';

import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../shared/ui/skeleton/skeleton.component';
import { LiassStatCardComponent } from '../../../shared/ui/stat-card/stat-card.component';
import { LiassStatusChipComponent, type LiassStatusTone } from '../../../shared/ui/status-chip/status-chip.component';
import { ProjectQueries } from '../data-access/project-queries';
import { CreateBudgetLineDialogComponent } from './create-budget-line-dialog.component';
import { CreateFundingSourceDialogComponent } from './create-funding-source-dialog.component';

@Component({
  selector: 'liass-project-detail-page',
  imports: [
    LiassButtonComponent,
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    LiassStatCardComponent,
    LiassStatusChipComponent,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTabsModule,
    TranslocoModule
  ],
  templateUrl: './project-detail.page.html'
})
export class ProjectDetailPage {
  private readonly dialog = inject(MatDialog);
  private readonly projectQueries = inject(ProjectQueries);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly projectId = this.route.snapshot.paramMap.get('projectId') ?? '';
  protected readonly selectedYear = signal(String(new Date().getFullYear()));

  protected readonly projectQuery = injectQuery(() => this.projectQueries.getProject(this.projectId));
  protected readonly donorsQuery = injectQuery(() => this.projectQueries.listDonors());
  protected readonly fundingSourcesQuery = injectQuery(() =>
    this.projectQueries.listFundingSources(this.projectId)
  );
  protected readonly budgetLinesQuery = injectQuery(() =>
    this.projectQueries.listBudgetLines(this.projectId, this.selectedYear())
  );
  protected readonly reportQuery = injectQuery(() =>
    this.projectQueries.getProjectReport(this.projectId, this.selectedYear())
  );

  protected readonly project = computed(() => this.projectQuery.data());
  protected readonly fundingSources = computed(() => this.fundingSourcesQuery.data() ?? []);
  protected readonly budgetLines = computed(() => this.budgetLinesQuery.data() ?? []);
  protected readonly report = computed(() => this.reportQuery.data());
  protected readonly fundingTotal = computed(() =>
    this.fundingSources().reduce((sum, source) => sum + source.amount, 0)
  );
  protected readonly budgetTotal = computed(() =>
    this.budgetLines().reduce((sum, line) => sum + line.amount, 0)
  );

  protected updateYear(event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    if (/^\d{4}$/.test(value)) {
      this.selectedYear.set(value);
    }
  }

  protected donorName(donorId: string): string {
    const donor = this.donorsQuery.data()?.find((item) => item.donorId === donorId);
    return donor ? `${donor.code} - ${donor.name}` : donorId;
  }

  protected statusTone(status: ProjectDto['status']): LiassStatusTone {
    const tones: Record<ProjectDto['status'], LiassStatusTone> = {
      ACTIVE: 'success',
      CANCELLED: 'danger',
      COMPLETED: 'info',
      ON_HOLD: 'warning'
    };

    return tones[status];
  }

  protected formatAmount(amount: number, currency = 'XOF'): string {
    return new Intl.NumberFormat('fr-FR', {
      maximumFractionDigits: 0,
      style: 'currency',
      currency
    }).format(amount);
  }

  protected formatRate(rate: number): string {
    return `${Math.round(rate)}%`;
  }

  protected async backToProjects(): Promise<void> {
    await this.router.navigate(['/projects']);
  }

  protected openCreateFundingSource(): void {
    const dialogRef = this.dialog.open(CreateFundingSourceDialogComponent, {
      autoFocus: 'first-tabbable',
      data: {
        donors: this.donorsQuery.data() ?? [],
        projectId: this.projectId
      },
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '680px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((source: FundingSourceDto | null | undefined) => {
      if (source) {
        void this.fundingSourcesQuery.refetch();
        void this.reportQuery.refetch();
      }
    });
  }

  protected openCreateBudgetLine(): void {
    const dialogRef = this.dialog.open(CreateBudgetLineDialogComponent, {
      autoFocus: 'first-tabbable',
      data: {
        projectId: this.projectId,
        year: this.selectedYear()
      },
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '680px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((line: BudgetLineDto | null | undefined) => {
      if (line) {
        void this.budgetLinesQuery.refetch();
        void this.reportQuery.refetch();
      }
    });
  }
}
