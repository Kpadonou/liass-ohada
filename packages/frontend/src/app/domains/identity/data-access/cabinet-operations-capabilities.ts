import { Injectable, computed, inject } from '@angular/core';
import type {
  AccountingWork,
  AccountingWorkStatus,
  CabinetDeadline,
  CabinetDeadlineStatus
} from '@liass-ohada/shared/shared';

import { AuthStore } from './auth.store';

const FINAL_WORK_STATUSES = new Set<AccountingWorkStatus>(['COMPLETED', 'CANCELLED']);
const FINAL_DEADLINE_STATUSES = new Set<CabinetDeadlineStatus>(['COMPLETED', 'CANCELLED']);

@Injectable({ providedIn: 'root' })
export class CabinetOperationsCapabilities {
  private readonly authStore = inject(AuthStore);

  readonly canViewCabinetWork = computed(() => this.hasActiveCabinetRole());
  readonly canViewCabinetDeadlines = computed(() => this.hasActiveCabinetRole());
  readonly canCreateCabinetWork = computed(() => this.canManageStructurally());
  readonly canCreateCabinetDeadline = computed(() => this.canManageStructurally());

  canEditCabinetWork(work: AccountingWork): boolean {
    return !FINAL_WORK_STATUSES.has(work.status) && this.canManageDossier(work.dossierOrgId);
  }

  canManageCabinetWorkAssignments(work: AccountingWork): boolean {
    return this.canEditCabinetWork(work);
  }

  canChangeCabinetWorkStatus(work: AccountingWork, targetStatus: AccountingWorkStatus): boolean {
    if (FINAL_WORK_STATUSES.has(work.status) || targetStatus === work.status) {
      return false;
    }
    const role = this.authStore.activeCabinetRole();
    if (role === 'CABINET_ADMIN') {
      return true;
    }
    if (role === 'SUPERVISOR') {
      return this.canManageDossier(work.dossierOrgId);
    }
    if (role !== 'COLLABORATOR' || targetStatus === 'CANCELLED') {
      return false;
    }
    const currentUserId = this.authStore.currentUserId();
    return (
      !!currentUserId &&
      (work.responsibleUserId === currentUserId || work.participantUserIds.includes(currentUserId))
    );
  }

  canCancelCabinetWork(work: AccountingWork): boolean {
    return this.canChangeCabinetWorkStatus(work, 'CANCELLED');
  }

  canEditCabinetDeadline(deadline: CabinetDeadline): boolean {
    return (
      !FINAL_DEADLINE_STATUSES.has(deadline.status) &&
      this.canManageDossier(deadline.dossierOrgId)
    );
  }

  canChangeCabinetDeadlineStatus(
    deadline: CabinetDeadline,
    targetStatus: CabinetDeadlineStatus
  ): boolean {
    if (deadline.status !== 'PENDING' || targetStatus === 'PENDING') {
      return false;
    }
    const role = this.authStore.activeCabinetRole();
    if (role === 'CABINET_ADMIN') {
      return true;
    }
    if (role === 'SUPERVISOR') {
      return this.canManageDossier(deadline.dossierOrgId);
    }
    if (role !== 'COLLABORATOR' || targetStatus !== 'COMPLETED') {
      return false;
    }
    return !!this.authStore.currentUserId() && deadline.responsibleUserId === this.authStore.currentUserId();
  }

  canCancelCabinetDeadline(deadline: CabinetDeadline): boolean {
    return this.canChangeCabinetDeadlineStatus(deadline, 'CANCELLED');
  }

  private hasActiveCabinetRole(): boolean {
    return (
      this.authStore.activeWorkspaceType() === 'ACCOUNTING_FIRM' &&
      this.authStore.activeCabinetRole() !== null
    );
  }

  private canManageStructurally(): boolean {
    const role = this.authStore.activeCabinetRole();
    return role === 'CABINET_ADMIN' || role === 'SUPERVISOR';
  }

  private canManageDossier(dossierOrgId: string): boolean {
    const role = this.authStore.activeCabinetRole();
    if (role === 'CABINET_ADMIN') {
      return true;
    }
    return (
      role === 'SUPERVISOR' &&
      this.authStore.dossiers().some(
        (dossier) => dossier.orgId === dossierOrgId && dossier.status === 'ACTIVE'
      )
    );
  }
}
