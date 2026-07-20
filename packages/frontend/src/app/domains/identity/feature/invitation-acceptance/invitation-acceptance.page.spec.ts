import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { vi } from 'vitest';

import { AuthStore } from '../../data-access/auth.store';
import { CabinetTeamApi } from '../../data-access/cabinet-team.api';
import { InvitationAcceptanceState } from '../../data-access/invitation-acceptance-state';
import { InvitationAcceptancePage } from './invitation-acceptance.page';

const translations = {
  en: {
    COMMON: { ACTIONS: { CANCEL: 'Cancel' } },
    IDENTITY: {
      INVITATION_ACCEPTANCE: {
        TITLE: 'Join the Cabinet',
        READY: 'Ready',
        ACCEPT: 'Accept invitation',
        ACCEPTING: 'Accepting',
        SUCCESS_TITLE: 'Invitation accepted',
        SUCCESS_DESCRIPTION: 'Success',
        CONTINUE: 'Continue',
        LEAVE: 'Leave',
        EMAIL_MISMATCH_HELP: 'Use the invited email',
        STATES: {
          EMAIL_MISMATCH: { TITLE: 'Different email', DESCRIPTION: 'Mismatch' },
          EXPIRED: { TITLE: 'Expired', DESCRIPTION: 'Expired' },
          CANCELLED: { TITLE: 'Cancelled', DESCRIPTION: 'Cancelled' },
          ACCEPTED: { TITLE: 'Accepted', DESCRIPTION: 'Accepted' },
          INVALID: { TITLE: 'Invalid', DESCRIPTION: 'Invalid' },
          ERROR: { TITLE: 'Error', DESCRIPTION: 'Error' }
        }
      }
    }
  }
};

describe('InvitationAcceptancePage', () => {
  let fixture: ComponentFixture<InvitationAcceptancePage>;
  let api: { acceptInvitation: ReturnType<typeof vi.fn> };
  let authStore: {
    refreshUserProfile: ReturnType<typeof vi.fn>;
    loadWorkspaces: ReturnType<typeof vi.fn>;
    workspaceDestination: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    sessionStorage.clear();
    localStorage.clear();
    api = { acceptInvitation: vi.fn() };
    authStore = {
      refreshUserProfile: vi.fn().mockResolvedValue(undefined),
      loadWorkspaces: vi.fn().mockResolvedValue([]),
      workspaceDestination: vi.fn().mockReturnValue('/cabinet/dashboard')
    };
    await TestBed.configureTestingModule({
      imports: [
        InvitationAcceptancePage,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }
        })
      ],
      providers: [
        provideRouter([]),
        { provide: CabinetTeamApi, useValue: api },
        { provide: AuthStore, useValue: authStore }
      ]
    }).compileComponents();
  });

  it('accepts with the session token, refreshes identity/workspaces, and clears the token', async () => {
    const acceptanceState = TestBed.inject(InvitationAcceptanceState);
    const token = 'a'.repeat(48);
    acceptanceState.captureToken(token);
    api.acceptInvitation.mockResolvedValue({ member: {}, assignments: [] });
    fixture = TestBed.createComponent(InvitationAcceptancePage);
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as {
      accept(): Promise<void>;
      state(): string;
    };
    await page.accept();
    expect(api.acceptInvitation).toHaveBeenCalledWith(token);
    expect(authStore.refreshUserProfile).toHaveBeenCalled();
    expect(authStore.loadWorkspaces).toHaveBeenCalledWith(true);
    expect(acceptanceState.token()).toBeNull();
    expect(page.state()).toBe('SUCCESS');
    expect(JSON.stringify(localStorage)).not.toContain(token);
  });

  it('maps email mismatch without exposing or retaining the raw token', async () => {
    const acceptanceState = TestBed.inject(InvitationAcceptanceState);
    const token = 'b'.repeat(48);
    acceptanceState.captureToken(token);
    api.acceptInvitation.mockRejectedValue(
      new HttpErrorResponse({
        status: 409,
        error: { message: { code: 'CABINET_INVITATION_EMAIL_MISMATCH' } }
      })
    );
    fixture = TestBed.createComponent(InvitationAcceptancePage);
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as {
      accept(): Promise<void>;
      state(): string;
    };
    await page.accept();
    fixture.detectChanges();
    expect(page.state()).toBe('EMAIL_MISMATCH');
    expect(acceptanceState.token()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain(token);
  });
});
