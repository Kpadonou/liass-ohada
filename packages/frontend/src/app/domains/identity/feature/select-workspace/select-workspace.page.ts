import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import type { WorkspaceSummary } from '@liass-ohada/shared';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';

import { AuthStore } from '../../data-access/auth.store';

@Component({
  selector: 'liass-select-workspace-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule
  ],
  templateUrl: './select-workspace.page.html'
})
export class SelectWorkspacePage implements OnInit {
  protected readonly authStore = inject(AuthStore);
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);

  protected readonly form = this.formBuilder.nonNullable.group({
    orgId: [this.authStore.activeOrgId() ?? '', [Validators.required]]
  });

  async ngOnInit(): Promise<void> {
    if (!this.authStore.workspacesLoaded()) {
      await this.authStore.loadWorkspaces();
    }
  }

  protected readonly userLabel = (): string => {
    const user = this.authStore.user();
    return user?.signInDetails?.loginId ?? user?.username ?? 'Signed-in user';
  };

  protected readonly showManualEntry = (): boolean =>
    this.authStore.workspaces().length === 0 && !this.authStore.workspaceError();

  protected workspaceLabel(workspace: WorkspaceSummary): string {
    return workspace.displayName || workspace.orgId;
  }

  protected async selectWorkspace(workspace: WorkspaceSummary): Promise<void> {
    if (this.authStore.loading() || this.authStore.workspaceLoading()) {
      return;
    }

    this.authStore.setTenant(workspace.orgId);
    await this.router.navigate(['/dashboard']);
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.authStore.loading()) {
      this.form.markAllAsTouched();
      return;
    }

    this.authStore.setTenant(this.form.controls.orgId.value);
    await this.router.navigate(['/dashboard']);
  }

  protected async logout(): Promise<void> {
    await this.authStore.logout();
    await this.router.navigate(['/login']);
  }
}
