/** Deterministic loopback-only Carte review. No proxy, production writes or auth logging.
 * node scripts/restaurants-carte-review.mjs /tmp/carte-review-state.json
 * state: { pages: 3, failPage: 2, delay: 100 }; request counts: /tmp/carte-review-requests.json
 * Temporarily use localhost:4201 as development apiBaseUrl; restore after review.
 */
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import * as c from '@liass-ohada/shared/restaurants';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const org = 'org-1d6ccb74-b290-44f7-a151-6a619aa0526f',
  stamp = '2026-10-18T10:00:00.000Z';
const meta = { version: 1, isActive: true, createdAt: stamp, updatedAt: stamp };
const calls = [],
  orders = [],
  items = [];
let sequence = 5000;
const config = () => JSON.parse(readFileSync(process.argv[2], 'utf8'));
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:4200');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization,x-org-id,x-workspace-org-id,accept-language,content-type',
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const send = (value, status = 200) => {
    res.statusCode = status;
    res.end(JSON.stringify(value));
  };
  if (req.method === 'OPTIONS') return send({});
  const url = new URL(req.url, 'http://localhost:4201'),
    path = url.pathname,
    parts = path.split('/'),
    outlet = parts[3],
    session = parts[5];
  calls.push({ method: req.method, path, query: url.search });
  writeFileSync('/tmp/carte-review-requests.json', JSON.stringify(calls, null, 2));
  if (path === '/me/workspaces')
    return send({
      workspaces: [
        {
          orgId: org,
          displayName: 'Carte review',
          workspaceType: 'COMPANY',
          role: 'OWNER',
          status: 'ACTIVE',
          accessSource: 'DIRECT',
          productRoles: { RESTAURANTS: 'OWNER' },
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
  if (path === '/restaurants/restaurant')
    return send({
      data: { ...meta, id: id(1), name: 'Atelier Resto', guestOrderingPolicy: 'STAFF_APPROVAL' },
    });
  if (path === '/restaurants/outlets')
    return send({
      items: [2, 12].map((n) => ({
        ...meta,
        id: id(n),
        restaurantId: id(1),
        name: n === 2 ? 'Centre' : 'Jardin',
      })),
    });
  if (path.endsWith('/service-areas'))
    return send({ items: [{ ...meta, id: id(3), outletId: outlet, name: 'Terrasse' }] });
  if (path.endsWith('/service-floor'))
    return send({
      outletId: outlet,
      items: [4, 5]
        .map((n) => ({
          tableId: id(n),
          name: n === 4 ? 'Terrasse des amis' : 'Salon du jardin',
          code: 'T' + n,
          areaId: id(3),
          areaName: 'Terrasse',
          state: 'OCCUPIED',
          capacity: 4,
          guestSessionId: id(n + 5),
          openedAt: stamp,
          openedBy: 'review',
          currency: 'XOF',
          currentAmountMinor: 150000,
        }))
        .concat([
          {
            tableId: id(6),
            name: 'Table libre',
            code: 'T6',
            areaId: id(3),
            areaName: 'Terrasse',
            state: 'FREE',
          },
        ]),
    });
  if (path.endsWith('/menu'))
    return send({
      data: { ...meta, id: id(7), outletId: outlet, name: 'Carte maison', currency: 'XOF' },
    });
  if (path.endsWith('/menu/items')) {
    const cfg = config(),
      index = Number(url.searchParams.get('cursor') ?? 0);
    if (cfg.delay) await new Promise((resolve) => setTimeout(resolve, cfg.delay));
    if (index === cfg.failPage)
      return send({ message: 'Chargement temporairement indisponible' }, 503);
    return send(
      c.MenuItemsBrowseResponseSchema.parse({
        outletId: outlet,
        menuId: id(7),
        items: Array.from({ length: 100 }, (_, j) => ({
          id: id(100 + index * 100 + j),
          name:
            (index === 2 && j === 99
              ? 'Café crème spécial'
              : [
                  'Poulet braisé sauce maison',
                  'Jus d’ananas frais',
                  'Poisson grillé accompagné d’attiéké',
                  'Assiette de fruits de saison',
                ][j % 4]) +
            ' ' +
            (index * 100 + j + 1),
          outletId: outlet,
          menuId: id(7),
          categoryId: id(j % 2 ? 16 : 6),
          categoryName: j % 2 ? 'Boissons' : 'Cuisine maison',
          price: { amountMinor: j % 2 ? 2500 : 150000, currency: 'XOF' },
          version: 1,
          availability: j === 8 ? 'UNAVAILABLE' : 'AVAILABLE',
        })),
        ...(index + 1 < (cfg.pages ?? 3) ? { nextCursor: String(index + 1) } : {}),
      }),
    );
  }
  const dataOrder = (order) => c.RestaurantOrderResponseSchema.parse({ data: order });
  if (req.method === 'GET' && /\/sessions\/[^/]+$/.test(path))
    return send({
      data: c.GuestSessionReadSchema.parse({
        orgId: org,
        outletId: outlet,
        schemaVersion: 1,
        guestSessionId: session,
        tableId: id(Number(session.slice(-2)) - 5),
        areaId: id(3),
        tableCode: 'T04',
        tableName: session === id(9) ? 'Terrasse des amis' : 'Salon du jardin',
        currency: 'XOF',
        status: 'OPEN',
        openedAt: stamp,
        openedBy: 'review',
        version: 1,
        financialRevision: 0,
        orderCount: orders.length,
        openOrderCount: orders.length,
        dueMinor: 150000,
        paidMinor: 0,
        reservedMinor: 0,
        pendingPaymentCount: 0,
      }),
    });
  if (req.method === 'GET' && path.endsWith('/orders') && path.includes('/sessions/'))
    return send({
      items: orders.filter((o) => o.outletId === outlet && o.guestSessionId === session),
    });
  const order = orders.find((o) => o.orderId === parts[5]);
  if (req.method === 'GET' && path.includes('/orders/'))
    return send(
      path.endsWith('/items')
        ? { items: items.filter((i) => i.orderId === parts[5]) }
        : dataOrder(order),
    );
  if (req.method === 'POST' || req.method === 'PATCH') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw || '{}');
    if (path.endsWith('/orders')) {
      const order = c.RestaurantOrderSchema.parse({
        orgId: org,
        outletId: outlet,
        schemaVersion: 1,
        orderId: id(++sequence),
        guestSessionId: input.guestSessionId,
        tableId: id(4),
        orderType: 'DINE_IN',
        status: 'DRAFT',
        currency: 'XOF',
        createdAt: stamp,
        createdBy: 'review',
        version: 1,
        financialRevision: 0,
        lineCount: 0,
        acceptedLineCount: 0,
        draftLineCount: 0,
        dueMinor: 0,
        paidMinor: 0,
        reservedMinor: 0,
        pendingPaymentCount: 0,
      });
      orders.push(order);
      return send(dataOrder(order));
    }
    if (path.endsWith('/items')) {
      const line = c.RestaurantOrderItemSchema.parse({
        orgId: org,
        outletId: outlet,
        schemaVersion: 1,
        orderId: order.orderId,
        itemId: id(++sequence),
        menuItemId: input.menuItemId,
        categoryId: input.categoryId,
        expectedMenuItemVersion: input.expectedMenuItemVersion,
        quantity: input.quantity,
        status: 'DRAFT',
        version: 1,
        createdAt: stamp,
      });
      items.push(line);
      order.version++;
      order.draftLineCount++;
      order.lineCount++;
      return send({ data: line });
    }
    if (path.endsWith('/submit')) {
      order.status = 'SUBMITTED';
      order.version++;
      for (const line of items.filter((i) => i.orderId === order.orderId && i.status === 'DRAFT')) {
        line.status = 'ACCEPTED';
        line.version++;
        line.snapshot = {
          menuItemId: line.menuItemId,
          menuId: id(7),
          categoryId: line.categoryId,
          itemVersion: 1,
          categoryVersion: 1,
          menuVersion: 1,
          grossMinor: line.quantity * 150000,
          subtotalMinor: line.quantity * 150000,
          discountMinor: 0,
          taxMinor: 0,
          acceptedBy: 'review',
          name: 'Poulet braisé sauce maison',
          quantity: line.quantity,
          unitPriceMinor: 150000,
          lineTotalMinor: line.quantity * 150000,
          currency: 'XOF',
          acceptedAt: stamp,
          submissionId: id(++sequence),
        };
      }
      order.acceptedLineCount = order.lineCount;
      order.draftLineCount = 0;
      return send(dataOrder(order));
    }
    const line = items.find((i) => i.itemId === parts[7]);
    if (line) {
      line.version++;
      order.version++;
      if (path.endsWith('/cancel')) {
        line.status = 'CANCELLED';
        order.draftLineCount--;
      } else line.quantity = input.quantity;
      return send({ data: line });
    }
  }
  if (path.includes('/categories/') && path.includes('/items/'))
    return send({
      data: {
        ...meta,
        id: parts.at(-1),
        name: 'Poulet braisé sauce maison',
        outletId: outlet,
        menuId: id(7),
        categoryId: parts[6],
        price: { amountMinor: 150000, currency: 'XOF' },
        availability: 'AVAILABLE',
        guestReorderEnabled: true,
      },
    });
  return send({ items: [] });
});
server.listen(4201, '127.0.0.1', () => console.log('Carte review loopback fixture ready'));
