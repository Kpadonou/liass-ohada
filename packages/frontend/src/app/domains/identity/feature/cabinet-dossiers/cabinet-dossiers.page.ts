import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router } from '@angular/router';
import type { CabinetDossierSummary } from '@liass-ohada/shared';
import { TranslocoModule } from '@ngneat/transloco';
import { take } from 'rxjs';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { AuthStore } from '../../data-access/auth.store';
import { CreateCabinetDossierDialogComponent } from './create-cabinet-dossier-dialog.component';

type DossierStatusFilter = 'ALL' | 'ACTIVE';

@Component({
  selector: 'liass-cabinet-dossiers-page',
  imports: [
    LiassButtonComponent,
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    LiassStatusChipComponent,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    TranslocoModule
  ],
  templateUrl: './cabinet-dossiers.page.html'
})
export class CabinetDossiersPage implements OnInit {
  protected readonly authStore = inject(AuthStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly searchQuery = signal('');
  protected readonly statusFilter = signal<DossierStatusFilter>('ALL');
  protected readonly activeDossiers = computed(
    () => this.authStore.dossiers().filter((dossier) => dossier.status === 'ACTIVE').length
  );
  protected readonly filteredDossiers = computed(() => {
    const query = normalizeSearch(this.searchQuery());
    const status = this.statusFilter();

    return this.authStore.dossiers().filter((dossier) => {
      const matchesStatus = status === 'ALL' || dossier.status === status;
      const searchableValue = normalizeSearch(
        `${dossier.displayName} ${dossier.country} ${dossier.accountingFramework} ${dossier.status}`
      );
      const matchesQuery = query.length === 0 || searchableValue.includes(query);

      return matchesStatus && matchesQuery;
    });
  });
  protected readonly hasFilters = computed(
    () => this.searchQuery().trim().length > 0 || this.statusFilter() !== 'ALL'
  );
  private createDialogOpen = false;

  async ngOnInit(): Promise<void> {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      if (params.get('createDossier') === '1') {
        this.openCreateDossierDialog({ clearDeepLink: true });
      }
    });

    if (!this.authStore.dossiersLoaded()) {
      await this.authStore.loadDossiers();
    }
  }

  protected createDossier(): void {
    this.openCreateDossierDialog();
  }

  protected async selectDossier(dossier: CabinetDossierSummary): Promise<void> {
    if (this.authStore.dossierLoading()) {
      return;
    }

    this.authStore.setActiveDossier(dossier.orgId);
    await this.router.navigate(['/dashboard'], { replaceUrl: true });
  }

  protected updateSearch(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  protected clearFilters(): void {
    this.searchQuery.set('');
    this.statusFilter.set('ALL');
  }

  protected countryLabelKey(dossier: CabinetDossierSummary): string {
    return `IDENTITY.ONBOARDING.COUNTRIES.${countryTranslationCode(dossier.country)}`;
  }

  protected frameworkLabelKey(dossier: CabinetDossierSummary): string {
    return `IDENTITY.ONBOARDING.FRAMEWORKS.${dossier.accountingFramework}`;
  }

  protected statusLabelKey(dossier: CabinetDossierSummary): string {
    return `IDENTITY.CABINET_DASHBOARD.STATUS.${dossier.status ?? 'UNKNOWN'}`;
  }

  private openCreateDossierDialog(options: { clearDeepLink?: boolean } = {}): void {
    if (this.createDialogOpen) {
      return;
    }

    this.createDialogOpen = true;
    const dialogRef = this.dialog.open(CreateCabinetDossierDialogComponent, {
      autoFocus: 'first-tabbable',
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '560px'
    });

    dialogRef
      .afterClosed()
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.createDialogOpen = false;

        if (options.clearDeepLink) {
          void this.router.navigate([], {
            queryParams: { createDossier: null },
            queryParamsHandling: 'merge',
            relativeTo: this.route,
            replaceUrl: true
          });
        }
      });
  }
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function countryTranslationCode(country: string): string {
  const countryCodes: Record<string, string> = {
    BJ: 'BENIN',
    BF: 'BURKINA_FASO',
    CD: 'DEMOCRATIC_REPUBLIC_OF_CONGO',
    CF: 'CENTRAL_AFRICAN_REPUBLIC',
    CG: 'CONGO',
    CI: 'COTE_D_IVOIRE',
    CM: 'CAMEROON',
    GA: 'GABON',
    GN: 'GUINEA',
    GQ: 'EQUATORIAL_GUINEA',
    GW: 'GUINEA_BISSAU',
    KM: 'COMOROS',
    ML: 'MALI',
    NE: 'NIGER',
    SN: 'SENEGAL',
    TD: 'CHAD',
    TG: 'TOGO'
  };

  return countryCodes[country] ?? country;
}
