/** Local read-only visual review fixtures. Never proxies requests or logs auth headers.
 * Run: node scripts/restaurants-access-review.mjs /tmp/restaurants-access-phase.json
 * State file: {"phase":"configure"} (configure, zero, ready, owner, manager, cashier,
 * kitchen, unverified, revoked). Temporarily point environment.development.apiBaseUrl
 * at http://localhost:4201, restore it after review. Authentication remains unchanged.
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import {
  RestaurantMyOutletsResponseSchema,
  RestaurantServiceFloorResponseSchema,
  RestaurantResponseSchema,
  OutletListResponseSchema,
  ServiceAreaListResponseSchema,
} from '@liass-ohada/shared/restaurants';
const phaseFile = process.argv[2];
if (!phaseFile) throw new Error('Pass a local phase JSON file.');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stamp = '2026-10-16T08:00:00.000Z';
const metadata = {
  id: id(1),
  name: 'Atelier Resto',
  isActive: true,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
};
const roleFor = (phase) =>
  ({
    zero: 'WAITER',
    ready: 'WAITER',
    owner: 'OWNER',
    manager: 'MANAGER',
    cashier: 'CASHIER',
    kitchen: 'KITCHEN',
    unverified: 'WAITER',
  })[phase];
const server = http.createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', 'http://localhost:4200');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'authorization,x-org-id,x-workspace-org-id,accept-language,content-type',
  );
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json');
  const send = (value, status = 200) => {
    response.statusCode = status;
    response.end(JSON.stringify(value));
  };
  if (request.method === 'OPTIONS') return send({});
  if (request.method !== 'GET') return send({ error: { code: 'READ_ONLY_FIXTURE' } }, 405);
  const { phase = 'configure' } = JSON.parse(readFileSync(phaseFile, 'utf8'));
  const path = new URL(request.url, 'http://localhost:4201').pathname;
  const role = roleFor(phase),
    org = request.headers['x-org-id'];
  if (path === '/me/workspaces')
    return send({
      workspaces: [
        {
          orgId: 'org-a',
          displayName: 'Atelier Resto',
          workspaceType: 'COMPANY',
          role: 'MEMBER',
          status: 'ACTIVE',
          accessSource: 'DIRECT',
          ...(role ? { productRoles: { RESTAURANTS: role } } : {}),
        },
        {
          orgId: 'org-b',
          displayName: 'Autre espace',
          workspaceType: 'COMPANY',
          role: 'MEMBER',
          status: 'ACTIVE',
          accessSource: 'DIRECT',
        },
      ],
    });
  if (!['org-a', 'org-b'].includes(org))
    return send({ error: { code: 'ERROR_ORG_ACCESS_DENIED' } }, 403);
  if (path === '/me/product-access')
    return send({
      productAccess: [
        {
          orgId: org,
          productCode: 'RESTAURANTS',
          status: 'ACTIVE',
          createdAt: stamp,
          updatedAt: stamp,
        },
      ],
    });
  if (org !== 'org-a' || !role) return send({ error: { code: 'DOMAIN_PERMISSION_REQUIRED' } }, 403);
  if (path === '/restaurants/me/outlets') {
    if (phase === 'unverified') return send({ error: { code: 'DOMAIN_PERMISSION_REQUIRED' } }, 403);
    return send(
      RestaurantMyOutletsResponseSchema.parse({
        items: phase === 'zero' ? [] : [{ outletId: id(2), name: 'Établissement du Centre' }],
      }),
    );
  }
  if (path === '/restaurants/restaurant')
    return send(
      RestaurantResponseSchema.parse({
        data: { ...metadata, guestOrderingPolicy: 'STAFF_APPROVAL' },
      }),
    );
  if (path === '/restaurants/outlets')
    return send(
      OutletListResponseSchema.parse({
        items: [{ ...metadata, id: id(2), name: 'Établissement du Centre', restaurantId: id(1) }],
      }),
    );
  if (path.endsWith('/service-areas'))
    return send(
      ServiceAreaListResponseSchema.parse({
        items: [{ ...metadata, id: id(3), name: 'Salle principale', outletId: id(2) }],
      }),
    );
  if (path.endsWith('/preparation-stations')) return send({ items: [] });
  if (path.endsWith('/service-floor'))
    return send(
      RestaurantServiceFloorResponseSchema.parse({
        outletId: id(2),
        items: [
          {
            tableId: id(4),
            code: 'T01',
            areaId: id(3),
            areaName: 'Salle principale',
            state: 'FREE',
            capacity: 4,
          },
        ],
      }),
    );
  return send({ error: { code: 'FIXTURE_NOT_FOUND' } }, 404);
});
server.listen(4201, '127.0.0.1', () =>
  process.stdout.write('Read-only Restaurants review fixtures at http://localhost:4201\n'),
);
