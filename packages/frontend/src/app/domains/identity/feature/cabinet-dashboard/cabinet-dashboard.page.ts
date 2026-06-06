import { Component, OnInit, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import type { CabinetDossierSummary } from '@liass-ohada/shared';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { AuthStore } from '../../data-access/auth.store';

@Component({
  selector: 'liass-cabinet-dashboard-page',
  imports: [LiassButtonComponent, MatIconModule, MatProgressSpinnerModule, TranslocoModule],
  templateUrl: './cabinet-dashboard.page.html'
})
export class CabinetDashboardPage implements OnInit {
  protected readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  protected readonly recentDossiers = computed(() => this.authStore.dossiers().slice(0, 3));
  protected readonly activeDossierCount = computed(
    () => this.authStore.dossiers().filter((dossier) => dossier.status === 'ACTIVE').length
  );
  protected readonly currentUserLabel = computed(
    () => this.authStore.currentUserDisplayName() ?? this.authStore.currentUserEmail()
  );
  protected readonly metricCards = computed(() => [
    {
      icon: 'folder_managed',
      labelKey: 'IDENTITY.CABINET_DASHBOARD.METRICS.TOTAL_DOSSIERS',
      value: `${this.authStore.dossiers().length}`
    },
    {
      icon: 'verified',
      labelKey: 'IDENTITY.CABINET_DASHBOARD.METRICS.ACTIVE_DOSSIERS',
      value: `${this.activeDossierCount()}`
    },
    {
      icon: 'event_upcoming',
      labelKey: 'IDENTITY.CABINET_DASHBOARD.METRICS.UPCOMING_DEADLINES',
      value: '0'
    },
    {
      icon: 'task_alt',
      labelKey: 'IDENTITY.CABINET_DASHBOARD.METRICS.PENDING_TASKS',
      value: '0'
    },
    {
      icon: 'group',
      labelKey: 'IDENTITY.CABINET_DASHBOARD.METRICS.COLLABORATORS',
      value: '1'
    }
  ]);

  async ngOnInit(): Promise<void> {
    if (!this.authStore.dossiersLoaded()) {
      await this.authStore.loadDossiers();
    }
  }

  protected async createDossier(): Promise<void> {
    await this.router.navigate(['/cabinet/dossiers/new']);
  }

  protected async selectDossier(dossier: CabinetDossierSummary): Promise<void> {
    if (this.authStore.dossierLoading()) {
      return;
    }

    this.authStore.setActiveDossier(dossier.orgId);
    await this.router.navigate(['/dashboard'], { replaceUrl: true });
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
