import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import type {
  CabinetInvitation,
  CabinetInvitationStatus,
  CabinetMemberStatus,
  CabinetMemberSummary,
  CabinetRole,
} from '@liass-ohada/shared/shared';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../../environments/environment';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { AuthStore } from '../../data-access/auth.store';
import { CabinetDashboardQueries } from '../../data-access/cabinet-dashboard.queries';
import { CabinetTeamApi } from '../../data-access/cabinet-team.api';
import { CabinetTeamCapabilities } from '../../data-access/cabinet-team-capabilities';
import {
  CabinetTeamQueries,
  type CabinetInvitationFilters,
  type CabinetMemberFilters,
} from '../../data-access/cabinet-team.queries';
import { CabinetMemberDialogComponent } from './cabinet-member-dialog.component';
import {
  CabinetTeamConfirmDialogComponent,
  type CabinetTeamConfirmDialogData,
} from './cabinet-team-confirm-dialog.component';
import {
  cabinetInvitationStatusKey,
  cabinetMemberStatusKey,
  cabinetRoleKey,
  cabinetTeamErrorKey,
  memberDisplayName,
  memberInitials,
} from './cabinet-team.presentation';
import { InviteCabinetMemberDialogComponent } from './invite-cabinet-member-dialog.component';

type FilterRole = CabinetRole | 'ALL';
type FilterMemberStatus = CabinetMemberStatus | 'ALL';
type FilterInvitationStatus = CabinetInvitationStatus | 'ALL';

@Component({
  selector: 'liass-cabinet-team-page',
  imports: [
    DatePipe,
    LiassButtonComponent,
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    LiassStatusChipComponent,
    MatCheckboxModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTabsModule,
    TranslocoModule,
  ],
  templateUrl: './cabinet-team.page.html',
})
export class CabinetTeamPage implements OnInit {
  private readonly api = inject(CabinetTeamApi);
  protected readonly authStore = inject(AuthStore);
  protected readonly capabilities = inject(CabinetTeamCapabilities);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly dashboardQueries = inject(CabinetDashboardQueries);
  protected readonly queries = inject(CabinetTeamQueries);
  private readonly transloco = inject(TranslocoService);

  protected readonly production = environment.production;
  protected readonly memberRole = signal<FilterRole>('ALL');
  protected readonly memberStatus = signal<FilterMemberStatus>('ALL');
  protected readonly memberCursor = signal<string | undefined>(undefined);
  protected readonly memberCursorHistory = signal<(string | undefined)[]>([]);
  protected readonly invitationStatus = signal<FilterInvitationStatus>('ALL');
  protected readonly invitationCursor = signal<string | undefined>(undefined);
  protected readonly invitationCursorHistory = signal<(string | undefined)[]>([]);
  protected readonly selectedDossierOrgId = signal('');
  protected readonly supervisorMutationUserId = signal<string | null>(null);
  protected readonly actionErrorKey = signal<string | null>(null);
  protected readonly developmentLink = signal<string | null>(null);

  protected readonly memberFilters = computed<CabinetMemberFilters>(() => {
    const role = this.memberRole();
    const status = this.memberStatus();
    return {
      limit: 25,
      cursor: this.memberCursor(),
      role: role === 'ALL' ? undefined : role,
      status: status === 'ALL' ? undefined : status,
    };
  });
  protected readonly invitationFilters = computed<CabinetInvitationFilters>(() => {
    const status = this.invitationStatus();
    return {
      limit: 25,
      cursor: this.invitationCursor(),
      status: status === 'ALL' ? undefined : status,
    };
  });

  protected readonly membersQuery = injectQuery(() => this.queries.members(this.memberFilters()));
  protected readonly invitationsQuery = injectQuery(() =>
    this.queries.invitations(this.invitationFilters()),
  );
  protected readonly dossierMembersQuery = injectQuery(() =>
    this.queries.dossierMembers(this.selectedDossierOrgId()),
  );
  protected readonly assignedSupervisorMemberIds = computed(
    () => new Set((this.dossierMembersQuery.data() ?? []).map((member) => member.userId)),
  );
  protected readonly memberPageContext = computed(() =>
    this.transloco.translate('IDENTITY.CABINET_TEAM.MEMBERS.PAGE_CONTEXT', {
      count: this.membersQuery.data()?.members?.length ?? 0,
      page: this.memberCursorHistory().length + 1,
    }),
  );
  protected readonly invitationPageContext = computed(() =>
    this.transloco.translate('IDENTITY.CABINET_TEAM.INVITATIONS.PAGE_CONTEXT', {
      count: this.invitationsQuery.data()?.invitations?.length ?? 0,
      page: this.invitationCursorHistory().length + 1,
    }),
  );
  protected readonly supervisorEligibleMembers = computed(() =>
    (this.membersQuery.data()?.members ?? []).filter((member) =>
      this.capabilities.canSupervisorManageTarget(member),
    ),
  );

  async ngOnInit(): Promise<void> {
    if (
      this.capabilities.canManageSupervisedDossierAssignments() &&
      !this.authStore.dossiersLoaded()
    ) {
      await this.authStore.loadDossiers();
    }
  }

  protected roleKey(role: CabinetRole): string {
    return cabinetRoleKey(role);
  }

  protected memberStatusKey(status: CabinetMemberStatus): string {
    return cabinetMemberStatusKey(status);
  }

  protected invitationStatusKey(status: CabinetInvitationStatus): string {
    return cabinetInvitationStatusKey(status);
  }

  protected memberName(member: CabinetMemberSummary): string {
    return (
      memberDisplayName(member) ??
      this.transloco.translate('IDENTITY.CABINET_TEAM.MEMBERS.PROFILE_INCOMPLETE')
    );
  }

  protected initials(member: CabinetMemberSummary): string {
    return memberInitials(member);
  }

  protected memberTone(status: CabinetMemberStatus): 'success' | 'warning' | 'danger' {
    return status === 'ACTIVE' ? 'success' : status === 'SUSPENDED' ? 'warning' : 'danger';
  }

  protected invitationTone(
    status: CabinetInvitationStatus,
  ): 'success' | 'warning' | 'danger' | 'neutral' {
    if (status === 'ACCEPTED') return 'success';
    if (status === 'PENDING') return 'warning';
    if (status === 'CANCELLED') return 'danger';
    return 'neutral';
  }

  protected isPendingInvitation(invitation: CabinetInvitation): boolean {
    return invitation.status === 'PENDING';
  }

  protected memberRoleChanged(value: FilterRole): void {
    this.memberRole.set(value);
    this.resetMemberPagination();
  }

  protected memberStatusChanged(value: FilterMemberStatus): void {
    this.memberStatus.set(value);
    this.resetMemberPagination();
  }

  protected invitationStatusChanged(value: FilterInvitationStatus): void {
    this.invitationStatus.set(value);
    this.invitationCursor.set(undefined);
    this.invitationCursorHistory.set([]);
  }

  protected nextMembersPage(): void {
    const cursor = this.membersQuery.data()?.nextCursor;
    if (!cursor) return;
    this.memberCursorHistory.update((history) => [...history, this.memberCursor()]);
    this.memberCursor.set(cursor);
  }

  protected previousMembersPage(): void {
    const history = [...this.memberCursorHistory()];
    if (!history.length) return;
    this.memberCursor.set(history.pop());
    this.memberCursorHistory.set(history);
  }

  protected nextInvitationsPage(): void {
    const cursor = this.invitationsQuery.data()?.nextCursor;
    if (!cursor) return;
    this.invitationCursorHistory.update((history) => [...history, this.invitationCursor()]);
    this.invitationCursor.set(cursor);
  }

  protected previousInvitationsPage(): void {
    const history = [...this.invitationCursorHistory()];
    if (!history.length) return;
    this.invitationCursor.set(history.pop());
    this.invitationCursorHistory.set(history);
  }

  protected openInvitationDialog(): void {
    if (!this.capabilities.canInviteCabinetMember() || this.production) return;
    this.dialog.open(InviteCabinetMemberDialogComponent, {
      autoFocus: 'first-tabbable',
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '680px',
    });
  }

  protected openMember(member: CabinetMemberSummary): void {
    if (!this.capabilities.canViewCabinetInvitations()) return;
    this.dialog.open(CabinetMemberDialogComponent, {
      data: { member },
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '720px',
    });
  }

  protected async cancelInvitation(invitation: CabinetInvitation): Promise<void> {
    if (!this.capabilities.canCancelCabinetInvitation() || !this.isPendingInvitation(invitation)) {
      return;
    }
    const confirmed = await this.confirm({
      titleKey: 'IDENTITY.CABINET_TEAM.INVITATIONS.CANCEL_TITLE',
      descriptionKey: 'IDENTITY.CABINET_TEAM.INVITATIONS.CANCEL_DESCRIPTION',
      confirmKey: 'IDENTITY.CABINET_TEAM.ACTIONS.CANCEL_INVITATION',
      memberName: invitation.email,
      danger: true,
    });
    if (!confirmed) return;
    await this.invitationMutation(
      () => this.api.cancelInvitation(invitation.invitationId),
      'IDENTITY.CABINET_TEAM.NOTIFICATIONS.INVITATION_CANCELLED',
    );
  }

  protected async resendInvitation(invitation: CabinetInvitation): Promise<void> {
    if (!this.capabilities.canResendCabinetInvitation() || !this.isPendingInvitation(invitation)) {
      return;
    }
    const confirmed = await this.confirm({
      titleKey: 'IDENTITY.CABINET_TEAM.INVITATIONS.RESEND_TITLE',
      descriptionKey: 'IDENTITY.CABINET_TEAM.INVITATIONS.RESEND_DESCRIPTION',
      confirmKey: 'IDENTITY.CABINET_TEAM.ACTIONS.RESEND',
    });
    if (!confirmed) return;
    this.developmentLink.set(null);
    try {
      const response = await this.api.resendInvitation(invitation.invitationId);
      if (response.deliveryMode === 'DEVELOPMENT_TOKEN' && response.invitationToken) {
        this.developmentLink.set(
          `${window.location.origin}/accept-invitation?token=${encodeURIComponent(response.invitationToken)}`,
        );
      }
      await this.invalidateInvitations();
      await this.invalidateDashboard();
      this.notification.success(
        this.transloco.translate(
          response.deliveryMode === 'DEVELOPMENT_TOKEN'
            ? 'IDENTITY.CABINET_TEAM.NOTIFICATIONS.INVITATION_RENEWED_DEV'
            : 'IDENTITY.CABINET_TEAM.NOTIFICATIONS.INVITATION_RENEWED_NO_DELIVERY',
        ),
      );
    } catch (error) {
      this.actionErrorKey.set(
        cabinetTeamErrorKey(error, 'IDENTITY.CABINET_TEAM.ERRORS.INVITATION_RESEND_FAILED'),
      );
    }
  }

  protected async copyDevelopmentLink(): Promise<void> {
    const link = this.developmentLink();
    if (!link) return;
    await navigator.clipboard.writeText(link);
    this.notification.success(
      this.transloco.translate('IDENTITY.CABINET_TEAM.NOTIFICATIONS.LINK_COPIED'),
    );
  }

  protected selectSupervisorDossier(dossierOrgId: string): void {
    this.selectedDossierOrgId.set(dossierOrgId);
    this.actionErrorKey.set(null);
  }

  protected async toggleSupervisorAssignment(
    member: CabinetMemberSummary,
    assigned: boolean,
  ): Promise<void> {
    const dossierOrgId = this.selectedDossierOrgId();
    if (!dossierOrgId || !this.capabilities.canSupervisorManageTarget(member)) return;
    this.supervisorMutationUserId.set(member.userId);
    this.actionErrorKey.set(null);
    try {
      if (assigned) {
        await this.api.addDossierMember(dossierOrgId, member.userId);
      } else {
        await this.api.removeDossierMember(dossierOrgId, member.userId);
      }
      await Promise.all([
        this.queryClient.invalidateQueries({
          queryKey: [...this.queries.all(), 'dossier-members', dossierOrgId],
        }),
        this.queryClient.invalidateQueries({
          queryKey: [...this.queries.all(), 'assignments', member.userId],
        }),
        this.invalidateDashboard(),
      ]);
      this.notification.success(
        this.transloco.translate('IDENTITY.CABINET_TEAM.NOTIFICATIONS.ASSIGNMENT_UPDATED'),
      );
    } catch (error) {
      this.actionErrorKey.set(
        cabinetTeamErrorKey(error, 'IDENTITY.CABINET_TEAM.ERRORS.ASSIGNMENTS_UPDATE_FAILED'),
      );
    } finally {
      this.supervisorMutationUserId.set(null);
    }
  }

  private resetMemberPagination(): void {
    this.memberCursor.set(undefined);
    this.memberCursorHistory.set([]);
  }

  private async invitationMutation(
    operation: () => Promise<unknown>,
    successKey: string,
  ): Promise<void> {
    this.actionErrorKey.set(null);
    try {
      await operation();
      await this.invalidateInvitations();
      await this.invalidateDashboard();
      this.notification.success(this.transloco.translate(successKey));
    } catch (error) {
      this.actionErrorKey.set(
        cabinetTeamErrorKey(error, 'IDENTITY.CABINET_TEAM.ERRORS.INVITATION_UPDATE_FAILED'),
      );
    }
  }

  private invalidateInvitations(): Promise<void> {
    return this.queryClient.invalidateQueries({
      queryKey: [...this.queries.all(), 'invitations'],
    });
  }

  private invalidateDashboard(): Promise<void> {
    return this.queryClient.invalidateQueries({
      queryKey: this.dashboardQueries.all(),
    });
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
            width: '480px',
          })
          .afterClosed(),
      )) ?? false
    );
  }
}
