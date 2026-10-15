import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { Router, provideRouter } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { HttpErrorResponse } from '@angular/common/http';
import { OrganizationInvitationsApi } from '../../data-access/organization-invitations.api';
import { InvitationAcceptanceState } from '../../data-access/invitation-acceptance-state';
import { AuthStore } from '../../data-access/auth.store';
import { NotificationService } from '../../../../core/notifications/notification.service';
import {
  InviteCompanyMemberDialogComponent,
  developmentInvitationLink,
} from './invite-company-member-dialog.component';
import { CompanyInvitationAcceptancePage } from './company-invitation-acceptance.page';
import { invitationError } from './invitation-errors';
import fr from '../../../../../../public/assets/i18n/fr.json';
const create = vi.fn(),
  accept = vi.fn(),
  close = vi.fn(),
  invalidate = vi.fn(),
  refresh = vi.fn(),
  workspaces = vi.fn();
const user = signal('owner');
beforeEach(() => {
  vi.resetAllMocks();
  user.set('owner');
  sessionStorage.clear();
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: { fr },
        preloadLangs: true,
        translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
      }),
    ],
    providers: [
      provideRouter([]),
      { provide: OrganizationInvitationsApi, useValue: { create, accept, canCreate: () => true } },
      { provide: MatDialogRef, useValue: { close } },
      { provide: MAT_DIALOG_DATA, useValue: { org: 'org', user: 'owner' } },
      { provide: NotificationService, useValue: { success: vi.fn() } },
      { provide: QueryClient, useValue: { invalidateQueries: invalidate } },
      {
        provide: AuthStore,
        useValue: { currentUserId: user, refreshUserProfile: refresh, loadWorkspaces: workspaces },
      },
    ],
  });
  vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
});
afterEach(() => TestBed.resetTestingModule());
it('retains one immutable intent across ambiguous creation retries and never claims email delivery', async () => {
  create
    .mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }))
    .mockResolvedValueOnce({ invitation: {}, deliveryMode: 'UNAVAILABLE' });
  const fixture = TestBed.createComponent(InviteCompanyMemberDialogComponent),
    c = fixture.componentInstance;
  c.email.setValue('person@example.test');
  await c.submit();
  await c.submit();
  fixture.detectChanges();
  expect(create.mock.calls[0][2]).toEqual(create.mock.calls[1][2]);
  expect(c.email.disabled).toBe(true);
  expect(c.created()).toBe(true);
  expect(fixture.nativeElement.textContent).toContain('Invitation créée');
  expect(fixture.nativeElement.textContent).not.toContain('Invitation envoyée');
  expect(c.link()).toBeNull();
});
it('validates email through the shared contract', async () => {
  const c = TestBed.createComponent(InviteCompanyMemberDialogComponent).componentInstance;
  c.email.setValue('invalid');
  await c.submit();
  expect(create).not.toHaveBeenCalled();
  expect(c.email.touched).toBe(true);
});
it('gates development links independently of a returned token and encodes the canonical route', () => {
  expect(developmentInvitationLink('secret', true, 'https://app.test')).toBeNull();
  expect(developmentInvitationLink(undefined, false, 'https://app.test')).toBeNull();
  expect(developmentInvitationLink('a+b', false, 'https://app.test')).toBe(
    'https://app.test/accept-company-invitation?token=a%2Bb',
  );
});
it('only copies after an explicit action without rendering the token', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const fixture = TestBed.createComponent(InviteCompanyMemberDialogComponent),
    c = fixture.componentInstance;
  c.created.set(true);
  c.link.set('https://app.test/accept-company-invitation?token=secret');
  fixture.detectChanges();
  expect(writeText).not.toHaveBeenCalled();
  expect(fixture.nativeElement.textContent).not.toContain('secret');
  await c.copy();
  expect(writeText).toHaveBeenCalledWith(c.link());
});
function page() {
  const state = TestBed.inject(InvitationAcceptanceState);
  state.captureToken('a'.repeat(43), true);
  return { state, fixture: TestBed.createComponent(CompanyInvitationAcceptancePage) };
}
it('accepts canonically, refreshes membership caches, removes token, and grants no product state', async () => {
  accept.mockResolvedValue({ organizationId: 'org', membershipStatus: 'ACTIVE' });
  const { state, fixture } = page();
  await fixture.componentInstance.accept();
  fixture.detectChanges();
  expect(accept).toHaveBeenCalledWith('owner', 'a'.repeat(43));
  expect(state.token()).toBeNull();
  expect(refresh).toHaveBeenCalled();
  expect(workspaces).toHaveBeenCalledWith(true);
  expect(invalidate).toHaveBeenCalled();
  expect(fixture.nativeElement.textContent).toContain('Invitation acceptée');
  expect(fixture.nativeElement.textContent).not.toContain('Liass-Resto');
});
it.each(['EMAIL_MISMATCH', 'EXPIRED', 'INVALID', 'UNAVAILABLE', 'CONFLICT'])(
  'renders semantic acceptance failure %s safely',
  async (suffix) => {
    accept.mockRejectedValue(
      new HttpErrorResponse({
        status: 409,
        error: { error: { code: 'ORGANIZATION_INVITATION_' + suffix } },
      }),
    );
    const { state, fixture } = page();
    await fixture.componentInstance.accept();
    fixture.detectChanges();
    expect(fixture.componentInstance.error()).toBe('IDENTITY.COMPANY_INVITATIONS.' + suffix);
    expect(state.token() === null).toBe(['INVALID', 'EXPIRED', 'UNAVAILABLE'].includes(suffix));
    expect(fixture.componentInstance.success()).toBe(false);
  },
);
it('fails closed and clears transient acceptance when identity changes', () => {
  const { state, fixture } = page();
  fixture.detectChanges();
  user.set('other');
  fixture.detectChanges();
  expect(state.token()).toBeNull();
  expect(fixture.componentInstance.valid()).toBe(false);
});
it('distinguishes pending and existing-member conflicts from ordinary failures', () => {
  for (const suffix of ['PENDING', 'MEMBER_EXISTS'])
    expect(
      invitationError(
        new HttpErrorResponse({
          status: 409,
          error: { error: { code: 'ORGANIZATION_INVITATION_' + suffix } },
        }),
      ),
    ).not.toBe('IDENTITY.COMPANY_INVITATIONS.ERROR');
});

it.each(['network', 'malformed'])(
  'retains acceptance intent for an ambiguous %s failure without automatic retries',
  async (kind) => {
    accept.mockRejectedValue(
      kind === 'network' ? new HttpErrorResponse({ status: 0 }) : new Error('Invalid response'),
    );
    const { state, fixture } = page();
    await fixture.componentInstance.accept();
    expect(accept).toHaveBeenCalledTimes(1);
    expect(state.token()).toBe('a'.repeat(43));
    await fixture.componentInstance.accept();
    expect(accept.mock.calls[0]).toEqual(accept.mock.calls[1]);
    expect(fixture.componentInstance.error()).toBe('IDENTITY.COMPANY_INVITATIONS.ERROR');
  },
);
it('removes the query address after rendering rather than relying on guard history replacement', async () => {
  const { fixture } = page();
  fixture.detectChanges();
  await fixture.whenStable();
  expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalledWith('/accept-company-invitation', {
    replaceUrl: true,
  });
});
