import { Component, OnInit, inject } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';

@Component({
  selector: 'liass-cabinet-dossier-new-page',
  imports: [MatProgressSpinnerModule, TranslocoModule],
  templateUrl: './cabinet-dossier-new.page.html'
})
export class CabinetDossierNewPage implements OnInit {
  private readonly router = inject(Router);

  async ngOnInit(): Promise<void> {
    await this.router.navigate(['/cabinet/dossiers'], {
      queryParams: { createDossier: '1' },
      replaceUrl: true
    });
  }
}
