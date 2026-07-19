import { Component, OnInit, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import type { CabinetDossierSummary } from '@liass-ohada/shared/shared';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { AuthStore } from '../../data-access/auth.store';

@Component({
  selector: 'liass-cabinet-dossier-select-page',
  imports: [LiassButtonComponent, MatIconModule, MatProgressSpinnerModule, TranslocoModule],
  templateUrl: './cabinet-dossier-select.page.html'
})
export class CabinetDossierSelectPage implements OnInit {
  protected readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);

  async ngOnInit(): Promise<void> {
    if (!this.authStore.dossiersLoaded()) {
      await this.authStore.loadDossiers();
    }
  }

  protected async selectDossier(dossier: CabinetDossierSummary): Promise<void> {
    if (this.authStore.dossierLoading() || this.authStore.dossierOpening()) {
      return;
    }

    const opened = await this.authStore.openDossier(dossier.orgId);
    if (opened) {
      await this.router.navigate(['/dashboard'], { replaceUrl: true });
    }
  }

  protected async createDossier(): Promise<void> {
    await this.router.navigate(['/cabinet/dossiers'], {
      queryParams: { createDossier: '1' }
    });
  }
}
