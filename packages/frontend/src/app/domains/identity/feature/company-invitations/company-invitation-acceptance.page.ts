import { Component, afterNextRender, effect, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule } from '@ngneat/transloco';
import { Router } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { AuthStore } from '../../data-access/auth.store';
import { OrganizationInvitationsApi } from '../../data-access/organization-invitations.api';
import { InvitationAcceptanceState } from '../../data-access/invitation-acceptance-state';
import { AuthLayoutComponent } from '../../ui/auth-layout/auth-layout.component';
import { invitationError } from './invitation-errors';

@Component({
  selector: 'liass-company-invitation-acceptance',
  imports: [AuthLayoutComponent, MatButtonModule, TranslocoModule],
  template: `<liass-auth-layout
    ><section aria-live="polite" class="space-y-5 text-center">
      <h1 class="text-2xl font-semibold">
        {{ 'IDENTITY.COMPANY_INVITATIONS.ACCEPT_TITLE' | transloco }}
      </h1>
      @if (success()) {
        <p role="status">{{ 'IDENTITY.COMPANY_INVITATIONS.ACCEPTED' | transloco }}</p>
        <p class="text-sm text-app-text-secondary">
          {{ 'IDENTITY.COMPANY_INVITATIONS.ACCEPTED_HELP' | transloco }}
        </p>
        <button mat-flat-button (click)="continue()">
          {{ 'IDENTITY.COMPANY_INVITATIONS.CONTINUE' | transloco }}
        </button>
      } @else {
        <p class="text-sm text-app-text-secondary">
          {{ 'IDENTITY.COMPANY_INVITATIONS.ACCEPT_HELP' | transloco }}
        </p>
        @if (error(); as key) {
          <p role="alert" class="text-sm text-danger-600">{{ key | transloco }}</p>
        }
        @if (pending()) {
          <p role="status">{{ 'IDENTITY.COMPANY_INVITATIONS.PENDING' | transloco }}</p>
        }
        @if (valid()) {
          <button mat-flat-button [disabled]="pending()" (click)="accept()">
            {{ 'IDENTITY.COMPANY_INVITATIONS.ACCEPT' | transloco }}
          </button>
        }
      }
    </section></liass-auth-layout
  >`,
})
export class CompanyInvitationAcceptancePage {
  private readonly auth = inject(AuthStore);
  private readonly api = inject(OrganizationInvitationsApi);
  private readonly context = inject(InvitationAcceptanceState);
  private readonly client = inject(QueryClient);
  private readonly router = inject(Router);
  private readonly user = this.auth.currentUserId();
  readonly pending = signal(false);
  readonly success = signal(false);
  readonly valid = signal(this.context.isCompany() && !!this.context.token());
  readonly error = signal<string | null>(
    this.valid() ? null : 'IDENTITY.COMPANY_INVITATIONS.INVALID',
  );
  constructor() {
    afterNextRender(() => {
      void this.router.navigateByUrl('/accept-company-invitation', { replaceUrl: true });
    });
    effect(() => {
      if (this.auth.currentUserId() !== this.user) {
        this.context.clearToken();
        this.valid.set(false);
        this.success.set(false);
        this.error.set('IDENTITY.COMPANY_INVITATIONS.INVALID');
      }
    });
  }
  async accept() {
    const token = this.context.token();
    if (
      !token ||
      !this.valid() ||
      this.pending() ||
      !this.user ||
      this.auth.currentUserId() !== this.user
    )
      return;
    this.pending.set(true);
    this.error.set(null);
    try {
      const membership = await this.api.accept(this.user, token);
      this.context.clearToken();
      this.valid.set(false);
      this.success.set(true);
      await this.client.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === 'identity' &&
          q.queryKey[1] === membership.organizationId &&
          q.queryKey[2] === 'company-members',
      });
      await Promise.all([this.auth.refreshUserProfile(), this.auth.loadWorkspaces(true)]);
    } catch (error) {
      if (!this.success()) {
        const key = invitationError(error);
        this.error.set(key);
        if (['INVALID', 'EXPIRED', 'UNAVAILABLE'].some((state) => key.endsWith('.' + state))) {
          this.valid.set(false);
          this.context.clearToken();
        }
      }
    } finally {
      this.pending.set(false);
    }
  }
  async continue() {
    await this.router.navigateByUrl('/select-workspace', { replaceUrl: true });
  }
}
