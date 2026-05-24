import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';

import { AuthStore } from '../../auth/auth.store';

@Component({
  selector: 'liass-select-workspace-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    ReactiveFormsModule
  ],
  templateUrl: './select-workspace.page.html'
})
export class SelectWorkspacePage {
  protected readonly authStore = inject(AuthStore);
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);

  protected readonly form = this.formBuilder.nonNullable.group({
    orgId: [this.authStore.activeOrgId() ?? '', [Validators.required]]
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
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
