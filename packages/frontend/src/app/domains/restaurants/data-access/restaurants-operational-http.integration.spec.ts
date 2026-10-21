import { inject as testContext } from 'vitest';
import * as c from '@liass-ohada/shared/restaurants';

declare module 'vitest' {
  interface ProvidedContext {
    restaurantsUrl: string;
  }
}

it('traces V1 mixed submission → Ready → payment while unserved → serialized Serve → explicit Close → FINAL Receipt over real HTTP', async () => {
  const url = testContext('restaurantsUrl');
  await fetch(url + '/__test/reset', { method: 'POST' });
  const trace: { path: string; method: string; status: number }[] = [];
  const call = async (path: string, body?: unknown, expected = 200): Promise<unknown> => {
    const method = body ? 'POST' : 'GET';
    const response = await fetch(url + path, {
      method,
      headers: {
        authorization: 'Bearer owner',
        'x-org-id': 'org-a',
        'content-type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    trace.push({ path, method, status: response.status });
    const result: unknown = await response.json();
    expect(response.status, JSON.stringify({ path, result })).toBe(expected);
    return result;
  };
  const named = (name: string) => ({ name, clientRequestId: crypto.randomUUID() });
  await call('/restaurants/restaurant', named('V1 Bistro'), 200);
  const outlet = c.OutletResponseSchema.parse(
    await call('/restaurants/outlets', named('Centre'), 200),
  ).data;
  const base = `/restaurants/outlets/${outlet.id}`;
  const area = c.ServiceAreaResponseSchema.parse(
    await call(base + '/service-areas', named('Salle'), 200),
  ).data;
  const table = c.RestaurantTableResponseSchema.parse(
    await call(
      base + `/service-areas/${area.id}/tables`,
      { ...named('Terrasse jardin'), code: 'T1' },
      200,
    ),
  ).data;
  const stations = [];
  for (const name of ['Cuisine', 'Bar'])
    stations.push(
      c.PreparationStationResponseSchema.parse(
        await call(base + '/preparation-stations', named(name), 200),
      ).data,
    );
  await call(base + '/menu', { ...named('Carte'), currency: 'XOF' }, 200);
  const category = c.MenuCategoryResponseSchema.parse(
    await call(base + '/menu/categories', named('Carte du jour'), 200),
  ).data;
  const items = [];
  for (const [index, name] of ['Poulet', 'Jus préparé', 'Eau en bouteille'].entries())
    items.push(
      c.MenuItemResponseSchema.parse(
        await call(
          base + `/menu/categories/${category.id}/items`,
          {
            ...named(name),
            price: { amountMinor: 1000, currency: 'XOF' },
            ...(index < 2 ? { preparationStationId: stations[index].id } : {}),
          },
          200,
        ),
      ).data,
    );
  const session = c.GuestSessionResponseSchema.parse(
    await call(base + '/sessions', {
      clientRequestId: crypto.randomUUID(),
      tableId: table.id,
      areaId: area.id,
    }),
  ).data;
  const orders: c.RestaurantOrder[] = [];
  let tasks: c.PreparationRead[] = [];
  for (const indexes of [[0, 1, 2], [0]]) {
    let order = c.RestaurantOrderResponseSchema.parse(
      await call(base + '/orders', {
        clientRequestId: crypto.randomUUID(),
        orderType: 'DINE_IN',
        guestSessionId: session.guestSessionId,
      }),
    ).data;
    const lines: c.RestaurantOrderItem[] = [];
    for (const index of indexes) {
      const item = items[index];
      lines.push(
        c.RestaurantOrderItemResponseSchema.parse(
          await call(base + `/orders/${order.orderId}/items`, {
            clientRequestId: crypto.randomUUID(),
            expectedVersion: order.version,
            menuItemId: item.id,
            categoryId: item.categoryId,
            expectedMenuItemVersion: item.version,
            quantity: 1,
          }),
        ).data,
      );
      order = c.RestaurantOrderResponseSchema.parse(
        await call(base + `/orders/${order.orderId}`),
      ).data;
    }
    order = c.RestaurantOrderResponseSchema.parse(
      await call(base + `/orders/${order.orderId}/submit`, {
        clientRequestId: crypto.randomUUID(),
        expectedVersion: order.version,
        items: lines.map((l) => ({ itemId: l.itemId, expectedVersion: l.version })),
      }),
    ).data;
    const page = c.PreparationListResponseSchema.parse(
      await call(base + `/orders/${order.orderId}/preparation`),
    );
    expect(page.items).toHaveLength(indexes.length === 3 ? 2 : 1);
    for (const task of page.items) {
      expect(task.state).toBe('IN_PROGRESS');
      expect(task.startedAt).toBe(task.queuedAt);
      expect(task.startedBy).toBe('owner');
    }
    tasks.push(...page.items);
    orders.push(order);
  }
  const ready: c.RestaurantPreparation[] = [];
  for (const task of tasks)
    ready.push(
      c.PreparationResponseSchema.parse(
        await call(
          base + `/orders/${task.orderId}/items/${task.itemId}/preparation/${task.fireId}/ready`,
          { clientRequestId: crypto.randomUUID(), expectedVersion: task.version },
        ),
      ).data,
    );
  let visit = c.GuestSessionResponseSchema.parse(
    await call(base + `/sessions/${session.guestSessionId}`),
  ).data;
  await call(base + `/sessions/${session.guestSessionId}/payments`, {
    clientRequestId: crypto.randomUUID(),
    expectedVersion: visit.version,
    currency: 'XOF',
    method: 'CASH',
    cashTenderedMinor: 4000,
    allocations: orders.map((o) => ({ orderId: o.orderId, amountMinor: o.dueMinor })),
  });
  visit = c.GuestSessionResponseSchema.parse(
    await call(base + `/sessions/${session.guestSessionId}`),
  ).data;
  expect(visit.paidMinor).toBe(visit.dueMinor);
  expect(visit.status).toBe('OPEN');
  const unpaidServiceOrder = c.RestaurantOrderResponseSchema.parse(
    await call(base + `/orders/${orders[0].orderId}`),
  ).data;
  await call(
    base + `/orders/${unpaidServiceOrder.orderId}/close`,
    { clientRequestId: crypto.randomUUID(), expectedVersion: unpaidServiceOrder.version },
    409,
  );
  for (const task of ready) {
    const input = { clientRequestId: crypto.randomUUID(), expectedVersion: task.version };
    const path =
      base + `/orders/${task.orderId}/items/${task.itemId}/preparation/${task.fireId}/serve`;
    const result = await call(path, input);
    expect(c.PreparationResponseSchema.parse(result).data.state).toBe('SERVED');
    expect(await call(path, input)).toEqual(result);
  }
  for (const row of orders) {
    const order = c.RestaurantOrderResponseSchema.parse(
      await call(base + `/orders/${row.orderId}`),
    ).data;
    expect(order.outstandingWorkCount).toBe(0);
    await call(base + `/orders/${order.orderId}/close`, {
      clientRequestId: crypto.randomUUID(),
      expectedVersion: order.version,
    });
  }
  visit = c.GuestSessionResponseSchema.parse(
    await call(base + `/sessions/${session.guestSessionId}`),
  ).data;
  await call(base + `/sessions/${session.guestSessionId}/close`, {
    clientRequestId: crypto.randomUUID(),
    expectedVersion: visit.version,
  });
  const floor = c.RestaurantServiceFloorResponseSchema.parse(await call(base + '/service-floor'));
  expect(floor.items.find((t) => t.tableId === table.id)?.state).toBe('FREE');
  const receiptPath = base + `/sessions/${session.guestSessionId}/receipt`;
  const publication = c.RestaurantReceiptPublicationResponseSchema.parse(
    await call(receiptPath, { clientRequestId: crypto.randomUUID() }),
  );
  expect(publication.data.state).toBe('FINAL');
  const receipt = c.RestaurantReceiptResponseSchema.parse(await call(receiptPath));
  expect(receipt.data.lineCount).toBe(4);
  expect(trace.some((r) => r.path.endsWith('/start'))).toBe(false);
  console.info('RESTO_OPS_SIMPLIFY_HTTP_TRACE', JSON.stringify(trace));
}, 30_000);
