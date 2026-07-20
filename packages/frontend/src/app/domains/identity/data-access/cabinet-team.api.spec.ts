import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../../environments/environment';
import { TENANT_REQUEST_SCOPE } from '../../../core/http/tenant-request-context';
import { CabinetTeamApi } from './cabinet-team.api';

const baseUrl = environment.apiBaseUrl.replace(/\/$/, '');
const now = '2026-07-20T00:00:00.000Z';
const member = {
  userId: 'member-1',
  cabinetRole: 'COLLABORATOR',
  status: 'ACTIVE',
  displayName: 'Awa Mensah',
  email: 'awa@example.com',
  updatedAt: now,
  isOwner: false
};
const invitation = {
  invitationId: 'inv-1',
  email: 'awa@example.com',
  role: 'COLLABORATOR',
  status: 'PENDING',
  invitedBy: 'admin-1',
  createdAt: now,
  expiresAt: '2026-07-27T00:00:00.000Z',
  initialDossierOrgIds: []
};

describe('CabinetTeamApi', () => {
  let api: CabinetTeamApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(CabinetTeamApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists and validates paginated members in Cabinet scope', async () => {
    const promise = api.listMembers({ limit: 25, role: 'COLLABORATOR', status: 'ACTIVE' });
    const request = http.expectOne(
      (candidate) =>
        candidate.url === `${baseUrl}/cabinet/team/members` &&
        candidate.params.get('limit') === '25' &&
        candidate.params.get('role') === 'COLLABORATOR'
    );
    expect(request.request.context.get(TENANT_REQUEST_SCOPE)).toBe('CABINET');
    request.flush({ members: [member], nextCursor: 'next' });
    await expect(promise).resolves.toMatchObject({ hasMore: true, members: [member] });
  });

  it('validates role and status mutations', async () => {
    const rolePromise = api.updateMemberRole('member-1', { role: 'READER' });
    const roleRequest = http.expectOne(`${baseUrl}/cabinet/team/members/member-1/role`);
    expect(roleRequest.request.method).toBe('PATCH');
    expect(roleRequest.request.body).toEqual({ role: 'READER' });
    roleRequest.flush({ member: { ...member, cabinetRole: 'READER' } });
    await expect(rolePromise).resolves.toMatchObject({ cabinetRole: 'READER' });

    const statusPromise = api.updateMemberStatus('member-1', { status: 'SUSPENDED' });
    const statusRequest = http.expectOne(`${baseUrl}/cabinet/team/members/member-1/status`);
    expect(statusRequest.request.body).toEqual({ status: 'SUSPENDED' });
    statusRequest.flush({ member: { ...member, status: 'SUSPENDED' } });
    await expect(statusPromise).resolves.toMatchObject({ status: 'SUSPENDED' });
  });

  it('creates, lists, resends, and cancels invitations without inventing delivery', async () => {
    const createPromise = api.createInvitation({
      email: 'AWA@EXAMPLE.COM',
      role: 'COLLABORATOR',
      initialDossierOrgIds: ['org-client']
    });
    const createRequest = http.expectOne(`${baseUrl}/cabinet/team/invitations`);
    expect(createRequest.request.body).toEqual({
      email: 'awa@example.com',
      role: 'COLLABORATOR',
      initialDossierOrgIds: ['org-client']
    });
    createRequest.flush({
      invitation: { ...invitation, initialDossierOrgIds: ['org-client'] },
      invitationToken: 'a'.repeat(48),
      deliveryMode: 'DEVELOPMENT_TOKEN'
    });
    await expect(createPromise).resolves.toMatchObject({ deliveryMode: 'DEVELOPMENT_TOKEN' });

    const listPromise = api.listInvitations({ limit: 25, status: 'PENDING' });
    http.expectOne((request) => request.url === `${baseUrl}/cabinet/team/invitations`).flush({
      invitations: [invitation]
    });
    await expect(listPromise).resolves.toMatchObject({ invitations: [invitation] });

    const resendPromise = api.resendInvitation('inv-1');
    http.expectOne(`${baseUrl}/cabinet/team/invitations/inv-1/resend`).flush({
      invitation,
      deliveryMode: 'UNAVAILABLE'
    });
    await expect(resendPromise).resolves.toMatchObject({ deliveryMode: 'UNAVAILABLE' });

    const cancelPromise = api.cancelInvitation('inv-1');
    http.expectOne(`${baseUrl}/cabinet/team/invitations/inv-1/cancel`).flush({
      invitation: { ...invitation, status: 'CANCELLED' }
    });
    await expect(cancelPromise).resolves.toMatchObject({ status: 'CANCELLED' });
  });

  it('uses member-centric and dossier-scoped assignment endpoints', async () => {
    const assignment = {
      userId: 'member-1',
      dossierOrgId: 'org-client',
      assignedBy: 'admin-1',
      assignedAt: now
    };
    const listPromise = api.listMemberAssignments('member-1');
    http.expectOne(`${baseUrl}/cabinet/team/members/member-1/assignments`).flush({
      assignments: [assignment]
    });
    await expect(listPromise).resolves.toEqual([assignment]);

    const replacePromise = api.replaceMemberAssignments('member-1', {
      dossierOrgIds: ['org-client']
    });
    const replaceRequest = http.expectOne(`${baseUrl}/cabinet/team/members/member-1/assignments`);
    expect(replaceRequest.request.method).toBe('PUT');
    replaceRequest.flush({ assignments: [assignment] });
    await expect(replacePromise).resolves.toEqual([assignment]);

    const addPromise = api.addDossierMember('org-client', 'member-1');
    http.expectOne(`${baseUrl}/cabinet/dossiers/org-client/members/member-1`).flush({ assignment });
    await expect(addPromise).resolves.toEqual({ assignment });

    const removePromise = api.removeDossierMember('org-client', 'member-1');
    const removeRequest = http.expectOne(`${baseUrl}/cabinet/dossiers/org-client/members/member-1`);
    expect(removeRequest.request.method).toBe('DELETE');
    removeRequest.flush({ assignment });
    await expect(removePromise).resolves.toEqual({ assignment });
  });

  it('accepts invitations through the pre-tenant endpoint with no tenant scope', async () => {
    const promise = api.acceptInvitation('a'.repeat(48));
    const request = http.expectOne(`${baseUrl}/me/cabinet-invitations/accept`);
    expect(request.request.context.get(TENANT_REQUEST_SCOPE)).toBe('ACCOUNTING');
    expect(request.request.body).toEqual({ token: 'a'.repeat(48) });
    request.flush({ member, assignments: [] });
    await expect(promise).resolves.toMatchObject({ member, assignments: [] });
  });
});
