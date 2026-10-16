/** Local visual-review entry only. Excluded from the production browser entry and tsconfig. */
import { importProvidersFrom, inject, provideAppInitializer } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import {
  provideHttpClient,
  withInterceptors,
  HttpResponse,
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { provideRouter, Router } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { patchState } from '@ngrx/signals';
import { unprotected } from '@ngrx/signals/testing';
import { of, throwError, delay } from 'rxjs';
import { App } from '../../src/app/app';
import { routes } from '../../src/app/core/routing/app.routes';
import { i18nProviders } from '../../src/app/core/i18n/i18n.providers';
import { AuthStore } from '../../src/app/domains/identity/data-access/auth.store';
import { RestaurantsCapabilities } from '../../src/app/domains/restaurants/data-access/restaurants-capabilities';
import {
  staffFixture,
  assignmentFixture,
  teamOutlets,
} from '../../src/app/domains/restaurants/data-access/staff.test-fixture';
import { row } from '../../src/app/domains/restaurants/data-access/restaurants.test-fixture';
import { floorFixture } from '../../src/app/domains/restaurants/data-access/service-floor.test-fixture';
import { sessionFixture } from '../../src/app/domains/restaurants/data-access/responsible-staff.test-fixture';
import { rid } from '../../src/app/domains/restaurants/data-access/restaurants.test-fixture';
import {
  RestaurantStaffSchema,
  RestaurantStaffOutletSchema,
} from '@liass-ohada/shared/restaurants';
const scenario = new URLSearchParams(location.search).get('scenario');
const members = [
  staffFixture(),
  staffFixture('fixture-b', { displayName: 'Moussa D.', restaurantRole: 'CASHIER' }),
  staffFixture('fixture-c', { displayName: 'Élodie A.', restaurantRole: 'MANAGER' }),
  staffFixture('fixture-d', {
    displayName: 'Karim T.',
    restaurantRole: 'KITCHEN',
    status: 'INACTIVE',
  }),
];
const assignments = [
  assignmentFixture(rid(2)),
  assignmentFixture(rid(3)),
  assignmentFixture(rid(2), { userId: 'fixture-b' }),
  assignmentFixture(rid(3), { userId: 'fixture-c' }),
  assignmentFixture(rid(4), { userId: 'fixture-d' }),
];
const directoryMembers = [
  {
    userId: 'fixture-eligible',
    displayName: 'Sènami A.',
    email: 'senami@example.test',
    status: 'ACTIVE',
  },
  {
    userId: 'fixture-long-new',
    displayName: 'Aïssatou Sènami Agossou — équipe du service du soir',
    email: 'aissatou.senami.agossou@example.test',
    status: 'ACTIVE',
  },
  ...members.map((member) => ({
    userId: member.userId,
    displayName: member.displayName!,
    email: 'equipe@example.test',
    status: 'ACTIVE',
  })),
];
if (scenario === 'available-one') directoryMembers.splice(1, 1);
directoryMembers.push(
  {
    userId: 'fixture-owner',
    displayName: 'Camille M.',
    email: 'owner@example.test',
    status: 'ACTIVE',
  },
  {
    userId: 'fixture-suspended',
    displayName: 'Membre suspendu',
    email: 'suspended@example.test',
    status: 'SUSPENDED',
  },
  {
    userId: 'fixture-revoked',
    displayName: 'Membre révoqué',
    email: 'revoked@example.test',
    status: 'REVOKED',
  },
);
const productRoles = new Map(members.map((member) => [member.userId, member.restaurantRole!]));
if (scenario === 'add-role-conflict') productRoles.set('fixture-eligible', 'CASHIER');
if (scenario === 'add-empty-team') {
  members.splice(0);
  assignments.splice(0);
}
const waiterReview = scenario?.startsWith('service-waiter') ?? false;
const serviceReview = scenario?.startsWith('service') ?? false;
const serviceTables = floorFixture().items;
const sessionData = new Map<string, ReturnType<typeof sessionFixture>>();
if (serviceReview) {
  assignments.push(assignmentFixture(rid(2), { userId: 'fixture-c' }));
  members.push(
    staffFixture('fixture-long', {
      displayName: 'Aïssatou Sènami Agossou — équipe du service du soir',
      restaurantRole: 'WAITER',
      status: 'INACTIVE',
    }),
  );
  assignments.push(assignmentFixture(rid(2), { userId: 'fixture-long' }));
  const base = serviceTables[1];
  if (base.state === 'OCCUPIED') {
    const openedAt = new Date(Date.now() - 26 * 60_000).toISOString();
    serviceTables[1] = {
      ...base,
      openedAt,
      responsibleStaff: { staffId: 'private-user-a', displayName: 'Aïssatou S.', available: true },
    };
    serviceTables[2] = {
      ...base,
      tableId: rid(6),
      code: 'T03',
      guestSessionId: rid(10),
      openedAt,
      responsibleStaff: { staffId: 'fixture-c', displayName: 'Élodie A.', available: true },
    };
    serviceTables.push({
      ...base,
      tableId: rid(20),
      code: 'T04',
      guestSessionId: rid(11),
      openedAt,
      currentAmountMinor: 0,
      orderCount: 0,
    });
    serviceTables.push({
      ...base,
      tableId: rid(21),
      code: 'T05',
      guestSessionId: rid(12),
      openedAt,
      responsibleStaff: {
        staffId: 'fixture-long',
        displayName: 'Aïssatou Sènami Agossou — équipe du service du soir',
        available: false,
      },
    });
  }
  for (const table of serviceTables)
    if (table.state === 'OCCUPIED')
      sessionData.set(
        table.guestSessionId,
        sessionFixture({
          orgId: 'fixture-org',
          guestSessionId: table.guestSessionId,
          tableId: table.tableId,
          tableCode: table.code,
          tableName: table.code,
          areaId: table.areaId,
          openedAt: table.openedAt,
          responsibleStaff: table.responsibleStaff,
        }),
      );
}
let staleOnce = scenario === 'service-stale';
const commands = new Map<string, { fingerprint: string; result: unknown }>();
let partialOnce = scenario === 'partial' || scenario === 'add-partial';
const localOnly: HttpInterceptorFn = (request, next) => {
  if (request.url.startsWith('/assets/')) return next(request);
  const path = new URL(request.url, location.origin).pathname;
  let body: unknown;
  const userPath =
    /^\/restaurants\/staff\/([^/]+)(?:\/outlets(?:\/([^/]+)(\/deactivate)?)?)?$/.exec(path);
  if (path === '/me/organization/invitations/accept') {
    const token = (request.body as { token: string }).token;
    const code = token.startsWith('e')
      ? 'EXPIRED'
      : token.startsWith('m')
        ? 'EMAIL_MISMATCH'
        : token.startsWith('d')
          ? null
          : 'INVALID';
    if (code)
      return throwError(
        () =>
          new HttpErrorResponse({
            status: code === 'INVALID' ? 404 : 409,
            error: { error: { code: 'ORGANIZATION_INVITATION_' + code } },
          }),
      );
    directoryMembers.push({
      userId: 'fixture-invited',
      displayName: 'Nadia A.',
      email: 'nadia@example.test',
      status: 'ACTIVE',
    });
    body = { organizationId: 'fixture-org', membershipStatus: 'ACTIVE' };
  } else if (path === '/me/organization/invitations') {
    const input = request.body as { email: string };
    body = {
      invitation: {
        invitationId: rid(990),
        email: input.email,
        status: 'PENDING',
        expiresAt: '2026-11-01T00:00:00.000Z',
      },
      deliveryMode: 'DEVELOPMENT_TOKEN',
      invitationToken: 'd'.repeat(43),
    };
  } else if (path === '/me/workspaces') body = { workspaces: [] };
  else if (path === '/me/organization/members') {
    body =
      scenario === 'add-directory-empty'
        ? { items: [] }
        : scenario === 'add-directory-pages' && !request.params.has('cursor')
          ? { items: [], nextCursor: 'fixture-members-next' }
          : { items: directoryMembers };
  } else if (/^\/me\/organization\/members\/[^/]+\/product-roles\/RESTAURANTS$/.test(path)) {
    const userId = path.split('/')[4];
    const input = request.body as {
      clientRequestId: string;
      role: 'MANAGER' | 'WAITER' | 'CASHIER' | 'KITCHEN';
    };
    const current = productRoles.get(userId);
    if (current && current !== input.role)
      return throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { error: { code: 'PLATFORM_PRODUCT_ROLE_CONFLICT' } },
          }),
      );
    productRoles.set(userId, input.role);
    body = { userId, productCode: 'RESTAURANTS', role: input.role };
  } else if (path.endsWith('/product-access'))
    body = {
      productAccess: [
        {
          orgId: 'fixture-org',
          productCode: scenario === 'accounting-reference' ? 'ACCOUNTING' : 'RESTAURANTS',
          status: 'ACTIVE',
          createdAt: '2026-10-15T00:00:00.000Z',
          updatedAt: '2026-10-15T00:00:00.000Z',
        },
      ],
    };
  else if (path === '/journals')
    body = {
      data: [
        { year: 2026, journalCode: 'ACH', journalName: 'Achats', type: 'PURCHASE' },
        { year: 2026, journalCode: 'VTE', journalName: 'Ventes', type: 'SALE' },
        { year: 2026, journalCode: 'BQ', journalName: 'Banque', type: 'BANK' },
      ],
    };
  else if (path === '/restaurants/me/outlets') {
    body = {
      items:
        scenario === 'service-waiter-empty'
          ? []
          : scenario === 'service-waiter-multi'
            ? [
                { outletId: rid(2), name: 'Agla' },
                { outletId: rid(3), name: 'Fidjrossè' },
              ]
            : [{ outletId: rid(2), name: 'Agla' }],
    };
  } else if (request.method === 'POST' && /^\/restaurants\/outlets\/[^/]+\/sessions$/.test(path)) {
    const input = request.body as { clientRequestId: string; tableId: string; areaId: string };
    const replay = commands.get(input.clientRequestId);
    if (replay) body = replay.result;
    else {
      const table = serviceTables.find((t) => t.tableId === input.tableId);
      if (!table || table.state !== 'FREE')
        return throwError(() => new HttpErrorResponse({ status: 409 }));
      const session = sessionFixture({
        orgId: 'fixture-org',
        outletId: path.split('/')[3],
        tableId: input.tableId,
        areaId: input.areaId,
        tableCode: table.code,
        guestSessionId: rid(900),
        openedBy: waiterReview ? 'fixture-a' : 'fixture-owner',
        responsibleStaff: waiterReview
          ? { staffId: 'fixture-a', displayName: 'Aïssatou S.', available: true }
          : undefined,
      });
      const occupied = {
        ...table,
        state: 'OCCUPIED' as const,
        guestSessionId: session.guestSessionId,
        openedAt: session.openedAt,
        openedBy: session.openedBy,
        currentAmountMinor: 0,
        orderCount: 0,
        currency: 'XOF',
        responsibleStaff: session.responsibleStaff,
      };
      serviceTables.splice(serviceTables.indexOf(table), 1, occupied);
      if (scenario === 'service-waiter-conflict') {
        occupied.responsibleStaff = {
          staffId: 'fixture-c',
          displayName: 'Élodie A.',
          available: true,
        };
        return throwError(() => new HttpErrorResponse({ status: 409 }));
      }
      body = { data: session };
      commands.set(input.clientRequestId, {
        fingerprint: JSON.stringify(input),
        result: structuredClone(body),
      });
    }
  } else if (path === '/restaurants/restaurant') body = { data: row('restaurant') };
  else if (/^\/restaurants\/outlets\/[^/]+\/service-areas$/.test(path))
    body = { items: [{ ...row('area'), name: 'Salle principale' }] };
  else if (/^\/restaurants\/outlets\/[^/]+\/service-floor$/.test(path))
    body = { outletId: path.split('/')[3], items: serviceTables };
  else if (/^\/restaurants\/outlets\/[^/]+\/sessions\/[^/]+(?:\/responsible-staff)?$/.test(path)) {
    const sessionId = path.split('/')[5];
    const session = sessionData.get(sessionId);
    if (!session) return throwError(() => new HttpErrorResponse({ status: 404 }));
    if (request.method === 'GET') body = { data: session };
    else {
      const input = request.body as {
        clientRequestId: string;
        expectedVersion: number;
        staffId: string | null;
      };
      const previous = commands.get(input.clientRequestId);
      const fingerprint = JSON.stringify([path, input]);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          return throwError(() => new HttpErrorResponse({ status: 409 }));
        body = previous.result;
      } else {
        if (staleOnce) {
          staleOnce = false;
          session.version++;
          session.responsibleStaff = {
            staffId: 'fixture-c',
            displayName: 'Élodie A.',
            available: true,
          };
          const table = serviceTables.find(
            (t) => t.state === 'OCCUPIED' && t.guestSessionId === sessionId,
          );
          if (table?.state === 'OCCUPIED') table.responsibleStaff = session.responsibleStaff;
          return throwError(() => new HttpErrorResponse({ status: 409 }));
        }
        if (session.version !== input.expectedVersion)
          return throwError(() => new HttpErrorResponse({ status: 409 }));
        const staff = members.find((person) => person.userId === input.staffId);
        if (
          input.staffId &&
          (!staff ||
            staff.status !== 'ACTIVE' ||
            !['OWNER', 'MANAGER', 'WAITER'].includes(staff.restaurantRole ?? ''))
        )
          return throwError(() => new HttpErrorResponse({ status: 409 }));
        session.version++;
        session.responsibleStaff = staff
          ? { staffId: staff.userId, displayName: staff.displayName, available: true }
          : undefined;
        const table = serviceTables.find(
          (t) => t.state === 'OCCUPIED' && t.guestSessionId === sessionId,
        );
        if (table?.state === 'OCCUPIED') {
          if (session.responsibleStaff) table.responsibleStaff = session.responsibleStaff;
          else delete table.responsibleStaff;
        }
        body = { data: session };
        commands.set(input.clientRequestId, { fingerprint, result: structuredClone(body) });
      }
    }
  } else if (path === '/restaurants/staff' && request.method === 'POST') {
    const input = request.body as { memberUserId: string; clientRequestId: string };
    if (members.some((member) => member.userId === input.memberUserId))
      return throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { error: { code: 'RESTAURANTS_STAFF_EXISTS' } },
          }),
      );
    const person = directoryMembers.find((member) => member.userId === input.memberUserId);
    const role = productRoles.get(input.memberUserId);
    if (!person || !role) return throwError(() => new HttpErrorResponse({ status: 403 }));
    const data = staffFixture(input.memberUserId, {
      displayName: person.displayName,
      restaurantRole: role,
    });
    members.push(data);
    body = { data };
  } else if (path === '/restaurants/staff')
    body =
      scenario === 'paged'
        ? request.params.has('cursor')
          ? { items: members.slice(2) }
          : { items: members.slice(0, 2), nextCursor: 'fixture-next-page' }
        : { items: scenario === 'empty' ? [] : members };
  else if (path === '/restaurants/outlets') body = { items: teamOutlets };
  else if (/^\/restaurants\/outlets\/[^/]+\/staff$/.test(path)) {
    const outletId = path.split('/')[3];
    body = {
      items: assignments
        .filter((row) => row.outletId === outletId)
        .map((assignment) => ({
          assignment,
          staff: members.find((member) => member.userId === assignment.userId)!,
        })),
    };
  } else if (/^\/restaurants\/outlets\/[^/]+$/.test(path))
    body = { data: teamOutlets.find((outlet) => outlet.id === path.split('/')[3]) };
  else if (userPath) {
    const [, userId, outletId, deactivate] = userPath;
    const member = members.find((row) => row.userId === userId)!;
    if (!member) return throwError(() => new HttpErrorResponse({ status: 404 }));
    if (request.method === 'GET')
      body = path.endsWith('/outlets')
        ? { items: assignments.filter((row) => row.userId === userId) }
        : { data: member };
    else {
      const input = request.body as {
        expectedVersion?: number;
        clientRequestId: string;
        status?: 'ACTIVE' | 'INACTIVE';
      };
      const fingerprint = JSON.stringify([path, input]);
      const previous = commands.get(input.clientRequestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          return throwError(() => new HttpErrorResponse({ status: 409 }));
        body = previous.result;
      } else {
        if (outletId) {
          if (partialOnce && outletId === rid(3)) {
            partialOnce = false;
            return throwError(() => new HttpErrorResponse({ status: 0 }));
          }
          const before = assignments.find(
            (row) => row.userId === userId && row.outletId === outletId,
          );
          if (before && before.version !== input.expectedVersion)
            return throwError(() => new HttpErrorResponse({ status: 409 }));
          const data = RestaurantStaffOutletSchema.parse({
            ...(before ?? assignmentFixture(outletId, { userId })),
            status: deactivate ? 'INACTIVE' : 'ACTIVE',
            version: (before?.version ?? 0) + 1,
          });
          if (before) Object.assign(before, data);
          else assignments.push(data);
          body = { data };
        } else {
          if (member.version !== input.expectedVersion)
            return throwError(() => new HttpErrorResponse({ status: 409 }));
          Object.assign(
            member,
            RestaurantStaffSchema.parse({
              ...member,
              status: input.status,
              version: member.version + 1,
            }),
          );
          body = { data: member };
        }
        commands.set(input.clientRequestId, { fingerprint, result: structuredClone(body) });
      }
    }
  } else
    return throwError(
      () =>
        new HttpErrorResponse({
          status: 503,
          error: { message: 'Cette action ne fait pas partie de la démonstration locale.' },
        }),
    );
  return of(new HttpResponse({ status: 200, body: structuredClone(body) })).pipe(delay(80));
};
bootstrapApplication(App, {
  providers: [
    provideRouter(routes),
    ...i18nProviders,
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline' } },
    importProvidersFrom(MatSnackBarModule),
    provideHttpClient(withInterceptors([localOnly])),
    provideTanStackQuery(new QueryClient()),
    {
      provide: RestaurantsCapabilities,
      useFactory: () => {
        const caps = new RestaurantsCapabilities();
        if (scenario === 'readonly') caps.canManageStaff = () => false;
        return caps;
      },
    },
    provideAppInitializer(() => {
      const auth = inject(AuthStore);
      if (scenario?.startsWith('invite')) auth.refreshUserProfile = async () => undefined;
      if (scenario === 'invite-login')
        auth.login = async () => {
          patchState(unprotected(auth), {
            user: { userId: 'fixture-invitee', username: 'fixture-invitee' },
            activeOrgId: null,
            workspaces: [],
          });
        };
      if (scenario === 'invite-login') {
        const router = inject(Router);
        const button = document.createElement('button');
        button.textContent = 'Revue : revenir au propriétaire';
        button.style.cssText =
          'position:fixed;bottom:8px;right:8px;z-index:9999;background:white;padding:8px;border:1px solid #ccc';
        button.onclick = () => {
          patchState(unprotected(auth), {
            user: { userId: 'fixture-owner', username: 'fixture-owner' },
            activeOrgId: 'fixture-org',
            workspacesLoaded: true,
            workspaces: [
              {
                orgId: 'fixture-org',
                displayName: 'Héritage Bistro',
                workspaceType: 'COMPANY',
                status: 'ACTIVE',
                accessSource: 'DIRECT',
                role: 'OWNER',
                productRoles: { RESTAURANTS: 'OWNER' },
              },
            ],
          });
          void router.navigateByUrl('/restaurants/setup/team');
          button.remove();
        };
        document.body.append(button);
      }

      patchState(unprotected(auth), {
        user:
          scenario === 'invite-login'
            ? null
            : { userId: waiterReview ? 'fixture-a' : 'fixture-owner', username: 'fixture-owner' },
        userAttributes: { name: waiterReview ? 'Aïssatou S.' : 'Camille M.' },
        activeOrgId: 'fixture-org',
        activeDossierOrgId: null,
        hydrated: true,
        workspacesLoaded: true,
        workspaces: [
          {
            orgId: 'fixture-org',
            displayName: 'Héritage Bistro',
            workspaceType: 'COMPANY',
            status: 'ACTIVE',
            accessSource: 'DIRECT',
            role: scenario === 'add-manager' ? 'MEMBER' : 'OWNER',
            productRoles: {
              RESTAURANTS: waiterReview
                ? 'WAITER'
                : scenario === 'denied'
                  ? 'CASHIER'
                  : scenario === 'add-manager'
                    ? 'MANAGER'
                    : 'OWNER',
            },
          },
        ],
      });
    }),
  ],
}).catch(console.error);
