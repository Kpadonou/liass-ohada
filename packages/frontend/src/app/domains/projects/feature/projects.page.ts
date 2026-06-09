import { Component, computed, inject, signal } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { type DonorDto, type ProjectDto } from '@liass-ohada/shared/projects';
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
import { CreateDonorDialogComponent } from './create-donor-dialog.component';
import { CreateProjectDialogComponent } from './create-project-dialog.component';

type ProjectStatusFilter = 'ALL' | ProjectDto['status'];

@Component({
  selector: 'liass-projects-page',
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
    MatSelectModule,
    TranslocoModule
  ],
  templateUrl: './projects.page.html'
})
export class ProjectsPage {
  private readonly dialog = inject(MatDialog);
  private readonly projectQueries = inject(ProjectQueries);
  private readonly router = inject(Router);

  protected readonly currentYear = String(new Date().getFullYear());
  protected readonly donorFilter = signal('ALL');
  protected readonly searchQuery = signal('');
  protected readonly statusFilter = signal<ProjectStatusFilter>('ALL');

  protected readonly projectsQuery = injectQuery(() => this.projectQueries.listProjects());
  protected readonly donorsQuery = injectQuery(() => this.projectQueries.listDonors());
  protected readonly summaryQuery = injectQuery(() => this.projectQueries.getProjectsSummary(this.currentYear));

  protected readonly projects = computed(() => this.projectsQuery.data() ?? []);
  protected readonly donors = computed(() => this.donorsQuery.data() ?? []);
  protected readonly filteredProjects = computed(() => {
    const query = normalizeSearch(this.searchQuery());
    const donor = this.donorFilter();
    const status = this.statusFilter();

    return this.projects().filter((project) => {
      const matchesDonor = donor === 'ALL' || project.donorId === donor;
      const matchesStatus = status === 'ALL' || project.status === status;
      const searchable = normalizeSearch(`${project.projectCode} ${project.name} ${project.contractRef ?? ''}`);

      return matchesDonor && matchesStatus && (!query || searchable.includes(query));
    });
  });
  protected readonly totalBudget = computed(() =>
    this.projects().reduce((sum, project) => sum + project.totalBudget, 0)
  );
  protected readonly activeProjectsCount = computed(
    () => this.projects().filter((project) => project.status === 'ACTIVE').length
  );
  protected readonly alertsCount = computed(
    () =>
      this.summaryQuery.data()?.filter(
        (summary) =>
          summary.alerts.isCashNegative ||
          summary.alerts.isOverSpentAnnual ||
          summary.alerts.isOverSpentGlobal
      ).length ?? 0
  );

  protected updateSearch(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  protected donorName(donorId: string): string {
    const donor = this.donors().find((item) => item.donorId === donorId);
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

  protected openCreateDonor(): void {
    const dialogRef = this.dialog.open(CreateDonorDialogComponent, {
      autoFocus: 'first-tabbable',
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '720px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((donor: DonorDto | null | undefined) => {
      if (donor) {
        void this.donorsQuery.refetch();
      }
    });
  }

  protected openCreateProject(): void {
    const dialogRef = this.dialog.open(CreateProjectDialogComponent, {
      autoFocus: 'first-tabbable',
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '820px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((project: ProjectDto | null | undefined) => {
      if (project) {
        void this.projectsQuery.refetch();
        void this.summaryQuery.refetch();
      }
    });
  }

  protected async openProject(project: ProjectDto): Promise<void> {
    await this.router.navigate(['/projects', project.projectId]);
  }
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
