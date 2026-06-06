import { Component, OnInit, inject } from '@angular/core';
import type { WorkspaceSummary } from '@liass-ohada/shared';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';

import { AuthStore } from '../../data-access/auth.store';

@Component({
  selector: 'liass-select-workspace-page',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    TranslocoModule
  ],
  templateUrl: './select-workspace.page.html'
})
export class SelectWorkspacePage implements OnInit {
  protected readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);

  async ngOnInit(): Promise<void> {
    if (!this.authStore.workspacesLoaded()) {
      await this.authStore.loadWorkspaces();
    }

    const destination = this.authStore.workspaceDestination();
    if (destination && destination !== '/select-workspace') {
      await this.router.navigate([destination], { replaceUrl: true });
    }
  }

  protected readonly userLabel = (): string => {
    const user = this.authStore.user();
    return user?.signInDetails?.loginId ?? user?.username ?? '';
  };

  protected workspaceLabel(workspace: WorkspaceSummary): string {
    return workspace.displayName || workspace.orgId;
  }

  protected async selectWorkspace(workspace: WorkspaceSummary): Promise<void> {
    if (this.authStore.loading() || this.authStore.workspaceLoading()) {
      return;
    }

    this.authStore.setTenant(workspace.orgId);
    await this.router.navigate([
      workspace.workspaceType === 'ACCOUNTING_FIRM' ? '/cabinet/dashboard' : '/dashboard'
    ]);
  }

  protected async logout(): Promise<void> {
    await this.authStore.logout();
    await this.router.navigate(['/login']);
  }
}
