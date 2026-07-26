import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import type { CabinetRole } from '@liass-ohada/shared/shared';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { NotificationService } from '../../../../core/notifications/notification.service';
import { AuthStore } from '../../data-access/auth.store';
import { CabinetTeamApi } from '../../data-access/cabinet-team.api';
import { InviteCabinetMemberDialogComponent } from './invite-cabinet-member-dialog.component';

const now = '2026-07-20T00:00:00.000Z';
type InviteDialogTestComponent = InviteCabinetMemberDialogComponent & {
  production: boolean;
  form: {
    controls: {
      email: { setValue(value: string): void };
      role: { setValue(value: CabinetRole): void };
    };
  };
  selectedDossiers(): Set<string>;
  updateSelectedDossiers(dossierOrgIds: Set<string>): void;
  submit(): Promise<void>;
  developmentLink(): string | null;
};
type InvitationFixture = {
  invitationId: string;
  email: string;
  role: CabinetRole;
  status: 'PENDING';
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  initialDossierOrgIds: string[];
};
const translations = {
  en: {
    COMMON: {
      ACTIONS: { CANCEL: 'Cancel', CLOSE: 'Close', COPY: 'Copy' }
    },
    IDENTITY: {
      CABINET_TEAM: {
        INVITE: {
          TITLE: 'Invite a member',
          SUBTITLE: 'Choose a role and initial dossiers.',
          EMAIL: 'Email address',
          EMAIL_ERROR: 'Enter a valid email address.',
          ROLE: 'Role',
          DOSSIERS: 'Dossiers to assign',
          ADMIN_ALL_DOSSIERS: 'Cabinet Administrators have access to all client dossiers.',
          CREATE: 'Create invitation',
          DEV_LINK_TITLE: 'Development tool',
          DEV_LINK_HELP: 'Email delivery is not configured in this environment yet.'
        },
        DOSSIER_SELECTOR: {
          SEARCH: 'Search dossiers',
          EMPTY: 'No matching dossier.',
          LOADING: 'Loading dossiers...',
          COUNT: '{{count}} selected',
          COUNT_WITH_MAX: '{{count}}/{{max}} selected',
          MAX_REACHED: 'Maximum {{max}} dossiers selected.'
        },
        ROLES: {
          CABINET_ADMIN: 'Cabinet Administrator',
          SUPERVISOR: 'Supervisor',
          COLLABORATOR: 'Collaborator',
          READER: 'Reader'
        },
        INVITATIONS: { DELIVERY_UNAVAILABLE: 'Email unavailable' },
        NOTIFICATIONS: {
          INVITATION_CREATED_DEV: 'Invitation created',
          LINK_COPIED: 'Link copied'
        },
        ERRORS: {
          ASSIGNMENT_LIMIT: 'Too many dossiers',
          INVITATION_CREATE_FAILED: 'Unable to create invitation'
        }
      },
      CABINET_DOSSIERS: {
        STATUS: { ACTIVE: 'Active' }
      },
      ONBOARDING: {
        COUNTRIES: { BENIN: 'Benin' },
        FRAMEWORKS: { SYSCOHADA_REVISED: 'Revised SYSCOHADA' }
      }
    }
  }
};

describe('InviteCabinetMemberDialogComponent', () => {
  let fixture: ComponentFixture<InviteCabinetMemberDialogComponent>;
  let api: { createInvitation: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    api = {
      createInvitation: vi.fn().mockResolvedValue({
        deliveryMode: 'UNAVAILABLE',
        invitation: invitation()
      })
    };
    await TestBed.configureTestingModule({
      imports: [
        InviteCabinetMemberDialogComponent,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }
        })
      ],
      providers: [
        provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
        { provide: CabinetTeamApi, useValue: api },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
        {
          provide: AuthStore,
          useValue: {
            activeWorkspaceOrgId: () => 'org-cabinet',
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

    fixture = TestBed.createComponent(InviteCabinetMemberDialogComponent);
    testComponent().production = false;
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  function testComponent(): InviteDialogTestComponent {
    return fixture.componentInstance as unknown as InviteDialogTestComponent;
  }

  function text(): string {
    return fixture.nativeElement.textContent;
  }

  it.each<CabinetRole>(['SUPERVISOR', 'COLLABORATOR', 'READER'])(
    'shows the reusable dossier selector for %s invitations',
    (role) => {
      testComponent().form.controls.role.setValue(role);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('liass-dossier-multi-select')).not.toBeNull();
      expect(text()).toContain('0/20 selected');
    }
  );

  it('hides dossier selection and excludes selected dossier IDs for Cabinet Administrators', async () => {
    testComponent().form.controls.email.setValue('admin@example.com');
    testComponent().form.controls.role.setValue('CABINET_ADMIN');
    testComponent().updateSelectedDossiers(new Set(['org-dona']));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('liass-dossier-multi-select')).toBeNull();
    expect(text()).toContain('Cabinet Administrators have access to all client dossiers.');

    await testComponent().submit();
    expect(api.createInvitation).toHaveBeenCalledWith({
      email: 'admin@example.com',
      role: 'CABINET_ADMIN',
      initialDossierOrgIds: []
    });
  });

  it('keeps the business invitation action separate from development tooling', () => {
    expect(text()).toContain('Create invitation');
    expect(text()).not.toContain('Development tool');
  });

  it('shows the development link section only when the backend returns a token', async () => {
    api.createInvitation.mockResolvedValueOnce({
      deliveryMode: 'DEVELOPMENT_TOKEN',
      invitationToken: 'a'.repeat(48),
      invitation: invitation({ initialDossierOrgIds: ['org-dona'] })
    });
    testComponent().form.controls.email.setValue('reader@example.com');
    testComponent().form.controls.role.setValue('READER');
    testComponent().updateSelectedDossiers(new Set(['org-dona']));

    await testComponent().submit();
    fixture.detectChanges();

    expect(text()).toContain('Development tool');
    expect(testComponent().developmentLink()).toContain('/accept-invitation?token=');
    expect(api.createInvitation).toHaveBeenCalledWith({
      email: 'reader@example.com',
      role: 'READER',
      initialDossierOrgIds: ['org-dona']
    });
  });
});

function invitation(overrides: Partial<InvitationFixture> = {}): InvitationFixture {
  return {
    invitationId: 'invitation-1',
    email: 'reader@example.com',
    role: 'READER' as CabinetRole,
    status: 'PENDING' as const,
    invitedBy: 'inviter-1',
    createdAt: now,
    expiresAt: '2026-07-27T00:00:00.000Z',
    initialDossierOrgIds: [],
    ...overrides
  };
}
