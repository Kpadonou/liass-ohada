import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';

import { AuthStore } from '../../data-access/auth.store';

@Component({
  selector: 'liass-auth-callback-page',
  imports: [TranslocoModule],
  templateUrl: './auth-callback.page.html'
})
export class AuthCallbackPage implements OnInit {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);

  async ngOnInit(): Promise<void> {
    try {
      await this.authStore.hydrate();

      if (!this.authStore.isAuthenticated()) {
        await this.router.navigate(['/login'], { replaceUrl: true });
        return;
      }

      await this.authStore.loadWorkspaces(true);
      await this.router.navigate([this.authStore.workspaceDestination()], { replaceUrl: true });
    } catch {
      await this.router.navigate(['/login'], { replaceUrl: true });
    }
  }
}
