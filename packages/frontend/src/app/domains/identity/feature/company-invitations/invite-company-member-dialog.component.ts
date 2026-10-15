import { Component, effect, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { CreateOrganizationInvitationRequestSchema } from '@liass-ohada/shared/shared';
import { environment } from '../../../../../environments/environment';
import { OrganizationInvitationsApi } from '../../data-access/organization-invitations.api';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { invitationError } from './invitation-errors';

export function developmentInvitationLink(
  token: string | undefined,
  production: boolean,
  origin: string,
): string | null {
  return !production && token
    ? `${origin}/accept-company-invitation?token=${encodeURIComponent(token)}`
    : null;
}
@Component({
  selector: 'liass-invite-company-member-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    TranslocoModule,
  ],
  templateUrl: './invite-company-member-dialog.component.html',
})
export class InviteCompanyMemberDialogComponent {
  private readonly api = inject(OrganizationInvitationsApi);
  private readonly ref = inject(MatDialogRef<InviteCompanyMemberDialogComponent>);
  readonly data = inject<{ org: string; user: string }>(MAT_DIALOG_DATA);
  private readonly notifications = inject(NotificationService);
  private readonly t = inject(TranslocoService);
  readonly email = new FormControl('', {
    nonNullable: true,
    validators: (control) =>
      CreateOrganizationInvitationRequestSchema.shape.email.safeParse(control.value).success
        ? null
        : { email: true },
  });
  readonly form = new FormGroup({ email: this.email });
  readonly pending = signal(false);
  readonly created = signal(false);
  readonly error = signal<string | null>(null);
  readonly link = signal<string | null>(null);
  private intent: { clientRequestId: string; email: string } | null = null;
  constructor() {
    effect(() => {
      if (!this.api.canCreate(this.data.org, this.data.user)) {
        this.link.set(null);
        this.ref.close();
      }
    });
  }
  async submit() {
    if (this.pending() || this.created() || !this.api.canCreate(this.data.org, this.data.user))
      return;
    if (this.email.invalid) {
      this.email.markAsTouched();
      return;
    }
    this.intent ??= { clientRequestId: crypto.randomUUID(), email: this.email.value };
    this.email.disable();
    this.pending.set(true);
    this.error.set(null);
    this.ref.disableClose = true;
    try {
      const result = await this.api.create(this.data.org, this.data.user, this.intent);
      this.created.set(true);
      this.link.set(
        developmentInvitationLink(
          result.invitationToken,
          environment.production,
          window.location.origin,
        ),
      );
      this.notifications.success(this.t.translate('IDENTITY.COMPANY_INVITATIONS.CREATED'));
    } catch (error) {
      this.error.set(invitationError(error));
    } finally {
      this.pending.set(false);
      this.ref.disableClose = false;
    }
  }
  async copy() {
    const link = this.link();
    if (!link || !this.api.canCreate(this.data.org, this.data.user)) return;
    try {
      await navigator.clipboard.writeText(link);
      this.notifications.success(this.t.translate('IDENTITY.COMPANY_INVITATIONS.COPIED'));
    } catch {
      this.error.set('IDENTITY.COMPANY_INVITATIONS.COPY_ERROR');
    }
  }
  close() {
    this.link.set(null);
    this.ref.close();
  }
}
