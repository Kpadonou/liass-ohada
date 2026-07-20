import { Injectable, inject } from '@angular/core';
import { queryOptions } from '@tanstack/angular-query-experimental';
import type {
  CabinetInvitationStatus,
  CabinetMemberStatus,
  CabinetRole
} from '@liass-ohada/shared/shared';

import { AuthStore } from './auth.store';
import { CabinetTeamApi } from './cabinet-team.api';

export interface CabinetMemberFilters {
  cursor?: string;
  limit: number;
  role?: CabinetRole;
  status?: CabinetMemberStatus;
}

export interface CabinetInvitationFilters {
  cursor?: string;
  limit: number;
  status?: CabinetInvitationStatus;
}

const NO_CABINET = 'no-active-cabinet';

@Injectable({ providedIn: 'root' })
export class CabinetTeamQueries {
  private readonly api = inject(CabinetTeamApi);
  private readonly authStore = inject(AuthStore);

  scope(): string {
    return this.authStore.activeWorkspaceOrgId() ?? NO_CABINET;
  }

  all() {
    return ['cabinet-team', this.scope()] as const;
  }

  members(filters: CabinetMemberFilters) {
    return queryOptions({
      queryKey: [...this.all(), 'members', filters] as const,
      queryFn: () => this.api.listMembers(filters),
      enabled: this.authStore.canViewCabinetTeam(),
      staleTime: 30_000
    });
  }

  member(memberUserId: string) {
    return queryOptions({
      queryKey: [...this.all(), 'member', memberUserId] as const,
      queryFn: () => this.api.getMember(memberUserId),
      enabled: this.authStore.canViewCabinetInvitations() && memberUserId.length > 0,
      staleTime: 30_000
    });
  }

  assignments(memberUserId: string) {
    return queryOptions({
      queryKey: [...this.all(), 'assignments', memberUserId] as const,
      queryFn: () => this.api.listMemberAssignments(memberUserId),
      enabled: this.authStore.canViewCabinetInvitations() && memberUserId.length > 0,
      staleTime: 20_000
    });
  }

  dossierMembers(dossierOrgId: string) {
    return queryOptions({
      queryKey: [...this.all(), 'dossier-members', dossierOrgId] as const,
      queryFn: () => this.api.listDossierMembers(dossierOrgId),
      enabled: this.authStore.canViewCabinetTeam() && dossierOrgId.length > 0,
      staleTime: 20_000
    });
  }

  invitations(filters: CabinetInvitationFilters) {
    return queryOptions({
      queryKey: [...this.all(), 'invitations', filters] as const,
      queryFn: () => this.api.listInvitations(filters),
      enabled: this.authStore.canViewCabinetInvitations(),
      staleTime: 15_000
    });
  }
}
