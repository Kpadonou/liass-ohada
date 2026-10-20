/** Loopback-only disposable checkout review; never proxies or logs authentication.
 * node scripts/restaurants-checkout-review.mjs /tmp/checkout-review.json
 * Temporarily point development apiBaseUrl at localhost:4201, restore after review.
 */
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as c from '@liass-ohada/shared/restaurants';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cfg = () => JSON.parse(readFileSync(process.argv[2], 'utf8'));
const org = 'org-1d6ccb74-b290-44f7-a151-6a619aa0526f',
  stamp = '2026-10-19T10:00:00.000Z';
const meta = { version: 1, isActive: true, createdAt: stamp, updatedAt: stamp };
const sessions = new Map(),
  orders = new Map(),
  replays = new Map(),
  calls = [];
const receipts = new Map();
function visit(outlet, sessionId) {
  if (!sessions.has(sessionId)) {
    const count = cfg().orders ?? 1;
    const session = c.GuestSessionReadSchema.parse({
      orgId: org,
      outletId: outlet,
      schemaVersion: 1,
      guestSessionId: sessionId,
      tableId: id(4),
      areaId: id(3),
      tableCode: 'TECH-CODE',
      tableName: 'Terrasse jardin près de la baie vitrée',
      currency: 'XOF',
      status: 'OPEN',
      openedAt: stamp,
      openedBy: 'review',
      responsibleStaff: {
        staffId: 'review',
        displayName: 'Marie-Christine Adélaïde Kpadonou',
        available: true,
      },
      version: 1,
      financialRevision: 0,
      orderCount: count,
      openOrderCount: count,
      dueMinor: 20000,
      paidMinor: 0,
      reservedMinor: 0,
      pendingPaymentCount: 0,
    });
    sessions.set(sessionId, session);
    for (let i = 0; i < count; i++) {
      const due =
        i === count - 1
          ? 20000 - Math.floor(20000 / count) * (count - 1)
          : Math.floor(20000 / count);
      const order = c.RestaurantOrderSchema.parse({
        orgId: org,
        outletId: outlet,
        schemaVersion: 1,
        orderId: id(100 + i),
        guestSessionId: sessionId,
        tableId: id(4),
        orderType: 'DINE_IN',
        status: 'SUBMITTED',
        currency: 'XOF',
        createdAt: stamp,
        createdBy: 'review',
        version: 1,
        financialRevision: 0,
        lineCount: cfg().draft ? 2 : 1,
        acceptedLineCount: 1,
        draftLineCount: cfg().draft ? 1 : 0,
        outstandingWorkCount: 0,
        dueMinor: due,
        paidMinor: 0,
        reservedMinor: 0,
        pendingPaymentCount: 0,
      });
      orders.set(order.orderId, order);
    }
  }
  return sessions.get(sessionId);
}
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:4200');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization,x-org-id,x-workspace-org-id,accept-language,content-type',
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  let record;
  const send = (value, status = 200) => {
    if (record) {
      record.status = status;
      writeFileSync('/tmp/checkout-review-requests.json', JSON.stringify(calls, null, 2));
    }
    res.statusCode = status;
    res.end(JSON.stringify(value));
  };
  if (req.method === 'OPTIONS') return send({});
  const url = new URL(req.url, 'http://localhost:4201'),
    path = url.pathname,
    parts = path.split('/'),
    outlet = parts[3],
    parent = parts[5];
  let input;
  if (req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    input = JSON.parse(body);
  }
  record = { method: req.method, path, query: url.search, ...(input ? { body: input } : {}) };
  calls.push(record);
  writeFileSync('/tmp/checkout-review-requests.json', JSON.stringify(calls, null, 2));
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
          productRoles: { RESTAURANTS: cfg().role ?? 'CASHIER' },
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
  if (cfg().deny && path.startsWith('/restaurants'))
    return send({ message: 'Votre accès à cet établissement a changé.' }, 403);
  if (path === '/restaurants/me/outlets')
    return send({ items: [{ outletId: id(2), name: 'Restaurant jardin' }] });
  if (path === '/restaurants/outlets')
    return send({
      items: [{ ...meta, id: id(2), restaurantId: id(1), name: 'Restaurant jardin' }],
    });
  if (path === '/restaurants/restaurant')
    return send({
      data: { ...meta, id: id(1), name: 'Atelier Resto', guestOrderingPolicy: 'STAFF_APPROVAL' },
    });
  if (path.endsWith('/service-floor')) {
    const s = visit(outlet, id(9));
    const base = { tableId: id(4), name: s.tableName, code: 'TECH-CODE', areaId: id(3) };
    return send({
      outletId: outlet,
      items: [
        s.status === 'OPEN'
          ? {
              ...base,
              state: 'OCCUPIED',
              guestSessionId: s.guestSessionId,
              openedAt: stamp,
              openedBy: 'review',
              currency: 'XOF',
              currentAmountMinor: s.dueMinor,
            }
          : { ...base, state: 'FREE' },
        { ...base, tableId: id(5), name: 'Salle principale', state: 'FREE' },
      ],
    });
  }
  if (parts[4] === 'sessions') {
    const s = visit(outlet, parent);
    if (path.endsWith('/receipt')) {
      if (s.status !== 'CLOSED' && !cfg().receiptDirect)
        return send({ message: 'La table doit être clôturée.' }, 409);
      let r = receipts.get(parent);
      if (!r) {
        const count = cfg().receiptParts ?? 6,
          commercial = Math.max(1, count - 1),
          parts = [];
        let previous = '0'.repeat(64);
        const due = count === 1 ? 0 : 20000;
        for (let n = 1; n <= commercial; n++) {
          const amount =
            n === commercial
              ? due - Math.floor(due / commercial) * (commercial - 1)
              : Math.floor(due / commercial);
          const line = {
            orderId: id(100),
            itemId: id(200 + n),
            netAmountMinor: amount,
            notes:
              n === 1
                ? 'Sauce maison à part. Service en terrasse, près de la baie vitrée.'
                : undefined,
            snapshot: {
              menuItemId: id(300 + n),
              menuId: id(7),
              categoryId: id(400),
              itemVersion: 1,
              categoryVersion: 1,
              menuVersion: 1,
              name: [
                'Poisson grillé accompagné d’attiéké et de légumes de saison',
                'Poulet braisé sauce maison',
                'Jus d’ananas frais',
                'Salade de fruits de saison',
              ][n % 4],
              quantity: 1,
              unitPriceMinor: amount,
              grossMinor: amount,
              subtotalMinor: amount,
              discountMinor: 0,
              taxMinor: 0,
              lineTotalMinor: amount,
              currency: 'XOF',
              acceptedAt: stamp,
              submissionId: id(600 + n),
            },
          };
          const content = { kind: 'COMMERCIAL', lines: [line] };
          if (n === 1)
            content.lines.push({
              ...line,
              itemId: id(999),
              netAmountMinor: 0,
              cancelledAt: stamp,
              cancellationReason: 'Article remplacé à la demande du client',
              snapshot: {
                ...line.snapshot,
                name: 'Café gourmand avec assortiment de desserts maison',
                lineTotalMinor: 2000,
                unitPriceMinor: 2000,
                grossMinor: 2000,
                subtotalMinor: 2000,
              },
            });
          const digest = String(n).padStart(64, 'a');
          parts.push({ number: n, previousDigest: previous, digest, content });
          previous = digest;
        }
        if (count > 1) {
          parts.push({
            number: count,
            previousDigest: previous,
            digest: 'f'.repeat(64),
            content: {
              kind: 'SETTLEMENT',
              payments: [
                {
                  paymentId: id(800),
                  method: 'CASH',
                  appliedAmountMinor: 16000,
                  cashTenderedMinor: 20000,
                  changeMinor: 4000,
                  committedAt: stamp,
                  allocations: [{ orderId: id(100), amountMinor: 16000 }],
                },
                {
                  paymentId: id(801),
                  method: 'CARD',
                  appliedAmountMinor: 4000,
                  externalReference:
                    'Référence externe confirmée par le personnel — terminal terrasse',
                  committedAt: stamp,
                  allocations: [{ orderId: id(100), amountMinor: 4000 }],
                },
              ],
            },
          });
        }
        const summary = c.RestaurantReceiptSummarySchema.parse({
          receiptId: id(50),
          guestSessionId: parent,
          scopeKind: 'GUEST_SESSION',
          documentKind: 'OPERATIONAL_RECEIPT',
          schemaVersion: 1,
          restaurantName: 'Atelier gastronomique de la Maison des saveurs',
          outletName: 'Restaurant du jardin et de la grande terrasse',
          tableName: s.tableName,
          openedAt: stamp,
          closedAt: '2026-10-19T12:00:00.000Z',
          issuedAt: '2026-10-19T12:01:00.000Z',
          currency: 'XOF',
          dueMinor: due,
          paidMinor: due,
          paidByMethodMinor: {
            CASH: count > 1 ? 16000 : 0,
            MOBILE_MONEY: 0,
            CARD: count > 1 ? 4000 : 0,
          },
          partCount: parts.length,
          commercialPartCount: commercial,
          settlementPartCount: count > 1 ? 1 : 0,
          lineCount: commercial + 1,
          paymentCount: count > 1 ? 2 : 0,
          digest: parts.at(-1).digest,
        });
        r = { parts, summary, steps: 0, final: cfg().receiptDirect === 'FINAL', lost: false };
        receipts.set(parent, r);
      }
      if (req.method === 'POST') {
        c.PublishRestaurantReceiptRequestSchema.parse(input);
        r.steps++;
        if (!r.final && r.steps < (cfg().receiptBuildSteps ?? 1))
          return send(
            c.RestaurantReceiptPublicationResponseSchema.parse({
              data: {
                state: 'BUILDING',
                receiptId: r.summary.receiptId,
                version: r.steps,
                partCount: Math.min(r.parts.length, r.steps),
              },
            }),
          );
        r.final = true;
        if (cfg().loseReceiptResponse && !r.lost) {
          r.lost = true;
          return send({ message: 'La confirmation du reçu est incertaine. Réessayez.' }, 503);
        }
        return send(
          c.RestaurantReceiptPublicationResponseSchema.parse({
            data: { state: 'FINAL', receipt: r.summary },
          }),
        );
      }
      if (!r.final) return send({ message: 'Le reçu est en cours de préparation.' }, 404);
      const cursor = url.searchParams.get('cursor');
      if (cursor && cfg().failReceiptPage === cursor)
        return send({ message: 'Le détail du reçu est temporairement indisponible.' }, 503);
      const offset = cursor ? Number(cursor.slice(7)) : 0,
        limit = Math.min(8, Number(url.searchParams.get('limit') ?? 4));
      const result = {
        data: r.summary,
        parts: r.parts.slice(offset, offset + limit),
        ...(offset + limit < r.parts.length ? { nextCursor: 'cursor-' + (offset + limit) } : {}),
      };
      return send(c.RestaurantReceiptResponseSchema.parse(result));
    }
    if (req.method === 'GET' && parts.length === 6) return send({ data: s });
    if (path.endsWith('/orders')) {
      for (const o of orders.values())
        o.outstandingWorkCount = cfg().ready && o.orderId === id(100) ? 1 : 0;
      return send({
        items: [...orders.values()].filter((o) => o.guestSessionId === s.guestSessionId),
      });
    }
    if (path.endsWith('/payments')) {
      const key = 'pay:' + input.clientRequestId;
      if (replays.has(key)) return send(replays.get(key));
      const request = c.CaptureRestaurantPaymentRequestSchema.parse(input);
      const amount = request.allocations.reduce((n, a) => n + a.amountMinor, 0);
      if (
        request.expectedVersion !== s.version ||
        s.status !== 'OPEN' ||
        amount > s.dueMinor - s.paidMinor
      )
        return send({ message: 'Le solde a changé. Actualisez et confirmez à nouveau.' }, 409);
      for (const allocation of request.allocations) {
        const o = orders.get(allocation.orderId);
        o.paidMinor += allocation.amountMinor;
        o.version++;
        o.financialRevision++;
      }
      s.paidMinor += amount;
      s.version++;
      s.financialRevision++;
      const payment = {
        orgId: org,
        outletId: outlet,
        schemaVersion: 1,
        paymentId: randomUUID(),
        guestSessionId: s.guestSessionId,
        status: 'SUCCEEDED',
        version: 1,
        method: request.method,
        currency: 'XOF',
        appliedAmountMinor: amount,
        clientRequestId: request.clientRequestId,
        fingerprint: 'a'.repeat(64),
        actorId: 'review',
        attemptedAt: stamp,
        committedAt: stamp,
        allocations: request.allocations,
        session: Object.fromEntries(
          [
            'guestSessionId',
            'currency',
            'status',
            'version',
            'financialRevision',
            'dueMinor',
            'paidMinor',
            'reservedMinor',
            'pendingPaymentCount',
          ].map((k) => [k, s[k]]),
        ),
        ...(request.method === 'CASH'
          ? {
              cashTenderedMinor: request.cashTenderedMinor,
              changeMinor: request.cashTenderedMinor - amount,
            }
          : {}),
      };
      const response = c.RestaurantPaymentResponseSchema.parse({ data: payment });
      replays.set(key, response);
      if (cfg().losePaymentResponse)
        return send(
          { message: 'Le résultat du paiement est incertain. Réessayez à l’identique.' },
          503,
        );
      return send(response);
    }
    if (path.endsWith('/close')) {
      const key = 'session:' + input.clientRequestId;
      if (replays.has(key)) return send(replays.get(key));
      if (s.openOrderCount || s.dueMinor !== s.paidMinor || input.expectedVersion !== s.version)
        return send({ message: 'La table ne peut pas encore être clôturée.' }, 409);
      s.status = 'CLOSED';
      s.version++;
      const response = { data: { ...s } };
      replays.set(key, response);
      if (cfg().loseFinalResponse)
        return send(
          { message: 'La confirmation de clôture est incertaine. Reprenez à l’identique.' },
          503,
        );
      return send(response);
    }
  }
  if (parts[4] === 'orders') {
    const o = orders.get(parent);
    if (!o) return send({ message: 'Commande indisponible' }, 404);
    o.outstandingWorkCount = cfg().ready && parent === id(100) ? 1 : 0;
    if (req.method === 'GET' && parts.length === 6) return send({ data: o });
    if (path.endsWith('/items'))
      return send({
        items: [
          c.RestaurantOrderItemSchema.parse({
            orgId: org,
            outletId: outlet,
            schemaVersion: 1,
            orderId: o.orderId,
            itemId: id(200),
            menuItemId: id(300),
            categoryId: id(400),
            quantity: 2,
            expectedMenuItemVersion: 1,
            version: 1,
            status: 'ACCEPTED',
            createdAt: stamp,
            notes: 'Sauce à part',
            snapshot: {
              menuItemId: id(300),
              menuId: id(7),
              categoryId: id(400),
              itemVersion: 1,
              categoryVersion: 1,
              menuVersion: 1,
              name: 'Poisson grillé accompagné d’attiéké et de légumes de saison',
              quantity: 2,
              unitPriceMinor: o.dueMinor / 2,
              grossMinor: o.dueMinor,
              subtotalMinor: o.dueMinor,
              discountMinor: 0,
              taxMinor: 0,
              lineTotalMinor: o.dueMinor,
              currency: 'XOF',
              acceptedAt: stamp,
              acceptedBy: 'review',
              submissionId: id(600),
            },
          }),
        ],
      });
    if (path.endsWith('/close')) {
      const key = 'order:' + input.clientRequestId;
      if (replays.has(key)) return send(replays.get(key));
      if (o.outstandingWorkCount || o.dueMinor !== o.paidMinor || cfg().failOrder === o.orderId)
        return send({ message: 'La préparation ou le service doit être terminé.' }, 409);
      o.status = 'CLOSED';
      o.version++;
      const s = sessions.get(o.guestSessionId);
      s.openOrderCount--;
      s.version++;
      const response = { data: { ...o } };
      replays.set(key, response);
      return send(response);
    }
  }
  return send({ message: 'Ressource indisponible' }, 404);
});
server.listen(4201, '127.0.0.1', () => console.log('Disposable checkout review fixture ready'));
