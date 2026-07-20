import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type {
  CabinetMember,
  CabinetMemberStatus,
  CabinetMemberSummary,
  CabinetRole
} from '@liass-ohada/shared/shared';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { AuthStore } from '../../data-access/auth.store';
import { CabinetTeamApi } from '../../data-access/cabinet-team.api';
import { CabinetTeamCapabilities } from '../../data-access/cabinet-team-capabilities';
import { CabinetTeamQueries } from '../../data-access/cabinet-team.queries';
import {
  cabinetMemberStatusKey,
  cabinetRoleKey,
  cabinetTeamErrorKey,
  memberDisplayName,
  memberInitials
} from './cabinet-team.presentation';
import {
  CabinetTeamConfirmDialogComponent,
  type CabinetTeamConfirmDialogData
} from './cabinet-team-confirm-dialog.component';

export interface CabinetMemberDialogData {
  member: CabinetMemberSummary;
}

const ROLES: readonly CabinetRole[] = [
  'CABINET_ADMIN',
  'SUPERVISOR',
  'COLLABORATOR',
  'READER'
];

@Component({
  selector: 'liass-cabinet-member-dialog',
  imports: [
    LiassButtonComponent,
    LiassStatusChipComponent,
    DatePipe,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    TranslocoModule
  ],
  templateUrl: './cabinet-member-dialog.component.html'
})
export class CabinetMemberDialogComponent implements OnInit {
  private readonly api = inject(CabinetTeamApi);
  protected readonly authStore = inject(AuthStore);
  protected readonly capabilities = inject(CabinetTeamCapabilities);
  private readonly data = inject<CabinetMemberDialogData>(MAT_DIALOG_DATA);
  private readonly dialog = inject(MatDialog);
  private readonly dialogRef = inject<MatDialogRef<CabinetMemberDialogComponent, boolean>>(
    MatDialogRef
  );
  private readonly notification = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly queries = inject(CabinetTeamQueries);
  private readonly transloco = inject(TranslocoService);

  protected readonly roles = ROLES;
  protected readonly member = signal<CabinetMember>(this.data.member);
  protected readonly loading = signal(true);
  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly selectedRole = signal<CabinetRole>(this.data.member.cabinetRole);
  protected readonly originalAssignments = signal<Set<string>>(new Set());
  protected readonly selectedAssignments = signal<Set<string>>(new Set());
  protected readonly dossierSearch = signal('');
  protected readonly displayName = computed(
    () => memberDisplayName(this.member()) ?? this.transloco.translate('IDENTITY.CABINET_TEAM.MEMBERS.PROFILE_INCOMPLETE')
  );
  protected readonly initials = computed(() => memberInitials(this.member()));
  protected readonly filteredDossiers = computed(() => {
    const search = this.dossierSearch().trim().toLocaleLowerCase();
    return this.authStore.dossiers().filter(
      (dossier) => !search || dossier.displayName.toLocaleLowerCase().includes(search)
    );
  });
  protected readonly assignmentDiff = computed(() => {
    const before = this.originalAssignments();
    const after = this.selectedAssignments();
    return {
      added: [...after].filter((id) => !before.has(id)).length,
      removed: [...before].filter((id) => !after.has(id)).length
    };
  });
  protected readonly assignmentsChanged = computed(() => {
    const diff = this.assignmentDiff();
    return diff.added > 0 || diff.removed > 0;
  });

  async ngOnInit(): Promise<void> {
    try {
      const [member, assignments] = await Promise.all([
        this.api.getMember(this.data.member.userId),
        this.data.member.cabinetRole === 'CABINET_ADMIN'
          ? Promise.resolve([])
          : this.api.listMemberAssignments(this.data.member.userId),
        this.authStore.dossiersLoaded() ? Promise.resolve() : this.authStore.loadDossiers()
      ]);
      this.member.set(member);
      this.selectedRole.set(member.cabinetRole);
      const assignedIds = new Set(assignments.map((assignment) => assignment.dossierOrgId));
      this.originalAssignments.set(assignedIds);
      this.selectedAssignments.set(new Set(assignedIds));
    } catch (error) {
      this.errorKey.set(
        cabinetTeamErrorKey(error, 'IDENTITY.CABINET_TEAM.ERRORS.MEMBER_LOAD_FAILED')
      );
    } finally {
      this.loading.set(false);
    }
  }

  protected roleKey(role: CabinetRole): string {
    return cabinetRoleKey(role);
  }

  protected statusKey(status: CabinetMemberStatus): string {
    return cabinetMemberStatusKey(status);
  }

  protected statusTone(status: CabinetMemberStatus): 'success' | 'warning' | 'danger' {
    return status === 'ACTIVE' ? 'success' : status === 'SUSPENDED' ? 'warning' : 'danger';
  }

  protected roleConsequenceKey(): string | null {
    const current = this.member().cabinetRole;
    const next = this.selectedRole();
    if (current === next) return null;
    if (current === 'CABINET_ADMIN') return 'IDENTITY.CABINET_TEAM.ROLE_CHANGE.DEMOTE_ADMIN';
    if (next === 'CABINET_ADMIN') return 'IDENTITY.CABINET_TEAM.ROLE_CHANGE.PROMOTE_ADMIN';
    if (next === 'READER') return 'IDENTITY.CABINET_TEAM.ROLE_CHANGE.TO_READER';
    return 'IDENTITY.CABINET_TEAM.ROLE_CHANGE.GENERIC';
  }

  protected async saveRole(): Promise<void> {
    const member = this.member();
    const role = this.selectedRole();
    if (!this.capabilities.canChangeRole(member) || role === member.cabinetRole || this.submitting()) {
      return;
    }
    const confirmed = await this.confirm({
      titleKey: 'IDENTITY.CABINET_TEAM.ROLE_CHANGE.TITLE',
      descriptionKey: this.roleConsequenceKey() ?? 'IDENTITY.CABINET_TEAM.ROLE_CHANGE.GENERIC',
      confirmKey: 'IDENTITY.CABINET_TEAM.ACTIONS.CONFIRM_ROLE',
      memberName: this.displayName()
    });
    if (!confirmed) return;
    await this.runMutation(
      () => this.api.updateMemberRole(member.userId, { role }),
      'IDENTITY.CABINET_TEAM.NOTIFICATIONS.ROLE_UPDATED'
    );
  }

  protected async changeStatus(status: CabinetMemberStatus): Promise<void> {
    const member = this.member();
    if (!this.capabilities.canChangeStatus(member) || status === member.status || this.submitting()) {
      return;
    }
    const action = status === 'ACTIVE' ? 'REACTIVATE' : status;
    const confirmed = await this.confirm({
      titleKey: `IDENTITY.CABINET_TEAM.STATUS_CHANGE.${action}.TITLE`,
      descriptionKey: `IDENTITY.CABINET_TEAM.STATUS_CHANGE.${action}.DESCRIPTION`,
      confirmKey: `IDENTITY.CABINET_TEAM.STATUS_CHANGE.${action}.CONFIRM`,
      memberName: this.displayName(),
      danger: status === 'REVOKED'
    });
    if (!confirmed) return;
    await this.runMutation(
      () => this.api.updateMemberStatus(member.userId, { status }),
      'IDENTITY.CABINET_TEAM.NOTIFICATIONS.STATUS_UPDATED'
    );
  }

  protected updateDossierSearch(event: Event): void {
    this.dossierSearch.set((event.target as HTMLInputElement).value);
  }

  protected toggleAssignment(dossierOrgId: string, checked: boolean): void {
    const next = new Set(this.selectedAssignments());
    checked ? next.add(dossierOrgId) : next.delete(dossierOrgId);
    this.selectedAssignments.set(next);
  }

  protected async saveAssignments(): Promise<void> {
    const member = this.member();
    if (!this.capabilities.canManageAssignments(member) || !this.assignmentsChanged() || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.errorKey.set(null);
    try {
      const assignments = await this.api.replaceMemberAssignments(member.userId, {
        dossierOrgIds: [...this.selectedAssignments()]
      });
      const assignedIds = new Set(assignments.map((assignment) => assignment.dossierOrgId));
      this.originalAssignments.set(assignedIds);
      this.selectedAssignments.set(new Set(assignedIds));
      await this.invalidateMember(member.userId);
      this.notification.success(
        this.transloco.translate('IDENTITY.CABINET_TEAM.NOTIFICATIONS.ASSIGNMENTS_UPDATED')
      );
    } catch (error) {
      this.errorKey.set(
        cabinetTeamErrorKey(error, 'IDENTITY.CABINET_TEAM.ERRORS.ASSIGNMENTS_UPDATE_FAILED')
      );
    } finally {
      this.submitting.set(false);
    }
  }

  protected close(): void {
    this.dialogRef.close(true);
  }

  private async runMutation(
    operation: () => Promise<CabinetMember>,
    successKey: string
  ): Promise<void> {
    this.submitting.set(true);
    this.errorKey.set(null);
    try {
      const updated = await operation();
      this.member.set(updated);
      this.selectedRole.set(updated.cabinetRole);
      await this.invalidateMember(updated.userId);
      this.notification.success(this.transloco.translate(successKey));
    } catch (error) {
      this.errorKey.set(
        cabinetTeamErrorKey(error, 'IDENTITY.CABINET_TEAM.ERRORS.MEMBER_UPDATE_FAILED')
      );
    } finally {
      this.submitting.set(false);
    }
  }

  private async invalidateMember(memberUserId: string): Promise<void> {
    await Promise.all([
      this.queryClient.invalidateQueries({ queryKey: [...this.queries.all(), 'members'] }),
      this.queryClient.invalidateQueries({ queryKey: [...this.queries.all(), 'member', memberUserId] }),
      this.queryClient.invalidateQueries({ queryKey: [...this.queries.all(), 'assignments', memberUserId] }),
      this.queryClient.invalidateQueries({ queryKey: [...this.queries.all(), 'dossier-members'] })
    ]);
  }

  private async confirm(data: CabinetTeamConfirmDialogData): Promise<boolean> {
    return (
      (await firstValueFrom(
        this.dialog
          .open(CabinetTeamConfirmDialogComponent, {
            data,
            maxWidth: 'calc(100vw - 32px)',
            panelClass: 'liass-dialog-panel',
            restoreFocus: true,
            width: '480px'
          })
          .afterClosed()
      )) ?? false
    );
  }
}
