import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';

import { AuthStore } from '../../auth/auth.store';

@Component({
  selector: 'liass-login-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    ReactiveFormsModule
  ],
  templateUrl: './login.page.html'
})
export class LoginPage {
  protected readonly authStore = inject(AuthStore);
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);

  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]]
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.authStore.loading()) {
      this.form.markAllAsTouched();
      return;
    }

    const { email, password } = this.form.getRawValue();
    await this.authStore.login(email, password);
    await this.router.navigate([
      this.authStore.hasActiveTenant() ? '/dashboard' : '/select-workspace'
    ]);
  }
}
