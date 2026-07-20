import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import type { CabinetRole } from '@liass-ohada/shared/shared';
import { vi } from 'vitest';

import { NotificationService } from '../../../../core/notifications/notification.service';
import { AuthStore } from '../../data-access/auth.store';
import { CabinetTeamApi } from '../../data-access/cabinet-team.api';
import { CabinetTeamPage } from './cabinet-team.page';

const now = '2026-07-20T00:00:00.000Z';
const translations = {
  en: {
    COMMON: {
      ACTIONS: { RETRY: 'Retry' },
      FILTERS: { ALL: 'All' },
      PAGINATION: { PREVIOUS: 'Previous', NEXT: 'Next' },
      NOT_AVAILABLE: 'Not provided'
    },
    IDENTITY: {
      CABINET_TEAM: {
        EYEBROW: 'Cabinet', TITLE: 'Team', SUBTITLE: 'Manage the team',
        TABS: { MEMBERS: 'Members', INVITATIONS: 'Invitations' },
        ACTIONS: { INVITE: 'Invite', VIEW_DETAILS: 'View details', MANAGE_ACCESS: 'Manage access' },
        FILTERS: { ROLE: 'Role', STATUS: 'Status' },
        ROLES: { CABINET_ADMIN: 'Cabinet Administrator', SUPERVISOR: 'Supervisor', COLLABORATOR: 'Collaborator', READER: 'Reader' },
        MEMBER_STATUS: { ACTIVE: 'Active', SUSPENDED: 'Suspended', REVOKED: 'Revoked' },
        INVITATION_STATUS: { PENDING: 'Pending', ACCEPTED: 'Accepted', EXPIRED: 'Expired', CANCELLED: 'Cancelled' },
        MEMBERS: { MEMBER: 'Member', EMAIL: 'Email', ROLE: 'Role', STATUS: 'Status', DOSSIERS: 'Dossiers', ACTIONS: 'Actions', OWNER: 'Owner', PROFILE_INCOMPLETE: 'Incomplete profile', LOADING: 'Loading', EMPTY: 'No members', ACTION_MENU: 'Actions {{name}}' },
        ASSIGNMENTS: { ALL_DOSSIERS: 'All dossiers', VIEW_DETAILS: 'View details' },
        INVITATIONS: { DELIVERY_UNAVAILABLE: 'Email unavailable' },
        ERRORS: { MEMBERS_LOAD_FAILED: 'Load failed', ACCESS_REVOKED: 'Access revoked' }
      }
    }
  }
};

describe('CabinetTeamPage', () => {
  async function create(role: CabinetRole): Promise<ComponentFixture<CabinetTeamPage>> {
    const api = {
      listMembers: vi.fn().mockResolvedValue({
        members: [
          {
            userId: 'internal-user-id',
            cabinetRole: 'CABINET_ADMIN',
            status: 'ACTIVE',
            displayName: 'Awa Mensah',
            email: 'awa@example.com',
            updatedAt: now,
            isOwner: true
          },
          {
            userId: 'missing-profile-id',
            cabinetRole: 'READER',
            status: 'ACTIVE',
            updatedAt: now,
            isOwner: false
          }
        ],
        hasMore: false
      }),
      listInvitations: vi.fn().mockResolvedValue({ invitations: [], hasMore: false }),
      listDossierMembers: vi.fn().mockResolvedValue([])
    };
    const activeRole = signal<CabinetRole | null>(role);
    await TestBed.configureTestingModule({
      imports: [
        CabinetTeamPage,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }
        })
      ],
      providers: [
        provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
        { provide: CabinetTeamApi, useValue: api },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
        {
          provide: AuthStore,
          useValue: {
            activeWorkspaceOrgId: () => 'org-cabinet',
            activeCabinetRole: activeRole,
            currentUserId: () => 'actor-1',
            canViewCabinetTeam: () => true,
            canViewCabinetInvitations: () => role === 'CABINET_ADMIN',
            dossiers: () => [],
            dossiersLoaded: () => true,
            dossierLoading: () => false,
            loadDossiers: vi.fn()
          }
        }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(CabinetTeamPage);
    fixture.detectChanges();
    for (let attempt = 0; attempt < 10 && !fixture.nativeElement.textContent.includes('Awa Mensah'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      fixture.detectChanges();
    }
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('shows human-readable profiles, owner protection, fallback, and Administrator tabs', async () => {
    const fixture = await create('CABINET_ADMIN');
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Awa Mensah');
    expect(text).toContain('Owner');
    expect(text).toContain('Incomplete profile');
    expect(text).toContain('Invitations');
    expect(text).not.toContain('internal-user-id');
    expect(text).not.toContain('missing-profile-id');
  });

  it('does not render the Invitations tab for a Supervisor', async () => {
    const fixture = await create('SUPERVISOR');
    expect(fixture.nativeElement.textContent).not.toContain('Invitations');
  });
});
