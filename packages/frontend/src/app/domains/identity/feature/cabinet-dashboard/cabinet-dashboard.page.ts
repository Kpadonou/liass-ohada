import { Component, OnInit, inject } from '@angular/core';
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
}
