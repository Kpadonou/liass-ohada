import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterModule } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';

import { AuthStore } from '../../data-access/auth.store';
import { AuthLayoutComponent } from '../../ui/auth-layout/auth-layout.component';

@Component({
  selector: 'liass-login-page',
  imports: [
    AuthLayoutComponent,
    MatIconModule,
    ReactiveFormsModule,
    RouterModule,
    TranslocoModule
  ],
  templateUrl: './login.page.html'
})
export class LoginPage {
  protected readonly authStore = inject(AuthStore);
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);

  protected hidePassword = true;
  protected hideNewPassword = true;
  protected hideConfirmPassword = true;
  // LinkedIn is shown only to preserve the TailAdmin-style social row; no provider is wired in this pass.
  protected readonly linkedInSocialUnavailable = true;

  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
    newPassword: ['', [Validators.required, Validators.minLength(12)]],
    confirmNewPassword: ['', [Validators.required]]
  });

  protected async loginWithGoogle(): Promise<void> {
    if (this.authStore.loading()) {
      return;
    }

    await this.authStore.loginWithGoogle();
  }

  protected async submit(): Promise<void> {
    if (this.authStore.requiresNewPassword()) {
      await this.submitNewPassword();
      return;
    }

    if (
      this.form.controls.email.invalid ||
      this.form.controls.password.invalid ||
      this.authStore.loading()
    ) {
      this.form.controls.email.markAsTouched();
      this.form.controls.password.markAsTouched();
      return;
    }

    const { email, password } = this.form.getRawValue();
    await this.authStore.login(email, password);
    if (this.authStore.requiresNewPassword()) {
      this.form.controls.password.disable();
      return;
    }

    await this.routeAfterWorkspaceDiscovery();
  }

  protected passwordsDoNotMatch(): boolean {
    return this.form.controls.newPassword.value !== this.form.controls.confirmNewPassword.value;
  }

  protected canSubmit(): boolean {
    if (this.authStore.requiresNewPassword()) {
      return (
        this.form.controls.newPassword.valid &&
        this.form.controls.confirmNewPassword.valid &&
        !this.passwordsDoNotMatch() &&
        !this.authStore.loading()
      );
    }

    return (
      this.form.controls.email.valid &&
      this.form.controls.password.valid &&
      !this.authStore.loading()
    );
  }

  private async submitNewPassword(): Promise<void> {
    this.form.controls.newPassword.markAsTouched();
    this.form.controls.confirmNewPassword.markAsTouched();

    if (
      this.form.controls.newPassword.invalid ||
      this.form.controls.confirmNewPassword.invalid ||
      this.passwordsDoNotMatch() ||
      this.authStore.loading()
    ) {
      return;
    }

    await this.authStore.confirmNewPassword(this.form.controls.newPassword.value);
    await this.routeAfterWorkspaceDiscovery();
  }

  private async routeAfterWorkspaceDiscovery(): Promise<void> {
    await this.authStore.loadWorkspaces(true);
    await this.router.navigate([this.authStore.workspaceDestination()]);
  }
}
