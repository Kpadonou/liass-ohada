import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import type { CabinetDossierAssignment, CabinetMember, CabinetRole } from '@liass-ohada/shared/shared';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { NotificationService } from '../../../../core/notifications/notification.service';
import { AuthStore } from '../../data-access/auth.store';
import { CabinetTeamApi } from '../../data-access/cabinet-team.api';
import { CabinetMemberDialogComponent } from './cabinet-member-dialog.component';

const now = '2026-07-20T00:00:00.000Z';
const translations = {
  en: {
    COMMON: {
      ACTIONS: { CLOSE: 'Close', SAVE: 'Save' },
      NOT_AVAILABLE: 'Not provided'
    },
    IDENTITY: {
      CABINET_TEAM: {
        ROLES: {
          CABINET_ADMIN: 'Cabinet Administrator',
          SUPERVISOR: 'Supervisor',
          COLLABORATOR: 'Collaborator',
          READER: 'Reader'
        },
        MEMBER_STATUS: { ACTIVE: 'Active', SUSPENDED: 'Suspended', REVOKED: 'Revoked' },
        MEMBERS: {
          OWNER: 'Owner',
          PROFILE_INCOMPLETE: 'Incomplete profile',
          LOADING_DETAIL: 'Loading detail',
          ROLE: 'Role',
          STATUS: 'Status',
          JOINED_AT: 'Joined',
          INVITATION_SOURCE: 'Access source',
          INVITED: 'Invited',
          DIRECT_ACCESS: 'Direct access',
          OWNER_PROTECTION: 'Owner protected'
        },
        ROLE_CHANGE: {
          TITLE: 'Change role',
          NEW_ROLE: 'New role',
          DEMOTE_ADMIN: 'Demote admin warning',
          PROMOTE_ADMIN: 'Promote admin warning',
          TO_READER: 'Reader warning',
          GENERIC: 'Role warning'
        },
        STATUS_CHANGE: { TITLE: 'Manage status' },
        ASSIGNMENTS: {
          TITLE: 'Dossier access',
          ALL_DOSSIERS: 'All dossiers',
          ADMIN_IMPLICIT: 'Implicit access granted by the Cabinet Administrator role.',
          DIFF: '{{added}} added, {{removed}} removed',
          SAVE: 'Save access'
        },
        DOSSIER_SELECTOR: {
          SEARCH: 'Search dossiers',
          EMPTY: 'No matching dossier.',
          LOADING: 'Loading dossiers...',
          COUNT: '{{count}} selected',
          COUNT_WITH_MAX: '{{count}}/{{max}} selected',
          MAX_REACHED: 'Maximum {{max}} dossiers selected.'
        },
        NOTIFICATIONS: {
          ASSIGNMENTS_UPDATED: 'Assignments updated'
        },
        ERRORS: {
          MEMBER_LOAD_FAILED: 'Member load failed',
          ASSIGNMENTS_UPDATE_FAILED: 'Assignments update failed'
        }
      },
      CABINET_DOSSIERS: {
        STATUS: { ACTIVE: 'Active' }
      },
      ONBOARDING: {
        COUNTRIES: { BENIN: 'Benin', TOGO: 'Togo' },
        FRAMEWORKS: { SYSCOHADA_REVISED: 'Revised SYSCOHADA', SYCEBNL: 'SYCEBNL' }
      }
    }
  }
};

type MemberDialogTestComponent = CabinetMemberDialogComponent & {
  selectedAssignments(): Set<string>;
  updateSelectedAssignments(dossierOrgIds: Set<string>): void;
  saveAssignments(): Promise<void>;
};

describe('CabinetMemberDialogComponent', () => {
  async function create(role: CabinetRole): Promise<{
    fixture: ComponentFixture<CabinetMemberDialogComponent>;
    api: {
      getMember: ReturnType<typeof vi.fn>;
      listMemberAssignments: ReturnType<typeof vi.fn>;
      replaceMemberAssignments: ReturnType<typeof vi.fn>;
    };
  }> {
    const member = cabinetMember(role);
    const assignments = [assignment('org-dona')];
    const api = {
      getMember: vi.fn().mockResolvedValue(member),
      listMemberAssignments: vi.fn().mockResolvedValue(assignments),
      replaceMemberAssignments: vi.fn().mockResolvedValue([
        assignment('org-dona'),
        assignment('org-re')
      ]),
      updateMemberRole: vi.fn(),
      updateMemberStatus: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        CabinetMemberDialogComponent,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }
        })
      ],
      providers: [
        provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
        { provide: CabinetTeamApi, useValue: api },
        { provide: MAT_DIALOG_DATA, useValue: { member } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
        {
          provide: AuthStore,
          useValue: {
            activeWorkspaceOrgId: () => 'org-cabinet',
            activeCabinetRole: () => 'CABINET_ADMIN',
            currentUserId: () => 'admin-1',
            canViewCabinetInvitations: () => true,
            dossiers: () => [
              {
                orgId: 'org-dona',
                displayName: 'DONA SHOP',
                country: 'BJ',
                accountingFramework: 'SYSCOHADA_REVISED',
                status: 'ACTIVE',
                accessMode: 'READ_WRITE',
                createdAt: now,
                updatedAt: now
              },
              {
                orgId: 'org-re',
                displayName: 'RE',
                country: 'TG',
                accountingFramework: 'SYCEBNL',
                status: 'ACTIVE',
                accessMode: 'READ_WRITE',
                createdAt: now,
                updatedAt: now
              }
            ],
            dossiersLoaded: () => true,
            dossierLoading: () => false,
            dossierError: () => null,
            loadDossiers: vi.fn()
          }
        }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(CabinetMemberDialogComponent);
    fixture.detectChanges();
    for (
      let attempt = 0;
      attempt < 10 && fixture.nativeElement.textContent.includes('Loading detail');
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      fixture.detectChanges();
    }
    return { fixture, api };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('uses the reusable selector, initializes assignments, and blocks no-change saves', async () => {
    const { fixture, api } = await create('COLLABORATOR');
    const component = fixture.componentInstance as unknown as MemberDialogTestComponent;

    expect(fixture.nativeElement.querySelector('liass-dossier-multi-select')).not.toBeNull();
    expect(component.selectedAssignments().has('org-dona')).toBe(true);

    await component.saveAssignments();
    expect(api.replaceMemberAssignments).not.toHaveBeenCalled();
  });

  it('computes and saves assignment additions from the selector', async () => {
    const { fixture, api } = await create('READER');
    const component = fixture.componentInstance as unknown as MemberDialogTestComponent;

    component.updateSelectedAssignments(new Set(['org-dona', 'org-re']));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('1 added, 0 removed');
    await component.saveAssignments();
    expect(api.replaceMemberAssignments).toHaveBeenCalledWith('member-1', {
      dossierOrgIds: ['org-dona', 'org-re']
    });
  });

  it('shows implicit all-dossier access for Cabinet Administrator targets', async () => {
    const { fixture, api } = await create('CABINET_ADMIN');

    expect(fixture.nativeElement.querySelector('liass-dossier-multi-select')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('All dossiers');
    expect(fixture.nativeElement.textContent).toContain(
      'Implicit access granted by the Cabinet Administrator role.'
    );
    expect(api.listMemberAssignments).not.toHaveBeenCalled();
  });
});

function cabinetMember(role: CabinetRole): CabinetMember {
  return {
    userId: 'member-1',
    cabinetRole: role,
    status: 'ACTIVE',
    displayName: 'Awa Mensah',
    email: 'awa@example.com',
    joinedAt: now,
    updatedAt: now,
    isOwner: false
  };
}

function assignment(dossierOrgId: string): CabinetDossierAssignment {
  return {
    userId: 'member-1',
    dossierOrgId,
    assignedBy: 'admin-1',
    assignedAt: now
  };
}
