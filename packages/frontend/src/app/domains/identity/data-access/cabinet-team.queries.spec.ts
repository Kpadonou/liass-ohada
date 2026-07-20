import { TestBed } from '@angular/core/testing';

import { AuthStore } from './auth.store';
import { CabinetTeamApi } from './cabinet-team.api';
import { CabinetTeamQueries } from './cabinet-team.queries';

describe('CabinetTeamQueries', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: CabinetTeamApi, useValue: {} },
        {
          provide: AuthStore,
          useValue: {
            activeWorkspaceOrgId: () => 'org-cabinet',
            canViewCabinetTeam: () => true,
            canViewCabinetInvitations: () => true
          }
        }
      ]
    });
  });

  it('creates tenant-aware member, invitation, assignment, and dossier-member keys', () => {
    const queries = TestBed.inject(CabinetTeamQueries);
    expect(
      queries.members({ limit: 25, role: 'READER', status: 'ACTIVE', cursor: 'cursor-1' }).queryKey
    ).toEqual([
      'cabinet-team',
      'org-cabinet',
      'members',
      { limit: 25, role: 'READER', status: 'ACTIVE', cursor: 'cursor-1' }
    ]);
    expect(queries.invitations({ limit: 25, status: 'PENDING' }).queryKey).toEqual([
      'cabinet-team',
      'org-cabinet',
      'invitations',
      { limit: 25, status: 'PENDING' }
    ]);
    expect(queries.assignments('member-1').queryKey).toEqual([
      'cabinet-team', 'org-cabinet', 'assignments', 'member-1'
    ]);
    expect(queries.dossierMembers('org-client').queryKey).toEqual([
      'cabinet-team', 'org-cabinet', 'dossier-members', 'org-client'
    ]);
  });
});
