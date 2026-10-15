import { Injectable, inject } from '@angular/core';
import { infiniteQueryOptions, QueryClient } from '@tanstack/angular-query-experimental';
import { AuthStore } from './auth.store';
import { OrganizationMembersApi } from './organization-members.api';
export const organizationMemberKeys = {
  directory: (org: string, user: string) => ['identity', org, 'company-members', user] as const,
};
@Injectable({ providedIn: 'root' })
export class OrganizationMembersQueries {
  private readonly api = inject(OrganizationMembersApi);
  private readonly auth = inject(AuthStore);
  private readonly client = inject(QueryClient);
  members(enabled = true) {
    const org = this.auth.effectiveOrgId() ?? '',
      user = this.auth.currentUserId() ?? '';
    return infiniteQueryOptions({
      queryKey: organizationMemberKeys.directory(org, user),
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) => this.api.members(org, user, pageParam),
      getNextPageParam: (last) => last.nextCursor,
      enabled: enabled && !!org && !!user,
      staleTime: 0,
      retry: false,
      refetchOnMount: 'always' as const,
    });
  }
  async refresh(org: string, user: string) {
    await this.client.invalidateQueries({
      queryKey: organizationMemberKeys.directory(org, user),
      exact: true,
    });
  }
}
