import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  AcceptCabinetInvitationRequestSchema,
  AcceptCabinetInvitationResponseSchema,
  CabinetDossierAssignmentMutationResponseSchema,
  CabinetInvitationResponseSchema,
  CreateCabinetInvitationRequestSchema,
  CreateCabinetInvitationResponseSchema,
  GetCabinetMemberResponseSchema,
  ListCabinetDossierMembersResponseSchema,
  ListCabinetInvitationsRequestSchema,
  ListCabinetInvitationsResponseSchema,
  ListCabinetMemberAssignmentsResponseSchema,
  ListCabinetMembersRequestSchema,
  ListCabinetMembersResponseSchema,
  ReplaceCabinetMemberAssignmentsRequestSchema,
  UpdateCabinetMemberRoleRequestSchema,
  UpdateCabinetMemberStatusRequestSchema,
  type AcceptCabinetInvitationResponse,
  type CabinetDossierAssignment,
  type CabinetDossierAssignmentMutationResponse,
  type CabinetInvitation,
  type CabinetMember,
  type CabinetMemberSummary,
  type CreateCabinetInvitationRequest,
  type CreateCabinetInvitationResponse,
  type ListCabinetInvitationsRequest,
  type ListCabinetInvitationsResponse,
  type ListCabinetMembersRequest,
  type ListCabinetMembersResponse,
  type ReplaceCabinetMemberAssignmentsRequest,
  type UpdateCabinetMemberRoleRequest,
  type UpdateCabinetMemberStatusRequest
} from '@liass-ohada/shared/shared';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { TENANT_REQUEST_SCOPE } from '../../../core/http/tenant-request-context';

const cabinetContext = () => new HttpContext().set(TENANT_REQUEST_SCOPE, 'CABINET');

function requestParams(input: Record<string, unknown>): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class CabinetTeamApi {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  async listMembers(input: ListCabinetMembersRequest): Promise<ListCabinetMembersResponse> {
    const request = ListCabinetMembersRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/cabinet/team/members`, {
        context: cabinetContext(),
        params: requestParams(request)
      })
    );
    return ListCabinetMembersResponseSchema.parse(response);
  }

  async getMember(memberUserId: string): Promise<CabinetMember> {
    const response = await firstValueFrom(
      this.http.get<unknown>(
        `${this.apiBaseUrl}/cabinet/team/members/${encodeURIComponent(memberUserId)}`,
        { context: cabinetContext() }
      )
    );
    return GetCabinetMemberResponseSchema.parse(response).member;
  }

  async updateMemberRole(
    memberUserId: string,
    input: UpdateCabinetMemberRoleRequest
  ): Promise<CabinetMember> {
    const request = UpdateCabinetMemberRoleRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http.patch<unknown>(
        `${this.apiBaseUrl}/cabinet/team/members/${encodeURIComponent(memberUserId)}/role`,
        request,
        { context: cabinetContext() }
      )
    );
    return GetCabinetMemberResponseSchema.parse(response).member;
  }

  async updateMemberStatus(
    memberUserId: string,
    input: UpdateCabinetMemberStatusRequest
  ): Promise<CabinetMember> {
    const request = UpdateCabinetMemberStatusRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http.patch<unknown>(
        `${this.apiBaseUrl}/cabinet/team/members/${encodeURIComponent(memberUserId)}/status`,
        request,
        { context: cabinetContext() }
      )
    );
    return GetCabinetMemberResponseSchema.parse(response).member;
  }

  async listInvitations(
    input: ListCabinetInvitationsRequest
  ): Promise<ListCabinetInvitationsResponse> {
    const request = ListCabinetInvitationsRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/cabinet/team/invitations`, {
        context: cabinetContext(),
        params: requestParams(request)
      })
    );
    return ListCabinetInvitationsResponseSchema.parse(response);
  }

  async createInvitation(
    input: CreateCabinetInvitationRequest
  ): Promise<CreateCabinetInvitationResponse> {
    const request = CreateCabinetInvitationRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/cabinet/team/invitations`, request, {
        context: cabinetContext()
      })
    );
    return CreateCabinetInvitationResponseSchema.parse(response);
  }

  async resendInvitation(invitationId: string): Promise<CreateCabinetInvitationResponse> {
    const response = await firstValueFrom(
      this.http.post<unknown>(
        `${this.apiBaseUrl}/cabinet/team/invitations/${encodeURIComponent(invitationId)}/resend`,
        {},
        { context: cabinetContext() }
      )
    );
    return CreateCabinetInvitationResponseSchema.parse(response);
  }

  async cancelInvitation(invitationId: string): Promise<CabinetInvitation> {
    const response = await firstValueFrom(
      this.http.post<unknown>(
        `${this.apiBaseUrl}/cabinet/team/invitations/${encodeURIComponent(invitationId)}/cancel`,
        {},
        { context: cabinetContext() }
      )
    );
    return CabinetInvitationResponseSchema.parse(response).invitation;
  }

  async listMemberAssignments(memberUserId: string): Promise<CabinetDossierAssignment[]> {
    const response = await firstValueFrom(
      this.http.get<unknown>(
        `${this.apiBaseUrl}/cabinet/team/members/${encodeURIComponent(memberUserId)}/assignments`,
        { context: cabinetContext() }
      )
    );
    return ListCabinetMemberAssignmentsResponseSchema.parse(response).assignments;
  }

  async replaceMemberAssignments(
    memberUserId: string,
    input: ReplaceCabinetMemberAssignmentsRequest
  ): Promise<CabinetDossierAssignment[]> {
    const request = ReplaceCabinetMemberAssignmentsRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http.put<unknown>(
        `${this.apiBaseUrl}/cabinet/team/members/${encodeURIComponent(memberUserId)}/assignments`,
        request,
        { context: cabinetContext() }
      )
    );
    return ListCabinetMemberAssignmentsResponseSchema.parse(response).assignments;
  }

  async listDossierMembers(dossierOrgId: string): Promise<CabinetMemberSummary[]> {
    const response = await firstValueFrom(
      this.http.get<unknown>(
        `${this.apiBaseUrl}/cabinet/dossiers/${encodeURIComponent(dossierOrgId)}/members`,
        { context: cabinetContext() }
      )
    );
    return ListCabinetDossierMembersResponseSchema.parse(response).members;
  }

  async addDossierMember(
    dossierOrgId: string,
    memberUserId: string
  ): Promise<CabinetDossierAssignmentMutationResponse> {
    const response = await firstValueFrom(
      this.http.post<unknown>(
        `${this.apiBaseUrl}/cabinet/dossiers/${encodeURIComponent(dossierOrgId)}/members/${encodeURIComponent(memberUserId)}`,
        {},
        { context: cabinetContext() }
      )
    );
    return CabinetDossierAssignmentMutationResponseSchema.parse(response);
  }

  async removeDossierMember(
    dossierOrgId: string,
    memberUserId: string
  ): Promise<CabinetDossierAssignmentMutationResponse> {
    const response = await firstValueFrom(
      this.http.delete<unknown>(
        `${this.apiBaseUrl}/cabinet/dossiers/${encodeURIComponent(dossierOrgId)}/members/${encodeURIComponent(memberUserId)}`,
        { context: cabinetContext() }
      )
    );
    return CabinetDossierAssignmentMutationResponseSchema.parse(response);
  }

  async acceptInvitation(token: string): Promise<AcceptCabinetInvitationResponse> {
    const request = AcceptCabinetInvitationRequestSchema.parse({ token });
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/me/cabinet-invitations/accept`, request)
    );
    return AcceptCabinetInvitationResponseSchema.parse(response);
  }
}
