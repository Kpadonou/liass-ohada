import { provideHttpClient, HttpErrorResponse } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ZodError } from 'zod';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantsApi } from './restaurants.api';
import { environment } from '../../../../environments/environment';
import { staffFixture, assignmentFixture } from './staff.test-fixture';
import { rid } from './restaurants.test-fixture';
const base = environment.apiBaseUrl.replace(/\/$/, '');
describe('Restaurants staff boundary', () => {
  const org = signal('org');
  let api: RestaurantsApi, http: HttpTestingController;
  beforeEach(() => {
    org.set('org');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthStore, useValue: { effectiveOrgId: org } },
      ],
    });
    api = TestBed.inject(RestaurantsApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });
  it('reads all bounded collection variants with opaque cursors and strict envelopes', async () => {
    const calls = [
      {
        run: () => api.staff('org', 'opaque'),
        path: '/restaurants/staff',
        result: { items: [staffFixture()], nextCursor: 'next' },
      },
      {
        run: () => api.staffOutlets('org', 'private-user-a', 'opaque'),
        path: '/restaurants/staff/private-user-a/outlets',
        result: { items: [assignmentFixture()], nextCursor: 'next' },
      },
      {
        run: () => api.outletStaff('org', rid(2), 'opaque'),
        path: `/restaurants/outlets/${rid(2)}/staff`,
        result: {
          items: [{ staff: staffFixture(), assignment: assignmentFixture() }],
          nextCursor: 'next',
        },
      },
    ];
    for (const call of calls) {
      const promise = call.run();
      const request = http.expectOne(
        (r) => r.url === base + call.path && r.params.get('cursor') === 'opaque',
      );
      expect(request.request.params.get('limit')).toBe('50');
      request.flush(call.result);
      await expect(promise).resolves.toEqual(call.result);
    }
  });
  it('validates detail and rejects foreign staff references', async () => {
    const promise = api.staffMember('org', 'private-user-a');
    const assertion = expect(promise).rejects.toThrow('Mismatched staff context');
    http
      .expectOne(base + '/restaurants/staff/private-user-a')
      .flush({ data: staffFixture('another') });
    await assertion;
  });
  it('sends versioned lifecycle intent without actor, tenant or role fields', async () => {
    const intent = { status: 'INACTIVE', expectedVersion: 1, clientRequestId: rid(100) };
    const promise = api.updateStaff('org', 'private-user-a', intent);
    const request = http.expectOne(base + '/restaurants/staff/private-user-a');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual(intent);
    request.flush({ data: staffFixture('private-user-a', { status: 'INACTIVE', version: 2 }) });
    await expect(promise).resolves.toMatchObject({ data: { status: 'INACTIVE' } });
  });
  it.each([true, false])(
    'sends exact assignment command with retained caller UUID (%s)',
    async (active) => {
      const intent = { expectedVersion: 3, clientRequestId: rid(101) };
      const promise = api.staffAssignment('org', 'private-user-a', rid(2), active, intent);
      const request = http.expectOne(
        base +
          `/restaurants/staff/private-user-a/outlets/${rid(2)}` +
          (active ? '' : '/deactivate'),
      );
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual(intent);
      request.flush({
        data: assignmentFixture(rid(2), { status: active ? 'ACTIVE' : 'INACTIVE', version: 4 }),
      });
      await promise;
    },
  );
  it.each([400, 403, 404, 409, 0])('preserves safe HTTP failure %s', async (status) => {
    const promise = api.staff('org');
    const assertion = expect(promise).rejects.toBeInstanceOf(HttpErrorResponse);
    const request = http.expectOne((r) => r.url === base + '/restaurants/staff');
    if (status)
      request.flush(
        { message: { message: 'Accès indisponible.' } },
        { status, statusText: 'Failure' },
      );
    else request.error(new ProgressEvent('network'));
    await assertion;
  });
  it('rejects extra identity/persistence fields in public responses', async () => {
    const promise = api.staff('org');
    const assertion = expect(promise).rejects.toBeInstanceOf(ZodError);
    http
      .expectOne((r) => r.url === base + '/restaurants/staff')
      .flush({ items: [{ ...staffFixture(), email: 'hidden@example.com', PK: 'private' }] });
    await assertion;
  });
  it('does not send a stale-scope request and rejects a late response after organization switch', async () => {
    org.set('other');
    await expect(api.staff('org')).rejects.toMatchObject({ status: 409 });
    http.expectNone(() => true);
    org.set('org');
    const promise = api.staff('org');
    const assertion = expect(promise).rejects.toMatchObject({ status: 409 });
    org.set('other');
    http.expectOne((r) => r.url === base + '/restaurants/staff').flush({ items: [staffFixture()] });
    await assertion;
  });
  it('rejects mismatched assignment and outlet-staff ownership', async () => {
    const promise = api.staffOutlets('org', 'private-user-a');
    const assertion = expect(promise).rejects.toThrow('Mismatched assignment context');
    http
      .expectOne((r) => r.url.endsWith('/private-user-a/outlets'))
      .flush({ items: [assignmentFixture(rid(2), { userId: 'other-user' })] });
    await assertion;
  });
});
