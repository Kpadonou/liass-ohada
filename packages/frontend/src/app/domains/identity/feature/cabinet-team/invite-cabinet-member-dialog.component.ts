import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { CabinetRole } from '@liass-ohada/shared/shared';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { environment } from '../../../../../environments/environment';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { AuthStore } from '../../data-access/auth.store';
import { CabinetTeamApi } from '../../data-access/cabinet-team.api';
import { CabinetTeamQueries } from '../../data-access/cabinet-team.queries';
import { cabinetRoleKey, cabinetTeamErrorKey } from './cabinet-team.presentation';

const INVITABLE_ROLES: readonly CabinetRole[] = [
  'CABINET_ADMIN',
  'SUPERVISOR',
  'COLLABORATOR',
  'READER'
];
const MAX_INITIAL_ASSIGNMENTS = 20;

@Component({
  selector: 'liass-invite-cabinet-member-dialog',
  imports: [
    LiassButtonComponent,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslocoModule
  ],
  templateUrl: './invite-cabinet-member-dialog.component.html'
})
export class InviteCabinetMemberDialogComponent implements OnInit {
  private readonly api = inject(CabinetTeamApi);
  protected readonly authStore = inject(AuthStore);
  private readonly dialogRef = inject<MatDialogRef<InviteCabinetMemberDialogComponent, boolean>>(
    MatDialogRef
  );
  private readonly formBuilder = inject(FormBuilder);
  private readonly notification = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly queries = inject(CabinetTeamQueries);
  private readonly transloco = inject(TranslocoService);

  protected readonly roles = INVITABLE_ROLES;
  protected readonly production = environment.production;
  protected readonly selectedDossiers = signal<Set<string>>(new Set());
  protected readonly dossierSearch = signal('');
  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly developmentLink = signal<string | null>(null);
  protected readonly filteredDossiers = computed(() => {
    const search = this.dossierSearch().trim().toLocaleLowerCase();
    return this.authStore.dossiers().filter(
      (dossier) => !search || dossier.displayName.toLocaleLowerCase().includes(search)
    );
  });

  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    role: ['COLLABORATOR' as CabinetRole, Validators.required]
  });

  async ngOnInit(): Promise<void> {
    if (!this.authStore.dossiersLoaded()) {
      await this.authStore.loadDossiers();
    }
  }

  protected roleKey(role: CabinetRole): string {
    return cabinetRoleKey(role);
  }

  protected assignmentsAvailable(): boolean {
    return this.form.controls.role.value !== 'CABINET_ADMIN';
  }

  protected updateDossierSearch(event: Event): void {
    this.dossierSearch.set((event.target as HTMLInputElement).value);
  }

  protected toggleDossier(dossierOrgId: string, checked: boolean): void {
    const next = new Set(this.selectedDossiers());
    checked ? next.add(dossierOrgId) : next.delete(dossierOrgId);
    this.selectedDossiers.set(next);
  }

  protected async submit(): Promise<void> {
    if (this.production || this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    const dossierOrgIds = this.assignmentsAvailable()
      ? [...this.selectedDossiers()]
      : [];
    if (dossierOrgIds.length > MAX_INITIAL_ASSIGNMENTS) {
      this.errorKey.set('IDENTITY.CABINET_TEAM.ERRORS.ASSIGNMENT_LIMIT');
      return;
    }
    this.submitting.set(true);
    this.errorKey.set(null);
    this.developmentLink.set(null);
    try {
      const value = this.form.getRawValue();
      const response = await this.api.createInvitation({
        email: value.email,
        role: value.role,
        initialDossierOrgIds: dossierOrgIds
      });
      await this.queryClient.invalidateQueries({
        queryKey: [...this.queries.all(), 'invitations']
      });
      if (response.deliveryMode === 'DEVELOPMENT_TOKEN' && response.invitationToken) {
        const origin = typeof window === 'undefined' ? '' : window.location.origin;
        this.developmentLink.set(
          `${origin}/accept-invitation?token=${encodeURIComponent(response.invitationToken)}`
        );
        this.notification.success(
          this.transloco.translate('IDENTITY.CABINET_TEAM.NOTIFICATIONS.INVITATION_CREATED_DEV')
        );
      } else {
        this.errorKey.set('IDENTITY.CABINET_TEAM.INVITATIONS.DELIVERY_UNAVAILABLE');
      }
    } catch (error) {
      this.errorKey.set(
        cabinetTeamErrorKey(error, 'IDENTITY.CABINET_TEAM.ERRORS.INVITATION_CREATE_FAILED')
      );
    } finally {
      this.submitting.set(false);
    }
  }

  protected async copyDevelopmentLink(): Promise<void> {
    const link = this.developmentLink();
    if (!link || typeof navigator === 'undefined') return;
    await navigator.clipboard.writeText(link);
    this.notification.success(
      this.transloco.translate('IDENTITY.CABINET_TEAM.NOTIFICATIONS.LINK_COPIED')
    );
  }

  protected close(): void {
    this.developmentLink.set(null);
    this.dialogRef.close(true);
  }
}
