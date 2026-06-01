import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';

import { AuthStore } from '../../data-access/auth.store';
import { AuthLayoutComponent } from '../../ui/auth-layout/auth-layout.component';

@Component({
  selector: 'liass-signup-page',
  imports: [AuthLayoutComponent, RouterModule, TranslocoModule],
  templateUrl: './signup.page.html'
})
export class SignupPage {
  protected readonly authStore = inject(AuthStore);

  protected async loginWithGoogle(): Promise<void> {
    if (this.authStore.loading()) {
      return;
    }

    await this.authStore.loginWithGoogle();
  }

  protected async loginWithLinkedIn(): Promise<void> {
    if (this.authStore.loading()) {
      return;
    }

    await this.authStore.loginWithLinkedIn();
  }
}
