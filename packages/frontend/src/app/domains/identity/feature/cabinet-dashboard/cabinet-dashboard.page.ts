import { Component, OnInit, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import type { CabinetDossierSummary } from '@liass-ohada/shared';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatCardComponent, type LiassStatTone } from '../../../../shared/ui/stat-card/stat-card.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { AuthStore } from '../../data-access/auth.store';

interface CabinetMetricCard {
  icon: string;
  labelKey: string;
  metaKey: string;
  tone: LiassStatTone;
  value: string;
}

@Component({
  selector: 'liass-cabinet-dashboard-page',
  imports: [
    LiassButtonComponent,
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    LiassStatCardComponent,
    LiassStatusChipComponent,
    MatIconModule,
    MatProgressSpinnerModule,
    TranslocoModule
  ],
  templateUrl: './cabinet-dashboard.page.html'
})
export class CabinetDashboardPage implements OnInit {
  protected readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  protected readonly recentDossiers = computed(() =>
    [...this.authStore.dossiers()]
      .sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt))
      .slice(0, 4)
  );
  protected readonly activeDossierCount = computed(
    () => this.authStore.dossiers().filter((dossier) => dossier.status === 'ACTIVE').length
  );
  protected readonly currentUserLabel = computed(
    () => this.authStore.currentUserDisplayName() ?? this.authStore.currentUserEmail()
  );
  protected readonly metricCards = computed<CabinetMetricCard[]>(() => [
    {
      icon: 'folder_managed',
      labelKey: 'IDENTITY.CABINET_DASHBOARD.METRICS.TOTAL_DOSSIERS',
      metaKey: 'IDENTITY.CABINET_DASHBOARD.METRICS_META.TOTAL_DOSSIERS',
      tone: 'accent',
      value: `${this.authStore.dossiers().length}`
    },
    {
      icon: 'verified',
      labelKey: 'IDENTITY.CABINET_DASHBOARD.METRICS.ACTIVE_DOSSIERS',
      metaKey: 'IDENTITY.CABINET_DASHBOARD.METRICS_META.ACTIVE_DOSSIERS',
      tone: 'success',
      value: `${this.activeDossierCount()}`
    },
    {
      icon: 'event_upcoming',
      labelKey: 'IDENTITY.CABINET_DASHBOARD.METRICS.UPCOMING_DEADLINES',
      metaKey: 'IDENTITY.CABINET_DASHBOARD.METRICS_META.UPCOMING_DEADLINES',
      tone: 'warning',
      value: '0'
    },
    {
      icon: 'task_alt',
      labelKey: 'IDENTITY.CABINET_DASHBOARD.METRICS.PENDING_TASKS',
      metaKey: 'IDENTITY.CABINET_DASHBOARD.METRICS_META.PENDING_TASKS',
      tone: 'info',
      value: '0'
    },
    {
      icon: 'group',
      labelKey: 'IDENTITY.CABINET_DASHBOARD.METRICS.COLLABORATORS',
      metaKey: 'IDENTITY.CABINET_DASHBOARD.METRICS_META.COLLABORATORS',
      tone: 'neutral',
      value: '1'
    }
  ]);

  async ngOnInit(): Promise<void> {
    if (!this.authStore.dossiersLoaded()) {
      await this.authStore.loadDossiers();
    }
  }

  protected async createDossier(): Promise<void> {
    await this.router.navigate(['/cabinet/dossiers'], {
      queryParams: { createDossier: '1' }
    });
  }

  protected async selectDossier(dossier: CabinetDossierSummary): Promise<void> {
    if (this.authStore.dossierLoading()) {
      return;
    }

    const opened = await this.authStore.openDossier(dossier.orgId);
    if (opened) {
      await this.router.navigate(['/dashboard'], { replaceUrl: true });
    }
  }

  protected async openDossiers(): Promise<void> {
    await this.router.navigate(['/cabinet/dossiers']);
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
