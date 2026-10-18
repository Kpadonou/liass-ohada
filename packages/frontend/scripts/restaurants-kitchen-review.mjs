/** Loopback-only deterministic Kitchen review; no AWS forwarding or auth logging.
 * node scripts/restaurants-kitchen-review.mjs /tmp/kitchen-review-state.json
 * State supports role/outlets/stations/count/delay/conflict; request evidence stays in /tmp.
 */
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import * as c from '@liass-ohada/shared/restaurants';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const org = 'org-1d6ccb74-b290-44f7-a151-6a619aa0526f';
const stamp = new Date(Date.now() - 12 * 60_000).toISOString();
const config = () => JSON.parse(readFileSync(process.argv[2], 'utf8'));
const meta = { version: 1, isActive: true, createdAt: stamp, updatedAt: stamp };
const calls = [],
  tasks = [],
  replays = new Map();
const states = ['QUEUED', 'IN_PROGRESS', 'READY'];
const names = [
  'Poulet braisé sauce maison',
  'Poisson grillé accompagné d’attiéké',
  'Frites maison',
  'Jus d’ananas frais',
  'Salade César',
  'Assiette de fruits de saison et sélection gourmande préparée à la demande avec accompagnement de saison',
];
for (const outlet of [2, 12])
  for (const station of [3, 4, 5])
    for (const [lane, state] of states.entries())
      for (let i = 0; i < (config().count ?? 3); i++) {
        const seq = outlet * 10000 + station * 1000 + lane * 100 + i;
        tasks.push(
          c.PreparationReadSchema.parse({
            orgId: org,
            outletId: id(outlet),
            schemaVersion: 1,
            orderId: id(seq),
            itemId: id(seq + 100000),
            fireId: id(seq + 200000),
            submissionId: id(seq + 300000),
            stationId: id(station),
            stationVersion: 1,
            generation: 1,
            name: names[(lane + i) % names.length],
            quantity: i === 2 ? 12 : i + 1,
            notes:
              i === 0
                ? 'Sans piment · sauce à part'
                : i === 2
                  ? 'Préparer les accompagnements séparément et conserver la sauce dans un petit récipient. Merci de vérifier les instructions avant de commencer.'
                  : undefined,
            state,
            queuedAt: stamp,
            queuedBy: 'review',
            ...(state !== 'QUEUED' ? { startedAt: stamp, startedBy: 'review' } : {}),
            ...(state === 'READY' ? { readyAt: stamp, readyBy: 'review' } : {}),
            version: 1,
            serviceContext:
              i === 0
                ? { mode: 'DINE_IN', tableName: 'Terrasse jardin' }
                : i === 1
                  ? { mode: lane === 2 ? 'COUNTER' : 'TAKEAWAY' }
                  : i === 2
                    ? {
                        mode: 'DINE_IN',
                        tableName:
                          'Près de la baie vitrée donnant sur le jardin et la grande terrasse fleurie',
                      }
                    : { mode: 'COUNTER' },
          }),
        );
      }
http
  .createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:4200');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'authorization,x-org-id,x-workspace-org-id,accept-language,content-type',
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    const send = (value, status = 200) => {
      res.statusCode = status;
      res.end(JSON.stringify(value));
    };
    if (req.method === 'OPTIONS') return send({});
    const url = new URL(req.url, 'http://localhost:4201');
    const path = url.pathname;
    calls.push({ method: req.method, path, query: url.search });
    writeFileSync('/tmp/kitchen-review-requests.json', JSON.stringify(calls, null, 2));
    if (path === '/me/workspaces')
      return send({
        workspaces: [
          {
            orgId: org,
            displayName: 'Atelier Resto',
            workspaceType: 'COMPANY',
            role: 'OWNER',
            status: 'ACTIVE',
            accessSource: 'DIRECT',
            productRoles: { RESTAURANTS: config().role ?? 'KITCHEN' },
          },
        ],
      });
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
    if (path === '/restaurants/me/outlets')
      return send({
        items: [2, 12].slice(0, config().outlets ?? 2).map((n) => ({
          outletId: id(n),
          name: n === 2 ? 'Centre · Atelier des saveurs' : 'Jardin',
        })),
      });
    if (path === '/restaurants/outlets')
      return send({
        items: [2, 12].map((n) => ({
          ...meta,
          id: id(n),
          name: n === 2 ? 'Centre · Atelier des saveurs' : 'Jardin',
          restaurantId: id(1),
        })),
      });
    if (path.endsWith('/preparation-stations'))
      return send({
        items: [3, 4, 5].slice(0, config().stations ?? 3).map((n) => ({
          ...meta,
          id: id(n),
          outletId: path.split('/')[3],
          name:
            n === 3
              ? 'Cuisine · Grill et plats chauds'
              : n === 4
                ? 'Bar · Jus frais et boissons'
                : 'Ancien poste pâtisserie',
          isActive: n !== 5,
        })),
      });
    if (path.includes('/work/')) {
      const parts = path.split('/'),
        outlet = parts[3],
        station = parts[5],
        state = parts[7];
      const list = tasks.filter(
        (t) => t.outletId === outlet && t.stationId === station && t.state === state,
      );
      const offset = Number(url.searchParams.get('cursor') ?? 0),
        limit = Number(url.searchParams.get('limit') ?? 50);
      return send(
        c.PreparationListResponseSchema.parse({
          items: list.slice(offset, offset + limit),
          nextCursor: offset + limit < list.length ? String(offset + limit) : undefined,
        }),
      );
    }
    if (req.method === 'POST' && /\/(start|ready)$/.test(path)) {
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = c.PreparationTransitionRequestSchema.parse(JSON.parse(body));
      const parts = path.split('/');
      const task = tasks.find(
        (t) =>
          t.outletId === parts[3] &&
          t.orderId === parts[5] &&
          t.itemId === parts[7] &&
          t.fireId === parts[9],
      );
      if (config().delay) await new Promise((resolve) => setTimeout(resolve, config().delay));
      if (replays.has(input.clientRequestId)) return send(replays.get(input.clientRequestId));
      if (!task) return send({ error: { code: 'RESTAURANTS_NOT_FOUND' } }, 404);
      if (config().conflict || task.version !== input.expectedVersion)
        return send({ error: { code: 'RESTAURANTS_WRITE_CONFLICT' } }, 409);
      const action = parts[10];
      task.state = action === 'start' ? 'IN_PROGRESS' : 'READY';
      task.version++;
      if (action === 'start') {
        task.startedAt = new Date().toISOString();
        task.startedBy = 'review';
      } else {
        task.readyAt = new Date().toISOString();
        task.readyBy = 'review';
      }
      const { serviceContext, ...data } = task;
      const response = c.PreparationResponseSchema.parse({ data });
      replays.set(input.clientRequestId, response);
      return send(response);
    }
    return send({ error: { code: 'RESTAURANTS_NOT_FOUND' } }, 404);
  })
  .listen(4201, '127.0.0.1', () => console.log('Kitchen fixture on http://localhost:4201'));
