import { Component, OnInit, inject } from '@angular/core';
import type { WorkspaceSummary } from '@liass-ohada/shared';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';

import { AuthStore } from '../../data-access/auth.store';
import { WelcomeDestination } from '../../../../core/feature/welcome/welcome-destination';

@Component({
  selector: 'liass-select-workspace-page',
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, TranslocoModule],
  templateUrl: './select-workspace.page.html',
})
export class SelectWorkspacePage implements OnInit {
  protected readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly welcomeDestination = inject(WelcomeDestination);

  async ngOnInit(): Promise<void> {
    if (!this.authStore.workspacesLoaded()) {
      await this.authStore.loadWorkspaces();
    }

    const destination = this.authStore.workspaceDestination();
    if (
      this.route.snapshot.queryParamMap.get('change') !== '1' &&
      destination &&
      destination !== '/select-workspace'
    ) {
      await this.router.navigateByUrl(await this.welcomeDestination.resolve(), { replaceUrl: true });
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
    await this.router.navigateByUrl(await this.welcomeDestination.resolve());
  }

  protected async logout(): Promise<void> {
    await this.authStore.logout();
    await this.router.navigate(['/login']);
  }
}
