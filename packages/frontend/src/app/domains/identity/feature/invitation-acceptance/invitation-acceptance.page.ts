import { Component, OnInit, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { AuthStore } from '../../data-access/auth.store';
import { CabinetTeamApi } from '../../data-access/cabinet-team.api';
import { InvitationAcceptanceState } from '../../data-access/invitation-acceptance-state';
import { backendErrorCode } from '../cabinet-team/cabinet-team.presentation';
import { AuthLayoutComponent } from '../../ui/auth-layout/auth-layout.component';

type AcceptanceState =
  | 'READY'
  | 'PENDING'
  | 'SUCCESS'
  | 'EMAIL_MISMATCH'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'ACCEPTED'
  | 'INVALID'
  | 'ERROR';

@Component({
  selector: 'liass-invitation-acceptance-page',
  imports: [AuthLayoutComponent, LiassButtonComponent, MatIconModule, TranslocoModule],
  templateUrl: './invitation-acceptance.page.html'
})
export class InvitationAcceptancePage implements OnInit {
  private readonly api = inject(CabinetTeamApi);
  protected readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly acceptanceState = inject(InvitationAcceptanceState);

  protected readonly state = signal<AcceptanceState>('READY');

  ngOnInit(): void {
    if (!this.acceptanceState.token()) {
      this.state.set('INVALID');
    }
  }

  protected async accept(): Promise<void> {
    const token = this.acceptanceState.token();
    if (!token || this.state() === 'PENDING') {
      this.state.set('INVALID');
      return;
    }
    this.state.set('PENDING');
    try {
      await this.api.acceptInvitation(token);
      this.acceptanceState.clearToken();
      await Promise.all([
        this.authStore.refreshUserProfile(),
        this.authStore.loadWorkspaces(true)
      ]);
      this.state.set('SUCCESS');
    } catch (error) {
      const code = backendErrorCode(error);
      this.state.set(
        code === 'CABINET_INVITATION_EMAIL_MISMATCH'
          ? 'EMAIL_MISMATCH'
          : code === 'CABINET_INVITATION_EXPIRED'
            ? 'EXPIRED'
            : code === 'CABINET_INVITATION_CANCELLED'
              ? 'CANCELLED'
              : code === 'CABINET_INVITATION_ALREADY_ACCEPTED'
                ? 'ACCEPTED'
                : code === 'CABINET_INVITATION_TOKEN_INVALID' ||
                    code === 'CABINET_INVITATION_NOT_FOUND'
                  ? 'INVALID'
                  : 'ERROR'
      );
      this.acceptanceState.clearToken();
    }
  }

  protected async continueToWorkspace(): Promise<void> {
    const destination = this.authStore.workspaceDestination() ?? '/select-workspace';
    await this.router.navigateByUrl(destination, { replaceUrl: true });
  }

  protected async leave(): Promise<void> {
    this.acceptanceState.clearToken();
    const destination = this.authStore.workspaceDestination() ?? '/select-workspace';
    await this.router.navigateByUrl(destination, { replaceUrl: true });
  }
}
