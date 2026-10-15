import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import {
  AssignInitialProductRoleBodySchema,
  AssignInitialProductRoleRequestSchema,
  AssignInitialProductRoleResponseSchema,
  ListOrganizationMembersRequestSchema,
  ListOrganizationMembersResponseSchema,
} from '@liass-ohada/shared/shared';
import type { WorkspaceSummary } from '@liass-ohada/shared/shared';
import { environment } from '../../../../environments/environment';
import { AuthStore } from './auth.store';

export function canAdministerCompanyMembers(
  workspace: WorkspaceSummary | null | undefined,
  type: string | null | undefined,
  org: string | null | undefined,
) {
  return (
    !!org &&
    workspace?.orgId === org &&
    type === 'COMPANY' &&
    workspace.status === 'ACTIVE' &&
    workspace.role === 'OWNER' &&
    (!workspace.accessSource || workspace.accessSource === 'DIRECT')
  );
}
@Injectable({ providedIn: 'root' })
export class OrganizationMembersApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthStore);
  private readonly base = environment.apiBaseUrl.replace(/\/$/, '');
  private assertScope(org: string, user: string) {
    if (!org || !user || this.auth.effectiveOrgId() !== org || this.auth.currentUserId() !== user)
      throw new HttpErrorResponse({ status: 409, error: { error: { code: 'WORKSPACE_CHANGED' } } });
  }
  async members(org: string, user: string, cursor?: string) {
    this.assertScope(org, user);
    const input = ListOrganizationMembersRequestSchema.parse({ limit: 50, cursor });
    let params = new HttpParams().set('limit', input.limit);
    if (input.cursor) params = params.set('cursor', input.cursor);
    const response = await firstValueFrom(
      this.http
        .get<unknown>(this.base + '/me/organization/members', { params })
        .pipe(timeout(35_000)),
    );
    this.assertScope(org, user);
    return ListOrganizationMembersResponseSchema.parse(response);
  }
  async assignInitialRole(org: string, user: string, memberUserId: string, input: unknown) {
    this.assertScope(org, user);
    const body = AssignInitialProductRoleBodySchema.parse(input);
    const request = AssignInitialProductRoleRequestSchema.parse({
      ...body,
      memberUserId,
      productCode: 'RESTAURANTS',
    });
    const response = await firstValueFrom(
      this.http
        .put<unknown>(
          this.base +
            `/me/organization/members/${encodeURIComponent(request.memberUserId)}/product-roles/${request.productCode}`,
          body,
        )
        .pipe(timeout(35_000)),
    );
    this.assertScope(org, user);
    const result = AssignInitialProductRoleResponseSchema.parse(response);
    if (
      result.userId !== memberUserId ||
      result.role !== request.role ||
      result.productCode !== request.productCode
    )
      throw new Error('Mismatched product role context');
    return result;
  }
}
