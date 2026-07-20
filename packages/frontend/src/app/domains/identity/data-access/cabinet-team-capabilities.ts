import { Injectable, computed, inject } from '@angular/core';
import type { CabinetMemberSummary } from '@liass-ohada/shared/shared';

import { AuthStore } from './auth.store';

@Injectable({ providedIn: 'root' })
export class CabinetTeamCapabilities {
  private readonly authStore = inject(AuthStore);

  readonly canViewCabinetTeam = computed(() => this.authStore.canViewCabinetTeam());
  readonly canViewCabinetInvitations = computed(() =>
    this.authStore.canViewCabinetInvitations()
  );
  readonly canInviteCabinetMember = this.canViewCabinetInvitations;
  readonly canChangeCabinetMemberRole = this.canViewCabinetInvitations;
  readonly canChangeCabinetMemberStatus = this.canViewCabinetInvitations;
  readonly canManageAllDossierAssignments = this.canViewCabinetInvitations;
  readonly canManageSupervisedDossierAssignments = computed(
    () => this.authStore.activeCabinetRole() === 'SUPERVISOR' && this.canViewCabinetTeam()
  );
  readonly canResendCabinetInvitation = this.canViewCabinetInvitations;
  readonly canCancelCabinetInvitation = this.canViewCabinetInvitations;

  canChangeRole(target: CabinetMemberSummary): boolean {
    return this.canChangeCabinetMemberRole() && !target.isOwner && target.status !== 'REVOKED';
  }

  canChangeStatus(target: CabinetMemberSummary): boolean {
    return this.canChangeCabinetMemberStatus() && !target.isOwner;
  }

  canManageAssignments(target: CabinetMemberSummary): boolean {
    return (
      this.canManageAllDossierAssignments() &&
      !target.isOwner &&
      target.status === 'ACTIVE' &&
      target.cabinetRole !== 'CABINET_ADMIN'
    );
  }

  canSupervisorManageTarget(target: CabinetMemberSummary): boolean {
    return (
      this.canManageSupervisedDossierAssignments() &&
      target.status === 'ACTIVE' &&
      (target.cabinetRole === 'COLLABORATOR' || target.cabinetRole === 'READER') &&
      target.userId !== this.authStore.currentUserId()
    );
  }
}
