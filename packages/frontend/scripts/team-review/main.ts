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
import { provideRouter } from '@angular/router';
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
const commands = new Map<string, { fingerprint: string; result: unknown }>();
let partialOnce = scenario === 'partial';
const localOnly: HttpInterceptorFn = (request, next) => {
  if (request.url.startsWith('/assets/')) return next(request);
  const path = new URL(request.url, location.origin).pathname;
  let body: unknown;
  const userPath =
    /^\/restaurants\/staff\/([^/]+)(?:\/outlets(?:\/([^/]+)(\/deactivate)?)?)?$/.exec(path);
  if (path === '/me/workspaces') body = { items: [] };
  else if (path.endsWith('/product-access'))
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
  else if (path === '/restaurants/staff')
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
      patchState(unprotected(auth), {
        user: { userId: 'fixture-owner', username: 'fixture-owner' },
        userAttributes: { name: 'Camille M.' },
        activeOrgId: 'fixture-org',
        activeDossierOrgId: null,
        hydrated: true,
        workspacesLoaded: true,
        workspaces: [
          {
            orgId: 'fixture-org',
            displayName: 'Héritage Bistro',
            workspaceType: 'COMPANY',
            accessSource: 'DIRECT',
            role: 'OWNER',
            productRoles: { RESTAURANTS: scenario === 'denied' ? 'WAITER' : 'OWNER' },
          },
        ],
      });
    }),
  ],
}).catch(console.error);
