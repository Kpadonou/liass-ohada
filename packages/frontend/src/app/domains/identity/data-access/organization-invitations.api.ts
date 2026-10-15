import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import {
  CreateOrganizationInvitationRequestSchema,
  CreateOrganizationInvitationResponseSchema,
  AcceptOrganizationInvitationRequestSchema,
  AcceptOrganizationInvitationResponseSchema,
} from '@liass-ohada/shared/shared';
import { environment } from '../../../../environments/environment';
import { AuthStore } from './auth.store';
import { canAdministerCompanyMembers } from './organization-members.api';

@Injectable({ providedIn: 'root' })
export class OrganizationInvitationsApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthStore);
  private readonly base =
    environment.apiBaseUrl.replace(/\/$/, '') + '/me/organization/invitations';
  canCreate(org: string, user: string): boolean {
    return (
      this.auth.currentUserId() === user &&
      canAdministerCompanyMembers(
        this.auth.activeWorkspace(),
        this.auth.activeWorkspaceType(),
        org,
      ) &&
      this.auth.effectiveOrgId() === org
    );
  }
  async create(org: string, user: string, input: unknown) {
    if (!this.canCreate(org, user)) throw new HttpErrorResponse({ status: 403 });
    const body = CreateOrganizationInvitationRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http.post<unknown>(this.base, body).pipe(timeout(35000)),
    );
    if (!this.canCreate(org, user)) throw new HttpErrorResponse({ status: 403 });
    return CreateOrganizationInvitationResponseSchema.parse(response);
  }
  async accept(user: string, token: string) {
    if (!user || this.auth.currentUserId() !== user) throw new HttpErrorResponse({ status: 403 });
    const body = AcceptOrganizationInvitationRequestSchema.parse({ token });
    const response = await firstValueFrom(
      this.http.post<unknown>(this.base + '/accept', body).pipe(timeout(35000)),
    );
    if (this.auth.currentUserId() !== user) throw new HttpErrorResponse({ status: 403 });
    return AcceptOrganizationInvitationResponseSchema.parse(response);
  }
}
