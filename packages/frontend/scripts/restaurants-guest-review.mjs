// Loopback-only synthetic Guest/QR visual review. No forwarding or header logging.
/** Run: node scripts/restaurants-guest-review.mjs /tmp/resto-guest-phase.json
 * State file: {"phase":"free"}: free, occupied, expired, closed, invalid, revoked.
 * Temporarily use http://localhost:4201 as development apiBaseUrl and restore it
 * after review. Staff configuration commands are rejected; Guest responses are synthetic.
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
const server = http.createServer((request, response) => {
  response.setHeader(
    'Access-Control-Allow-Origin',
    request.headers.origin === 'http://127.0.0.1:4200'
      ? 'http://127.0.0.1:4200'
      : 'http://localhost:4200',
  );
  response.setHeader(
    'Access-Control-Allow-Headers',
    'authorization,x-org-id,x-workspace-org-id,accept-language,content-type',
  );
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json');
  const send = (value, status = 200) => {
    response.statusCode = status;
    response.end(JSON.stringify(value));
  };
  if (request.method === 'OPTIONS') return send({});
  if (
    request.method !== 'GET' &&
    !(request.method === 'POST' && request.url.startsWith('/public/restaurants/guest/'))
  )
    return send({ error: { code: 'READ_ONLY_FIXTURE' } }, 405);
  const { phase = 'configure' } = JSON.parse(readFileSync(phaseFile, 'utf8'));
  const path = new URL(request.url, 'http://localhost:4201').pathname;
  const role = 'OWNER',
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
  if (path === '/public/restaurants/guest/resolve' || path === '/public/restaurants/guest/renew') {
    const state =
      {
        free: 'FREE',
        occupied: 'OCCUPIED',
        'new-visit': 'OCCUPIED',
        expired: 'EXPIRED',
        closed: 'VISIT_ENDED',
        invalid: 'UNAVAILABLE',
        revoked: 'UNAVAILABLE',
      }[phase] ?? 'FREE';
    if (!['FREE', 'OCCUPIED'].includes(state)) return send({ state });
    return send({
      state,
      visitRef: state === 'OCCUPIED' ? (phase === 'new-visit' ? 'w' : 'v').repeat(43) : null,
      restaurantName: 'Héritage Bistro',
      outletName: 'Établissement du Centre',
      tableName: 'Table du jardin',
      policy: 'STAFF_APPROVAL',
      orderingPermitted: state === 'OCCUPIED',
      waiterCallAvailable: true,
      guestHandle: 'a'.repeat(22),
      capability: 'header..iv.' + 'c'.repeat(150) + '.tag',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    });
  }
  if (path === '/public/restaurants/guest/carte') {
    if (phase === 'offline') return send({ error: { code: 'NETWORK_UNAVAILABLE' } }, 503);
    if (phase === 'no-menu') return send({ state: 'NO_MENU' });
    const price = phase === 'price-change' ? 3750 : 3500;
    const missing = phase === 'missing';
    response.setHeader('ETag', 'W/"guest-carte-review"');
    return send({
      state: 'READY',
      currency: 'XOF',
      referencesExpireAt: new Date(Date.now() + 900000).toISOString(),
      categories: [
        {
          reference: 'category-grillades-public-reference',
          name: 'Grillades',
          position: 0,
          items: missing
            ? []
            : [
                {
                  reference: 'item-chicken-public-reference',
                  selectionRef: `selection-chicken-${Date.now()}`,
                  name: 'Poulet braisé aux épices douces et son accompagnement de saison',
                  amountMinor: price,
                  availability: 'AVAILABLE',
                },
                {
                  reference: 'item-fish-public-reference',
                  selectionRef: `selection-fish-${Date.now()}`,
                  name: 'Poisson grillé',
                  amountMinor: 5000,
                  availability: phase === 'item-unavailable' ? 'UNAVAILABLE' : 'AVAILABLE',
                },
              ],
        },
        {
          reference: 'category-drinks-public-reference',
          name: 'Boissons',
          position: 1,
          items: Array.from({ length: 10 }, (_, index) => ({
            reference: `item-drink-${String(index).padStart(2, '0')}-public-reference`,
            selectionRef: `selection-drink-${index}-${Date.now()}`,
            name:
              index === 9 ? 'Jus de gingembre maison sans sucre ajouté' : `Boisson ${index + 1}`,
            amountMinor: 750 + index * 100,
            availability: index === 8 ? 'UNAVAILABLE' : 'AVAILABLE',
          })),
        },
        {
          reference: 'category-desserts-public-reference',
          name: 'Desserts',
          position: 2,
          items: [
            {
              reference: 'item-dessert-public-reference',
              selectionRef: `selection-dessert-${Date.now()}`,
              name: 'Salade de fruits frais',
              amountMinor: 2000,
              availability: 'AVAILABLE',
            },
          ],
        },
      ],
    });
  }
  if (path.endsWith('/qr/status'))
    return send({
      status: phase === 'revoked' ? 'REVOKED' : 'ACTIVE',
      version: 1,
      ...(phase === 'revoked' ? {} : { token: 'A'.repeat(43) }),
    });
  if (path.endsWith('/tables'))
    return send({
      items: [
        {
          ...metadata,
          id: id(4),
          name: 'Table du jardin',
          code: 'J01',
          outletId: id(2),
          serviceAreaId: id(3),
          capacity: 4,
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
