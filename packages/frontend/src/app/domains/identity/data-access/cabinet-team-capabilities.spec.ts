import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CabinetMemberSummary, CabinetRole } from '@liass-ohada/shared/shared';

import { AuthStore } from './auth.store';
import { CabinetTeamCapabilities } from './cabinet-team-capabilities';

const now = '2026-07-20T00:00:00.000Z';
const target = (
  cabinetRole: CabinetRole,
  overrides: Partial<CabinetMemberSummary> = {}
): CabinetMemberSummary => ({
  userId: 'target-1',
  cabinetRole,
  status: 'ACTIVE',
  updatedAt: now,
  isOwner: false,
  ...overrides
});

describe('CabinetTeamCapabilities', () => {
  const role = signal<CabinetRole | null>('CABINET_ADMIN');
  const currentUserId = signal<string | null>('actor-1');

  beforeEach(() => {
    role.set('CABINET_ADMIN');
    currentUserId.set('actor-1');
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthStore,
          useValue: {
            activeCabinetRole: role,
            currentUserId,
            canViewCabinetTeam: () => role() === 'CABINET_ADMIN' || role() === 'SUPERVISOR',
            canViewCabinetInvitations: () => role() === 'CABINET_ADMIN'
          }
        }
      ]
    });
  });

  it('grants complete team management only to Cabinet Administrators', () => {
    const capabilities = TestBed.inject(CabinetTeamCapabilities);
    expect(capabilities.canViewCabinetTeam()).toBe(true);
    expect(capabilities.canViewCabinetInvitations()).toBe(true);
    expect(capabilities.canInviteCabinetMember()).toBe(true);
    expect(capabilities.canChangeRole(target('COLLABORATOR'))).toBe(true);
    expect(capabilities.canChangeStatus(target('COLLABORATOR'))).toBe(true);
    expect(capabilities.canManageAssignments(target('READER'))).toBe(true);
  });

  it('protects the owner and implicit administrator assignment model', () => {
    const capabilities = TestBed.inject(CabinetTeamCapabilities);
    const owner = target('CABINET_ADMIN', { isOwner: true });
    expect(capabilities.canChangeRole(owner)).toBe(false);
    expect(capabilities.canChangeStatus(owner)).toBe(false);
    expect(capabilities.canManageAssignments(owner)).toBe(false);
  });

  it('limits Supervisors to eligible active Collaborators and Readers', () => {
    role.set('SUPERVISOR');
    const capabilities = TestBed.inject(CabinetTeamCapabilities);
    expect(capabilities.canViewCabinetTeam()).toBe(true);
    expect(capabilities.canViewCabinetInvitations()).toBe(false);
    expect(capabilities.canInviteCabinetMember()).toBe(false);
    expect(capabilities.canChangeRole(target('COLLABORATOR'))).toBe(false);
    expect(capabilities.canChangeStatus(target('COLLABORATOR'))).toBe(false);
    expect(capabilities.canSupervisorManageTarget(target('COLLABORATOR'))).toBe(true);
    expect(capabilities.canSupervisorManageTarget(target('READER'))).toBe(true);
    expect(capabilities.canSupervisorManageTarget(target('SUPERVISOR'))).toBe(false);
    expect(capabilities.canSupervisorManageTarget(target('CABINET_ADMIN'))).toBe(false);
    expect(capabilities.canSupervisorManageTarget(target('READER', { userId: 'actor-1' }))).toBe(false);
    expect(capabilities.canSupervisorManageTarget(target('READER', { status: 'SUSPENDED' }))).toBe(false);
  });

  it.each(['COLLABORATOR', 'READER'] as const)('%s cannot view or manage Team', (cabinetRole) => {
    role.set(cabinetRole);
    const capabilities = TestBed.inject(CabinetTeamCapabilities);
    expect(capabilities.canViewCabinetTeam()).toBe(false);
    expect(capabilities.canViewCabinetInvitations()).toBe(false);
    expect(capabilities.canManageSupervisedDossierAssignments()).toBe(false);
  });
});
