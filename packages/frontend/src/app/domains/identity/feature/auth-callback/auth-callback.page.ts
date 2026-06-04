import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';
import { fetchAuthSession } from 'aws-amplify/auth';

import { environment } from '../../../../../environments/environment';
import { AuthStore } from '../../data-access/auth.store';

const CALLBACK_STEP_TIMEOUT_MS = 10000;

type CallbackErrorKey = 'IDENTITY.AUTH_CALLBACK.ERRORS.GENERIC' | 'IDENTITY.AUTH_CALLBACK.ERRORS.TIMEOUT';

@Component({
  selector: 'liass-auth-callback-page',
  imports: [TranslocoModule],
  templateUrl: './auth-callback.page.html'
})
export class AuthCallbackPage implements OnInit {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly errorKey = signal<CallbackErrorKey | null>(null);
  protected readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    await this.completeCallback();
  }

  protected async retry(): Promise<void> {
    await this.completeCallback();
  }

  private async completeCallback(): Promise<void> {
    this.errorKey.set(null);
    this.loading.set(true);
    this.debug('callback started');

    try {
      await this.withTimeout(
        fetchAuthSession({ forceRefresh: false }),
        CALLBACK_STEP_TIMEOUT_MS,
        'OAuth session hydration timed out.'
      );
      this.clearCallbackUrl();
      this.debug('session detected');

      await this.withTimeout(
        this.authStore.hydrate(),
        CALLBACK_STEP_TIMEOUT_MS,
        'Authenticated session check timed out.'
      );
      await this.withTimeout(
        this.authStore.refreshUserProfile(),
        CALLBACK_STEP_TIMEOUT_MS,
        'User profile refresh timed out.'
      );

      if (!this.authStore.isAuthenticated()) {
        await this.router.navigate(['/login'], { replaceUrl: true });
        return;
      }

      this.debug('workspace discovery started');
      const workspaces = await this.withTimeout(
        this.authStore.loadWorkspaces(true),
        CALLBACK_STEP_TIMEOUT_MS,
        'Workspace discovery timed out.'
      );
      this.debug('workspace count', { count: workspaces.length });

      const destination = this.authStore.workspaceDestination();
      this.debug('selected destination', { destination });

      if (destination) {
        await this.router.navigate([destination], { replaceUrl: true });
        return;
      }

      this.showError('IDENTITY.AUTH_CALLBACK.ERRORS.TIMEOUT');
    } catch (error) {
      this.debug('callback error', { reason: this.errorSummary(error) });

      if (this.isAuthError(error)) {
        await this.router.navigate(['/login'], { replaceUrl: true });
        return;
      }

      this.showError(
        error instanceof Error && error.message.includes('timed out')
          ? 'IDENTITY.AUTH_CALLBACK.ERRORS.TIMEOUT'
          : 'IDENTITY.AUTH_CALLBACK.ERRORS.GENERIC'
      );
    }
  }

  private showError(errorKey: CallbackErrorKey): void {
    this.loading.set(false);
    this.errorKey.set(errorKey);
  }

  private clearCallbackUrl(): void {
    if (typeof window === 'undefined' || !window.location.search) {
      return;
    }

    window.history.replaceState({}, document.title, window.location.pathname);
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private isAuthError(error: unknown): boolean {
    if (error instanceof HttpErrorResponse) {
      return error.status === 401 || error.status === 403;
    }

    if (!(error instanceof Error)) {
      return false;
    }

    return /not authenticated|authentication required|missing auth token|sign in/i.test(error.message);
  }

  private debug(message: string, details?: Record<string, unknown>): void {
    if (environment.production) {
      return;
    }

    if (details) {
      console.debug(`[auth-callback] ${message}`, details);
      return;
    }

    console.debug(`[auth-callback] ${message}`);
  }

  private errorSummary(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      return `${error.status} ${error.statusText}`.trim();
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown callback error';
  }
}
