import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import {
  RestaurantTransactionsService as S,
  RestaurantTransactionCommand,
} from "@/lambda/domains/restaurants/transaction-service";
import { RestaurantTransactionQueries as Q } from "@/lambda/domains/restaurants/transaction-queries";
import { RestaurantTransactionsRepository as R } from "@/lambda/domains/restaurants/transaction-repository";
import { restaurantTransactionHandler } from "@/lambda/domains/restaurants/transaction-handler";
import { RESTAURANT_TRANSACTION_ROUTES } from "@/lambda/domains/restaurants/transaction-routes";
import { RestaurantsService as Config } from "@/lambda/domains/restaurants/restaurant-service";
import { DomainAuthorizationService } from "@/lambda/shared/services/domain-authorization-service";
import * as contracts from "@liass-ohada/shared/restaurants";
import { RESTAURANTS_TRANSACTION_PERMISSIONS } from "@liass-ohada/shared/shared";
import { acceptanceFixture } from "./acceptance-fixture";
import { fixtureId, memoryDynamo } from "./memory-dynamo";
import { InventorySales } from "@/lambda/domains/restaurants/inventory-sales";
import {
  pureEmptyDraftHeader,
  qualifyPureEmptyDraft,
} from "@/lambda/domains/restaurants/empty-draft";

let memory: ReturnType<typeof memoryDynamo>,
  fixture: Awaited<ReturnType<typeof acceptanceFixture>>;
let ctx: { orgId: string; outletId: string; actorId: string }, sequence: number;
const requestId = () => fixtureId(++sequence);
const execute = async (
  command: RestaurantTransactionCommand,
  input: object,
  ids: object = {},
) => S.mutate(ctx, command, input, ids);
const open = () =>
  execute("OPEN_SESSION", {
    clientRequestId: requestId(),
    tableId: fixture.tables[0].id,
    areaId: fixture.areas[0].id,
  });
const create = (guestSessionId?: string) =>
  execute("CREATE_ORDER", {
    clientRequestId: requestId(),
    orderType: guestSessionId ? "DINE_IN" : "COUNTER",
    ...(guestSessionId ? { guestSessionId } : {}),
  });
const add = async (orderId: string, itemIndex = 0, quantity = 1) => {
  const order = await S.order(ctx, orderId),
    item = fixture.items[itemIndex];
  return execute(
    "ADD_ITEM",
    {
      clientRequestId: requestId(),
      expectedVersion: order.data.version,
      menuItemId: item.id,
      categoryId: item.categoryId,
      expectedMenuItemVersion: item.version,
      quantity,
    },
    { orderId },
  );
};
const submit = async (
  orderId: string,
  itemId: string,
  clientRequestId = requestId(),
) => {
  const order = await S.order(ctx, orderId),
    line = await S.line(ctx, orderId, itemId);
  return execute(
    "SUBMIT_ORDER",
    {
      clientRequestId,
      expectedVersion: order.data.version,
      items: [{ itemId, expectedVersion: line.data.version }],
    },
    { orderId },
  );
};
const rows = () => [...memory.rows.values()].map((row) => unmarshall(row));
beforeEach(async () => {
  memory = memoryDynamo();
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  fixture = await acceptanceFixture();
  ctx = { orgId: "org-resto", outletId: fixture.outlet.id, actorId: "owner" };
  memory.seedAccess("org-resto", "owner", "OWNER");
  sequence = 1000;
});
afterEach(() => {
  memory.db.restore();
  jest.restoreAllMocks();
});

test("table occupancy, history, distributed create replay and immutable result", async () => {
  const req = {
    clientRequestId: requestId(),
    tableId: fixture.tables[0].id,
    areaId: fixture.areas[0].id,
  };
  const result = await execute("OPEN_SESSION", req),
    session = contracts.GuestSessionSchema.parse(result.data),
    count = rows().length;
  expect(await execute("OPEN_SESSION", req)).toEqual(result);
  expect(rows()).toHaveLength(count);
  await expect(
    execute("OPEN_SESSION", { ...req, partySize: 2 }),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_IDEMPOTENCY_CONFLICT" });
  await expect(open()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TABLE_OCCUPIED",
  });
  expect((await S.activeTable(ctx, fixture.tables[0].id)).data).toEqual(
    session,
  );
  expect(
    (await Q.run(ctx, "ACTIVE_SESSIONS", { limit: 50 })).items,
  ).toHaveLength(1);
  expect(
    (
      await Q.run(ctx, "SESSION_HISTORY", {
        start: "2026-01-01T00:00:00.000Z",
        end: "2026-01-02T00:00:00.000Z",
      })
    ).items,
  ).toHaveLength(0);
  const closeReq = {
    clientRequestId: requestId(),
    expectedVersion: session.version,
  };
  const closed = await execute("CLOSE_SESSION", closeReq, {
    sessionId: session.guestSessionId,
  });
  expect(closed.data.status).toBe("CLOSED");
  expect((await S.activeTable(ctx, fixture.tables[0].id)).data).toBeNull();
  expect(
    await execute("CLOSE_SESSION", closeReq, {
      sessionId: session.guestSessionId,
    }),
  ).toEqual(closed);
  expect(await execute("OPEN_SESSION", req)).toEqual(result);
  const commands = rows().filter(
    (r) => r.entityType === "RESTAURANT_TRANSACTION_COMMAND",
  );
  expect(
    commands.filter((r) => r.data.commandKind === "OPEN_SESSION")[0],
  ).toMatchObject({ SK: "IDEM" });
  expect(
    commands.find((r) => r.data.commandKind === "OPEN_SESSION")?.PK,
  ).toMatch(/#CMD#OPEN_SESSION#NEW#[a-f0-9]{64}$/);
});
test("competing open requests commit exactly one complete visit", async () => {
  const before = rows().length;
  const results = await Promise.allSettled([open(), open()]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    rows().filter((r) => r.entityType === "RESTAURANT_GUEST_SESSION"),
  ).toHaveLength(1);
  expect(
    rows().filter((r) => r.entityType === "RESTAURANT_TABLE_OCCUPANCY"),
  ).toHaveLength(1);
  expect(rows().length - before).toBe(8);
});
test("different tables can open independently, wrong area and inactive table fail", async () => {
  await open();
  await execute("OPEN_SESSION", {
    clientRequestId: requestId(),
    tableId: fixture.tables[1].id,
    areaId: fixture.areas[1].id,
  });
  expect((await Q.run(ctx, "ACTIVE_SESSIONS", {})).items).toHaveLength(2);
  await expect(
    execute("OPEN_SESSION", {
      clientRequestId: requestId(),
      tableId: fixture.tables[2].id,
      areaId: fixture.areas[1].id,
    }),
  ).rejects.toMatchObject({ statusCode: 404 });
  await Config.update(
    ctx.orgId,
    "owner",
    "table",
    { outletId: ctx.outletId, serviceAreaId: fixture.areas[0].id },
    fixture.tables[2].id,
    { expectedVersion: 1 },
    "deactivate",
  );
  await expect(
    execute("OPEN_SESSION", {
      clientRequestId: requestId(),
      tableId: fixture.tables[2].id,
      areaId: fixture.areas[0].id,
    }),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_PARENT_INACTIVE" });
});
test("session orders increment links/counters once and prevent close", async () => {
  const session = contracts.GuestSessionSchema.parse((await open()).data);
  const order = contracts.RestaurantOrderSchema.parse(
    (await create(session.guestSessionId)).data,
  );
  expect((await S.session(ctx, session.guestSessionId)).data).toMatchObject({
    orderCount: 1,
    openOrderCount: 1,
  });
  expect(
    (
      await Q.run(
        ctx,
        "SESSION_ORDERS",
        {},
        { sessionId: session.guestSessionId },
      )
    ).items,
  ).toHaveLength(1);
  expect(
    (await Q.run(ctx, "TABLE_ORDERS", {}, { tableId: session.tableId })).items,
  ).toHaveLength(1);
  await expect(
    execute(
      "CLOSE_SESSION",
      { clientRequestId: requestId(), expectedVersion: 2 },
      { sessionId: session.guestSessionId },
    ),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_UNPAID_CLOSE" });
  await execute(
    "CANCEL_ORDER",
    { clientRequestId: requestId(), expectedVersion: 1, reason: "Test" },
    { orderId: order.orderId },
  );
  expect(
    (await S.session(ctx, session.guestSessionId)).data.openOrderCount,
  ).toBe(0);
  expect(
    (await Q.run(ctx, "TABLE_ORDERS", {}, { tableId: session.tableId })).items,
  ).toHaveLength(0);
});
test("CANCEL_ORDER concurrent terminal mutation and replay decrement only its own session order", async () => {
  const session = contracts.GuestSessionSchema.parse((await open()).data);
  const first = contracts.RestaurantOrderSchema.parse(
    (await create(session.guestSessionId)).data,
  );
  const other = contracts.RestaurantOrderSchema.parse(
    (await create(session.guestSessionId)).data,
  );
  const requests = [0, 1].map(() => ({
    clientRequestId: requestId(),
    expectedVersion: first.version,
    reason: "Abandoned",
  }));
  const results = await Promise.allSettled(
    requests.map((r) => execute("CANCEL_ORDER", r, { orderId: first.orderId })),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const winner = results.findIndex((r) => r.status === "fulfilled");
  const terminal = (await S.order(ctx, first.orderId)).data;
  expect(terminal).toMatchObject({ status: "CANCELLED", closedBy: "owner" });
  expect(terminal.closedAt).toBeTruthy();
  const before = rows();
  await execute("CANCEL_ORDER", requests[winner], { orderId: first.orderId });
  expect(rows()).toEqual(before);
  await expect(
    execute(
      "CANCEL_ORDER",
      { ...requests[winner], reason: "Different intent" },
      { orderId: first.orderId },
    ),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_IDEMPOTENCY_CONFLICT" });
  expect((await S.session(ctx, session.guestSessionId)).data).toMatchObject({
    status: "OPEN",
    openOrderCount: 1,
  });
  expect((await S.order(ctx, other.orderId)).data).toEqual(other);
  expect(
    (await S.activeTable(ctx, fixture.tables[0].id)).data?.guestSessionId,
  ).toBe(session.guestSessionId);
  expect(
    (await Q.run(ctx, "TABLE_ORDERS", {}, { tableId: session.tableId })).items,
  ).toHaveLength(1);
});
test("CANCEL_ORDER races ADD_ITEM through the same authoritative Order version", async () => {
  const session = contracts.GuestSessionSchema.parse((await open()).data);
  const order = contracts.RestaurantOrderSchema.parse(
    (await create(session.guestSessionId)).data,
  );
  const item = fixture.items[4];
  const outcomes = await Promise.allSettled([
    execute(
      "CANCEL_ORDER",
      {
        clientRequestId: requestId(),
        expectedVersion: order.version,
        reason: "Abandoned",
      },
      { orderId: order.orderId },
    ),
    execute(
      "ADD_ITEM",
      {
        clientRequestId: requestId(),
        expectedVersion: order.version,
        menuItemId: item.id,
        categoryId: item.categoryId,
        expectedMenuItemVersion: item.version,
        quantity: 1,
      },
      { orderId: order.orderId },
    ),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const current = (await S.order(ctx, order.orderId)).data;
  expect(current.version).toBe(order.version + 1);
  expect(
    (await S.session(ctx, session.guestSessionId)).data.openOrderCount,
  ).toBe(current.status === "CANCELLED" ? 0 : 1);
  expect(current.dueMinor).toBe(0);
});
test("atomic first draft creates one canonical pair and replays its exact receipt without effects", async () => {
  const session = contracts.GuestSessionSchema.parse((await open()).data);
  const item = fixture.items[4];
  const request = {
    clientRequestId: requestId(),
    orderType: "DINE_IN",
    guestSessionId: session.guestSessionId,
    firstItem: {
      menuItemId: item.id,
      categoryId: item.categoryId,
      expectedMenuItemVersion: item.version,
      quantity: 2,
    },
  };
  const result = await execute("CREATE_ORDER", request);
  const order = contracts.RestaurantOrderSchema.parse(result.data);
  expect(order).toMatchObject({
    status: "DRAFT",
    version: 1,
    lineCount: 1,
    draftLineCount: 1,
    acceptedLineCount: 0,
    financialRevision: 0,
    dueMinor: 0,
  });
  expect(result.firstItem).toMatchObject({
    orderId: order.orderId,
    status: "DRAFT",
    quantity: 2,
    version: 1,
  });
  expect((await S.session(ctx, session.guestSessionId)).data).toMatchObject({
    openOrderCount: 1,
    orderCount: 1,
  });
  const before = rows();
  expect(await execute("CREATE_ORDER", request)).toEqual(result);
  expect(rows()).toEqual(before);
  await expect(
    execute("CREATE_ORDER", {
      ...request,
      firstItem: { ...request.firstItem, quantity: 3 },
    }),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_IDEMPOTENCY_CONFLICT" });
  expect(
    rows().some((r) =>
      /^RESTAURANT_(STOCK_MOVEMENT|INVENTORY_EFFECT|PREPARATION|PAYMENT|CASH_MOVEMENT|BILL)$/.test(
        r.entityType,
      ),
    ),
  ).toBe(false);
});
test("atomic invalid first draft leaves no Order, item, projection or counter behind; legacy create remains callable", async () => {
  const session = contracts.GuestSessionSchema.parse((await open()).data);
  const item = fixture.items[4];
  const before = rows();
  await expect(
    execute("CREATE_ORDER", {
      clientRequestId: requestId(),
      orderType: "DINE_IN",
      guestSessionId: session.guestSessionId,
      firstItem: {
        menuItemId: item.id,
        categoryId: item.categoryId,
        expectedMenuItemVersion: item.version + 1,
        quantity: 1,
      },
    }),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_CONFIGURATION_CHANGED" });
  expect(rows()).toEqual(before);
  expect(
    contracts.RestaurantOrderSchema.parse(
      (await create(session.guestSessionId)).data,
    ),
  ).toMatchObject({ status: "DRAFT", lineCount: 0 });
});
test("nonfinal draft removal stays open; final removal is atomic, auditable and inventory-free on replay", async () => {
  const session = contracts.GuestSessionSchema.parse((await open()).data);
  const order = contracts.RestaurantOrderSchema.parse(
    (await create(session.guestSessionId)).data,
  );
  const sibling = contracts.RestaurantOrderSchema.parse(
    (await create(session.guestSessionId)).data,
  );
  const first = contracts.RestaurantOrderItemSchema.parse(
    (await add(order.orderId, 4)).data,
  );
  const second = contracts.RestaurantOrderItemSchema.parse(
    (await add(order.orderId, 4)).data,
  );
  const remove = async (line: contracts.RestaurantOrderItem) => {
    const request = {
      clientRequestId: requestId(),
      expectedVersion: (await S.order(ctx, order.orderId)).data.version,
      expectedItemVersion: line.version,
      reason: "Removed draft",
    };
    return {
      request,
      result: await execute("CANCEL_ITEM", request, {
        orderId: order.orderId,
        itemId: line.itemId,
      }),
    };
  };
  await remove(first);
  expect((await S.order(ctx, order.orderId)).data.status).toBe("DRAFT");
  expect(
    (await S.session(ctx, session.guestSessionId)).data.openOrderCount,
  ).toBe(2);
  const resume = jest.spyOn(InventorySales, "resume");
  const commit = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    await commit(actions);
    throw new Error("Lost final removal acknowledgement");
  });
  const final = await remove(second);
  expect(final.result.order).toMatchObject({
    status: "CANCELLED",
    closedBy: "owner",
    dueMinor: 0,
    financialRevision: 0,
    lineCount: 2,
  });
  expect(final.result.order?.closedAt).toBeTruthy();
  expect(final.result.order?.resolutionKind).toBe("TECHNICAL_EMPTY_DRAFT");
  expect((await S.order(ctx, order.orderId)).data.resolutionKind).toBe(
    "TECHNICAL_EMPTY_DRAFT",
  );
  expect((await S.session(ctx, session.guestSessionId)).data).toMatchObject({
    status: "OPEN",
    openOrderCount: 1,
    orderCount: 2,
  });
  expect((await S.order(ctx, sibling.orderId)).data).toEqual(sibling);
  const before = rows();
  expect(
    await execute("CANCEL_ITEM", final.request, {
      orderId: order.orderId,
      itemId: second.itemId,
    }),
  ).toEqual(final.result);
  expect(rows()).toEqual(before);
  expect(resume).not.toHaveBeenCalled();
  expect(
    rows().filter(
      (r) =>
        r.entityType === "RESTAURANT_TRANSACTION_AUDIT" &&
        r.data.reason === "EMPTY_DRAFT",
    ).length,
  ).toBeGreaterThan(0);
  expect(
    (await S.activeTable(ctx, fixture.tables[0].id)).data?.guestSessionId,
  ).toBe(session.guestSessionId);
});
test("normal close recovers an orphan without Inventory and releases occupancy only on explicit session close", async () => {
  const session = contracts.GuestSessionSchema.parse((await open()).data);
  const order = contracts.RestaurantOrderSchema.parse(
    (await create(session.guestSessionId)).data,
  );
  const resume = jest.spyOn(InventorySales, "resume");
  const request = {
    clientRequestId: requestId(),
    expectedVersion: order.version,
  };
  const result = await execute("CLOSE_ORDER", request, {
    orderId: order.orderId,
  });
  expect(result.data).toMatchObject({ status: "CANCELLED", closedBy: "owner" });
  expect(
    (await Q.run(ctx, "TABLE_ORDERS", {}, { tableId: session.tableId })).items,
  ).toHaveLength(0);
  expect(
    (
      await Q.run(
        ctx,
        "SESSION_ORDERS",
        {},
        { sessionId: session.guestSessionId },
      )
    ).items,
  ).toHaveLength(1);
  const next = (await S.session(ctx, session.guestSessionId)).data;
  expect(next).toMatchObject({
    status: "OPEN",
    openOrderCount: 0,
    orderCount: 1,
  });
  expect(
    await execute("CLOSE_ORDER", request, { orderId: order.orderId }),
  ).toEqual(result);
  expect(resume).not.toHaveBeenCalled();
  expect((await S.activeTable(ctx, session.tableId)).data).not.toBeNull();
  await execute(
    "CLOSE_SESSION",
    { clientRequestId: requestId(), expectedVersion: next.version },
    { sessionId: session.guestSessionId },
  );
  expect((await S.activeTable(ctx, session.tableId)).data).toBeNull();
});
test.each(["add", "submit", "remove"])(
  "final removal racing %s commits one coherent outcome",
  async (kind) => {
    const session = contracts.GuestSessionSchema.parse((await open()).data);
    const order = contracts.RestaurantOrderSchema.parse(
      (await create(session.guestSessionId)).data,
    );
    const line = contracts.RestaurantOrderItemSchema.parse(
      (await add(order.orderId, 4)).data,
    );
    const current = (await S.order(ctx, order.orderId)).data;
    const removal = {
      clientRequestId: requestId(),
      expectedVersion: current.version,
      expectedItemVersion: line.version,
      reason: "Removed",
    };
    const item = fixture.items[4];
    const other =
      kind === "add"
        ? execute(
            "ADD_ITEM",
            {
              clientRequestId: requestId(),
              expectedVersion: current.version,
              menuItemId: item.id,
              categoryId: item.categoryId,
              expectedMenuItemVersion: item.version,
              quantity: 1,
            },
            { orderId: order.orderId },
          )
        : kind === "submit"
          ? submit(order.orderId, line.itemId)
          : execute(
              "CANCEL_ITEM",
              { ...removal, clientRequestId: requestId() },
              { orderId: order.orderId, itemId: line.itemId },
            );
    const outcomes = await Promise.allSettled([
      execute("CANCEL_ITEM", removal, {
        orderId: order.orderId,
        itemId: line.itemId,
      }),
      other,
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const terminal = (await S.order(ctx, order.orderId)).data;
    expect(
      (await S.session(ctx, session.guestSessionId)).data.openOrderCount,
    ).toBe(terminal.status === "CANCELLED" ? 0 : 1);
    if (terminal.status === "CANCELLED")
      expect(terminal.resolutionKind).toBe("TECHNICAL_EMPTY_DRAFT");
    if (terminal.status === "CANCELLED")
      expect(
        (await S.allLines(ctx, order.orderId)).every(
          (l) => l.status === "CANCELLED" && !l.snapshot,
        ),
      ).toBe(true);
  },
);
test("pure-draft header excludes accepted history, payment attempts, financial and work evidence", () => {
  const base = {
    status: "DRAFT",
    draftLineCount: 0,
    acceptedLineCount: 0,
    financialRevision: 0,
    dueMinor: 0,
    paidMinor: 0,
    reservedMinor: 0,
    pendingPaymentCount: 0,
  } as contracts.RestaurantOrder;
  expect(pureEmptyDraftHeader(base)).toBe(true);
  for (const field of [
    "draftLineCount",
    "acceptedLineCount",
    "financialRevision",
    "dueMinor",
    "paidMinor",
    "reservedMinor",
    "pendingPaymentCount",
    "outstandingWorkCount",
    "paymentAttemptCount",
    "succeededPaymentCount",
  ])
    expect(pureEmptyDraftHeader({ ...base, [field]: 1 })).toBe(false);
  expect(pureEmptyDraftHeader({ ...base, status: "SUBMITTED" })).toBe(false);
});
test("canonical resolution classification rides existing Order reads without changing physical pagination or legacy decoding", async () => {
  const session = contracts.GuestSessionSchema.parse((await open()).data);
  const technical = contracts.RestaurantOrderSchema.parse(
    (await create(session.guestSessionId)).data,
  );
  const free = await Config.create(
    ctx.orgId,
    "owner",
    "item",
    { outletId: ctx.outletId, categoryId: fixture.items[4].categoryId },
    {
      clientRequestId: requestId(),
      name: "Free business order",
      price: { amountMinor: 0, currency: "XOF" },
    },
  );
  const pair = await execute("CREATE_ORDER", {
    clientRequestId: requestId(),
    orderType: "DINE_IN",
    guestSessionId: session.guestSessionId,
    firstItem: {
      menuItemId: free.id,
      categoryId: free.categoryId,
      quantity: 1,
      expectedMenuItemVersion: free.version,
    },
  });
  const business = contracts.RestaurantOrderSchema.parse(pair.data);
  const legacy = contracts.RestaurantOrderSchema.parse(
    (await create(session.guestSessionId)).data,
  );
  expect(legacy.resolutionKind).toBeUndefined();
  expect(contracts.RestaurantOrderSchema.safeParse(legacy).success).toBe(true);
  expect(
    contracts.RestaurantOrderSchema.safeParse({
      ...legacy,
      resolutionKind: "GUESSED",
    }).success,
  ).toBe(false);
  const read = async () => {
    const values: contracts.RestaurantOrder[] = [],
      cursors: (string | undefined)[] = [],
      sizes: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await Q.run(
        ctx,
        "SESSION_ORDERS",
        { limit: 1, cursor },
        { sessionId: session.guestSessionId },
      );
      values.push(
        ...page.items.map((item) =>
          contracts.RestaurantOrderSchema.parse(item),
        ),
      );
      sizes.push(page.items.length);
      cursors.push(page.nextCursor);
      cursor = page.nextCursor;
    } while (cursor);
    return { values, cursors, sizes };
  };
  const before = await read();
  const close = {
    clientRequestId: requestId(),
    expectedVersion: technical.version,
  };
  const resolved = await execute("CLOSE_ORDER", close, {
    orderId: technical.orderId,
  });
  expect(resolved.data).toMatchObject({
    status: "CANCELLED",
    resolutionKind: "TECHNICAL_EMPTY_DRAFT",
  });
  expect(
    await execute("CLOSE_ORDER", close, { orderId: technical.orderId }),
  ).toEqual(resolved);
  await submit(business.orderId, pair.firstItem!.itemId);
  await execute(
    "CANCEL_ITEM",
    {
      clientRequestId: requestId(),
      expectedVersion: (await S.order(ctx, business.orderId)).data.version,
      expectedItemVersion: (
        await S.line(ctx, business.orderId, pair.firstItem!.itemId)
      ).data.version,
      reason: "Business item cancellation",
    },
    { orderId: business.orderId, itemId: pair.firstItem!.itemId },
  );
  expect(
    (await S.order(ctx, business.orderId)).data.resolutionKind,
  ).toBeUndefined();
  await execute(
    "CANCEL_ORDER",
    {
      clientRequestId: requestId(),
      expectedVersion: (await S.order(ctx, business.orderId)).data.version,
      reason: "Manager cancellation",
    },
    { orderId: business.orderId },
  );
  const get = jest.spyOn(S, "order");
  get.mockClear();
  const after = await read();
  expect(get).toHaveBeenCalledTimes(3); // Existing hydration, no classification lookup.
  expect(after.cursors).toEqual(before.cursors);
  expect(after.sizes).toEqual(before.sizes);
  expect(after.values.map((o) => o.orderId)).toEqual(
    before.values.map((o) => o.orderId),
  );
  expect(
    after.values.find((o) => o.orderId === technical.orderId)?.resolutionKind,
  ).toBe("TECHNICAL_EMPTY_DRAFT");
  expect(
    after.values.find((o) => o.orderId === business.orderId),
  ).toMatchObject({ status: "CANCELLED", resolutionKind: "BUSINESS" });
  expect(
    after.values.find((o) => o.orderId === legacy.orderId)?.resolutionKind,
  ).toBeUndefined();
  expect((await S.session(ctx, session.guestSessionId)).data).toMatchObject({
    orderCount: after.values.length,
    openOrderCount: 1,
  });
  expect(
    await Q.run(ctx, "GET_ORDER", {}, { orderId: technical.orderId }),
  ).toMatchObject({ data: { resolutionKind: "TECHNICAL_EMPTY_DRAFT" } });
});
test("legacy technical close racing manager cancel decrements once and preserves one audit outcome", async () => {
  const session = contracts.GuestSessionSchema.parse((await open()).data);
  const order = contracts.RestaurantOrderSchema.parse(
    (await create(session.guestSessionId)).data,
  );
  const outcomes = await Promise.allSettled([
    execute(
      "CLOSE_ORDER",
      { clientRequestId: requestId(), expectedVersion: 1 },
      { orderId: order.orderId },
    ),
    execute(
      "CANCEL_ORDER",
      {
        clientRequestId: requestId(),
        expectedVersion: 1,
        reason: "Manager cancel",
      },
      { orderId: order.orderId },
    ),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await S.session(ctx, session.guestSessionId)).data).toMatchObject({
    status: "OPEN",
    openOrderCount: 0,
    orderCount: 1,
  });
  expect((await S.order(ctx, order.orderId)).data.status).toBe("CANCELLED");
  expect(
    rows().filter(
      (r) =>
        r.entityType === "RESTAURANT_TRANSACTION_AUDIT" &&
        r.data.targetId === order.orderId &&
        r.data.toState === "CANCELLED",
    ),
  ).toHaveLength(1);
});
test.each([false, true])(
  "zero-value accepted business history never qualifies for technical cleanup (item cancelled=%s)",
  async (cancelled) => {
    const session = contracts.GuestSessionSchema.parse((await open()).data);
    const free = await Config.create(
      ctx.orgId,
      "owner",
      "item",
      { outletId: ctx.outletId, categoryId: fixture.items[4].categoryId },
      {
        clientRequestId: requestId(),
        name: "Free business item",
        price: { amountMinor: 0, currency: "XOF" },
      },
    );
    const order = contracts.RestaurantOrderSchema.parse(
      (await create(session.guestSessionId)).data,
    );
    const line = contracts.RestaurantOrderItemSchema.parse(
      (
        await execute(
          "ADD_ITEM",
          {
            clientRequestId: requestId(),
            expectedVersion: 1,
            menuItemId: free.id,
            categoryId: free.categoryId,
            expectedMenuItemVersion: free.version,
            quantity: 1,
          },
          { orderId: order.orderId },
        )
      ).data,
    );
    await submit(order.orderId, line.itemId);
    if (cancelled)
      await execute(
        "CANCEL_ITEM",
        {
          clientRequestId: requestId(),
          expectedVersion: (await S.order(ctx, order.orderId)).data.version,
          expectedItemVersion: (await S.line(ctx, order.orderId, line.itemId))
            .data.version,
          reason: "Business cancellation",
        },
        { orderId: order.orderId, itemId: line.itemId },
      );
    const businessVersion = (await S.order(ctx, order.orderId)).data.version;
    const extra = contracts.RestaurantOrderItemSchema.parse(
      (
        await execute(
          "ADD_ITEM",
          {
            clientRequestId: requestId(),
            expectedVersion: businessVersion,
            menuItemId: free.id,
            categoryId: free.categoryId,
            expectedMenuItemVersion: free.version,
            quantity: 1,
          },
          { orderId: order.orderId },
        )
      ).data,
    );
    await execute(
      "CANCEL_ITEM",
      {
        clientRequestId: requestId(),
        expectedVersion: businessVersion + 1,
        expectedItemVersion: extra.version,
        reason: "Removed last draft from business Order",
      },
      { orderId: order.orderId, itemId: extra.itemId },
    );
    const current = (await S.order(ctx, order.orderId)).data;
    expect(current).toMatchObject({
      status: "SUBMITTED",
      acceptedLineCount: 1,
      dueMinor: 0,
    });
    expect(
      await qualifyPureEmptyDraft(
        ctx,
        current,
        await S.allLines(ctx, order.orderId),
      ),
    ).toBe(false);
    const closed = await execute(
      "CLOSE_ORDER",
      { clientRequestId: requestId(), expectedVersion: current.version },
      { orderId: order.orderId },
    );
    expect(closed.data).toMatchObject({
      status: "CLOSED",
      acceptedLineCount: 1,
    });
  },
);
test("legacy qualification fails closed for missing lines and canonical submission/preparation evidence", async () => {
  const session = contracts.GuestSessionSchema.parse((await open()).data);
  const order = contracts.RestaurantOrderSchema.parse(
    (await create(session.guestSessionId)).data,
  );
  expect(await qualifyPureEmptyDraft(ctx, { ...order, lineCount: 1 }, [])).toBe(
    false,
  );
  const submissions = jest
    .spyOn(R, "submissions")
    .mockResolvedValueOnce([{} as never]);
  expect(await qualifyPureEmptyDraft(ctx, order, [])).toBe(false);
  submissions.mockRestore();
  const query = jest.spyOn(R, "query");
  query.mockImplementationOnce(async () => ({ rows: [{} as never] }));
  expect(await qualifyPureEmptyDraft(ctx, order, [])).toBe(false);
});
test("atomic first draft transaction failure has no partial writes and safely retries the same intent", async () => {
  const session = contracts.GuestSessionSchema.parse((await open()).data);
  const item = fixture.items[4];
  const request = {
    clientRequestId: requestId(),
    orderType: "DINE_IN",
    guestSessionId: session.guestSessionId,
    firstItem: {
      menuItemId: item.id,
      categoryId: item.categoryId,
      expectedMenuItemVersion: item.version,
      quantity: 1,
    },
  };
  const before = rows();
  jest
    .spyOn(R, "commit")
    .mockRejectedValueOnce(new Error("Transaction unavailable"));
  await expect(execute("CREATE_ORDER", request)).rejects.toThrow(
    "Transaction unavailable",
  );
  expect(rows()).toEqual(before);
  expect((await execute("CREATE_ORDER", request)).firstItem).toMatchObject({
    status: "DRAFT",
  });
  expect(
    (await S.session(ctx, session.guestSessionId)).data.openOrderCount,
  ).toBe(1);
});
test("lost acknowledgement of atomic creation replays the committed pair without another Order", async () => {
  const session = contracts.GuestSessionSchema.parse((await open()).data);
  const item = fixture.items[4];
  const request = {
    clientRequestId: requestId(),
    orderType: "DINE_IN",
    guestSessionId: session.guestSessionId,
    firstItem: {
      menuItemId: item.id,
      categoryId: item.categoryId,
      expectedMenuItemVersion: item.version,
      quantity: 1,
    },
  };
  const commit = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    await commit(actions);
    throw new Error("Lost acknowledgement");
  });
  // The existing domain re-reads its receipt after a lost commit acknowledgement.
  const recovered = await execute("CREATE_ORDER", request);
  expect(recovered.firstItem).toMatchObject({ status: "DRAFT" });
  const before = rows();
  const replay = await execute("CREATE_ORDER", request);
  expect(replay).toEqual(recovered);
  const order = contracts.RestaurantOrderSchema.parse(replay.data);
  expect(replay.firstItem).toMatchObject({
    orderId: order.orderId,
    status: "DRAFT",
  });
  expect(rows()).toEqual(before);
  expect((await S.session(ctx, session.guestSessionId)).data).toMatchObject({
    orderCount: 1,
    openOrderCount: 1,
  });
});
test("standalone modes never create session or table state", async () => {
  for (const orderType of ["COUNTER", "TAKEAWAY"])
    await execute("CREATE_ORDER", { clientRequestId: requestId(), orderType });
  expect(
    rows().filter((r) => r.entityType === "RESTAURANT_GUEST_SESSION"),
  ).toHaveLength(0);
  expect((await Q.run(ctx, "ACTIVE_ORDERS", {})).items).toHaveLength(2);
  await expect(
    execute("CREATE_ORDER", {
      clientRequestId: requestId(),
      orderType: "DINE_IN",
    }),
  ).rejects.toBeInstanceOf(Error);
});
test("closed sessions reject new orders and a freed table starts a new visit", async () => {
  const session = contracts.GuestSessionSchema.parse((await open()).data);
  await execute(
    "CLOSE_SESSION",
    { clientRequestId: requestId(), expectedVersion: session.version },
    { sessionId: session.guestSessionId },
  );
  const before = memory.transactions.length;
  await expect(create(session.guestSessionId)).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_STATE",
  });
  expect(memory.transactions).toHaveLength(before);
  const next = contracts.GuestSessionSchema.parse((await open()).data);
  expect(next.guestSessionId).not.toBe(session.guestSessionId);
  expect((await S.session(ctx, session.guestSessionId)).data.status).toBe(
    "CLOSED",
  );
});
test("submission rejects currency mismatch without committing sale or replay", async () => {
  const order = contracts.RestaurantOrderSchema.parse((await create()).data);
  const line = contracts.RestaurantOrderItemSchema.parse(
    (await add(order.orderId)).data,
  );
  const row = await S.order(ctx, order.orderId);
  memory.rows.set(
    JSON.stringify([row.PK, row.SK]),
    marshall({ ...row, data: { ...row.data, currency: "USD" } }),
  );
  const before = rows().length;
  await expect(submit(order.orderId, line.itemId)).rejects.toMatchObject({
    messageCode: "RESTAURANTS_CURRENCY_MISMATCH",
  });
  expect(rows()).toHaveLength(before);
  expect((await S.line(ctx, order.orderId, line.itemId)).data.status).toBe(
    "DRAFT",
  );
  expect((await S.order(ctx, order.orderId)).data.dueMinor).toBe(0);
});
test("draft edits, accepted snapshot, repeated rounds and retained cancellation", async () => {
  const session = contracts.GuestSessionSchema.parse((await open()).data),
    order = contracts.RestaurantOrderSchema.parse(
      (await create(session.guestSessionId)).data,
    );
  const line = contracts.RestaurantOrderItemSchema.parse(
    (await add(order.orderId, 0, 2)).data,
  );
  expect((await S.order(ctx, order.orderId)).data.dueMinor).toBe(0);
  const request = {
    clientRequestId: requestId(),
    expectedVersion: 2,
    items: [{ itemId: line.itemId, expectedVersion: 1 }],
  };
  const result = await execute("SUBMIT_ORDER", request, {
    orderId: order.orderId,
  });
  expect(
    await execute("SUBMIT_ORDER", request, { orderId: order.orderId }),
  ).toEqual(result);
  await expect(
    execute(
      "SUBMIT_ORDER",
      { ...request, expectedVersion: 3 },
      { orderId: order.orderId },
    ),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_IDEMPOTENCY_CONFLICT" });
  expect((await S.order(ctx, order.orderId)).data).toMatchObject({
    dueMinor: 10000,
    acceptedLineCount: 1,
    draftLineCount: 0,
  });
  expect((await S.session(ctx, session.guestSessionId)).data.dueMinor).toBe(
    10000,
  );
  const accepted = (await S.line(ctx, order.orderId, line.itemId)).data;
  await Config.update(
    ctx.orgId,
    "owner",
    "item",
    { outletId: ctx.outletId, categoryId: fixture.categories[0].id },
    fixture.items[0].id,
    { expectedVersion: 1, price: { amountMinor: 9000, currency: "XOF" } },
  );
  expect(
    (await S.line(ctx, order.orderId, line.itemId)).data.snapshot
      ?.unitPriceMinor,
  ).toBe(5000);
  await expect(
    execute(
      "EDIT_ITEM",
      {
        clientRequestId: requestId(),
        expectedVersion: 3,
        expectedItemVersion: 2,
        menuItemId: fixture.items[0].id,
        categoryId: fixture.categories[0].id,
        quantity: 1,
        expectedMenuItemVersion: 2,
      },
      { orderId: order.orderId, itemId: line.itemId },
    ),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_WRITE_CONFLICT" });
  const second = contracts.RestaurantOrderItemSchema.parse(
    (await add(order.orderId, 1)).data,
  );
  await submit(order.orderId, second.itemId);
  expect((await S.order(ctx, order.orderId)).data.dueMinor).toBe(11500);
  await expect(
    execute(
      "CLOSE_ORDER",
      { clientRequestId: requestId(), expectedVersion: 5 },
      { orderId: order.orderId },
    ),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_UNPAID_CLOSE" });
  for (const itemId of [line.itemId, second.itemId]) {
    const current = await S.order(ctx, order.orderId),
      item = await S.line(ctx, order.orderId, itemId);
    const req = {
      clientRequestId: requestId(),
      expectedVersion: current.data.version,
      expectedItemVersion: item.data.version,
      reason: "Dev test cancellation",
    };
    const cancelled = await execute("CANCEL_ITEM", req, {
      orderId: order.orderId,
      itemId,
    });
    expect(
      await execute("CANCEL_ITEM", req, { orderId: order.orderId, itemId }),
    ).toEqual(cancelled);
  }
  expect((await Q.run(ctx, "UNPAID_ORDERS", {})).items).toHaveLength(0);
  expect((await S.session(ctx, session.guestSessionId)).data.dueMinor).toBe(0);
  expect((await S.line(ctx, order.orderId, line.itemId)).data.snapshot).toEqual(
    accepted.snapshot,
  );
});
test("failed config-race submission is entirely atomic", async () => {
  const order = contracts.RestaurantOrderSchema.parse((await create()).data),
    line = contracts.RestaurantOrderItemSchema.parse(
      (await add(order.orderId)).data,
    );
  const commit = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    await Config.update(
      ctx.orgId,
      "owner",
      "item",
      { outletId: ctx.outletId, categoryId: fixture.categories[0].id },
      fixture.items[0].id,
      { expectedVersion: 1, name: "Changed" },
    );
    return commit(actions);
  });
  await expect(submit(order.orderId, line.itemId)).rejects.toMatchObject({
    messageCode: "RESTAURANTS_CONFIGURATION_CHANGED",
  });
  expect((await S.line(ctx, order.orderId, line.itemId)).data.status).toBe(
    "DRAFT",
  );
  expect((await S.order(ctx, order.orderId)).data.dueMinor).toBe(0);
  expect(
    rows().filter((r) => r.entityType === "RESTAURANT_SUBMISSION"),
  ).toHaveLength(0);
  expect((await Q.run(ctx, "UNPAID_ORDERS", {})).items).toHaveLength(0);
});
test("overflow is rejected with no submission effect", async () => {
  const order = contracts.RestaurantOrderSchema.parse((await create()).data),
    line = contracts.RestaurantOrderItemSchema.parse(
      (await add(order.orderId, 0, Number.MAX_SAFE_INTEGER)).data,
    );
  await expect(submit(order.orderId, line.itemId)).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_MONEY",
  });
  expect((await S.order(ctx, order.orderId)).data.dueMinor).toBe(0);
});
test("cross-org/outlet and foreign cursors fail closed", async () => {
  const order = contracts.RestaurantOrderSchema.parse((await create()).data);
  await create();
  await expect(
    S.order({ ...ctx, orgId: "foreign" }, order.orderId),
  ).rejects.toMatchObject({ statusCode: 404 });
  await expect(
    S.order({ ...ctx, outletId: fixtureId(9000) }, order.orderId),
  ).rejects.toMatchObject({ statusCode: 404 });
  const page = await Q.run(ctx, "ACTIVE_ORDERS", { limit: 1 });
  expect(page.nextCursor).toBeDefined();
  const position = JSON.parse(
    Buffer.from(page.nextCursor!, "base64url").toString("utf8"),
  );
  expect(position).toHaveProperty("id");
  expect(position).not.toHaveProperty("sk");
  await expect(
    Q.run(ctx, "ACTIVE_ORDERS", {
      limit: 1,
      cursor: Buffer.from(
        JSON.stringify({ ...position, sk: "META", PK: "ORG#foreign" }),
      ).toString("base64url"),
    }),
  ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
  const next = await Q.run(ctx, "ACTIVE_ORDERS", {
    limit: 1,
    cursor: page.nextCursor,
  });
  expect(next.items).toHaveLength(1);
  await expect(
    Q.run(ctx, "ACTIVE_SESSIONS", { limit: 1, cursor: page.nextCursor }),
  ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
  await expect(
    Q.run(ctx, "ACTIVE_ORDERS", { limit: 101 }),
  ).rejects.toBeInstanceOf(Error);
});
test("history cursors bind ranges and UTC bucket count is bounded", async () => {
  await create();
  await create();
  const start = new Date(Date.now() - 3600000).toISOString(),
    end = new Date(Date.now() + 3600000).toISOString();
  const page = await Q.run(ctx, "ORDER_HISTORY", { start, end, limit: 1 });
  expect(page.items).toHaveLength(1);
  expect(page.nextCursor).toBeDefined();
  expect(
    (
      await Q.run(ctx, "ORDER_HISTORY", {
        start,
        end,
        limit: 1,
        cursor: page.nextCursor,
      })
    ).items,
  ).toHaveLength(1);
  await expect(
    Q.run(ctx, "ORDER_HISTORY", {
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-03-01T00:00:00.000Z",
    }),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_HISTORY_WINDOW" });
  await expect(
    Q.run(ctx, "ORDER_HISTORY", {
      start,
      end: new Date(Date.now() + 7200000).toISOString(),
      limit: 1,
      cursor: page.nextCursor,
    }),
  ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
});
test.each(["OWNER", "MANAGER"])(
  "%s receives only explicit implemented transactional authority",
  (role) => {
    const permissions =
      DomainAuthorizationService.permissionsForRestaurantsRole(role);
    for (const p of RESTAURANTS_TRANSACTION_PERMISSIONS)
      expect(permissions).toContain(p);
  },
);
test.each(["WAITER", "CASHIER", "KITCHEN"])(
  "%s has no unscoped LR-TX-1 writes",
  async (role) => {
    expect(
      DomainAuthorizationService.permissionsForRestaurantsRole(role).filter(
        (p) =>
          RESTAURANTS_TRANSACTION_PERMISSIONS.includes(
            p as (typeof RESTAURANTS_TRANSACTION_PERMISSIONS)[number],
          ),
      ),
    ).toEqual([]);
    memory.seedAccess(ctx.orgId, "owner", role);
    const requests: Record<string, object> = {
      OPEN_SESSION: {
        clientRequestId: requestId(),
        tableId: fixture.tables[0].id,
        areaId: fixture.areas[0].id,
      },
      CREATE_ORDER: { clientRequestId: requestId(), orderType: "COUNTER" },
      CLOSE_SESSION: { clientRequestId: requestId(), expectedVersion: 1 },
      ADD_ITEM: {
        clientRequestId: requestId(),
        expectedVersion: 1,
        menuItemId: fixture.items[0].id,
        categoryId: fixture.categories[0].id,
        expectedMenuItemVersion: 1,
        quantity: 1,
      },
      EDIT_ITEM: {
        clientRequestId: requestId(),
        expectedVersion: 1,
        expectedItemVersion: 1,
        menuItemId: fixture.items[0].id,
        categoryId: fixture.categories[0].id,
        expectedMenuItemVersion: 1,
        quantity: 1,
      },
      SUBMIT_ORDER: {
        clientRequestId: requestId(),
        expectedVersion: 1,
        items: [{ itemId: fixtureId(9001), expectedVersion: 1 }],
      },
      CANCEL_ITEM: {
        clientRequestId: requestId(),
        expectedVersion: 1,
        expectedItemVersion: 1,
        reason: "Test",
      },
      CANCEL_ORDER: {
        clientRequestId: requestId(),
        expectedVersion: 1,
        reason: "Test",
      },
      CLOSE_ORDER: { clientRequestId: requestId(), expectedVersion: 1 },
      REPLACE_RESPONSIBLE_STAFF: {
        clientRequestId: requestId(),
        expectedVersion: 1,
        staffId: null,
      },
    };
    const before = rows().length;
    for (const route of RESTAURANT_TRANSACTION_ROUTES)
      if ("command" in route) {
        const response = await restaurantTransactionHandler(route.name)({
          headers: { "x-org-id": ctx.orgId, "accept-language": "en" },
          body: JSON.stringify(requests[route.command]),
          pathParameters: {
            outletId: ctx.outletId,
            ...Object.fromEntries(
              [...route.path.matchAll(/\{(\w+)\}/g)]
                .filter((m) => m[1] !== "outletId")
                .map((m) => [m[1], fixtureId(9001)]),
            ),
          },
          requestContext: { authorizer: { jwt: { claims: { sub: "owner" } } } },
        });
        expect(response.statusCode).toBe(403);
      }
    expect(rows()).toHaveLength(before);
  },
);
test("transaction guard rejects oversized/duplicate operations before AWS", async () => {
  const order = contracts.RestaurantOrderSchema.parse((await create()).data),
    row = await S.order(ctx, order.orderId),
    op = R.put(row, row);
  const before = memory.transactions.length;
  await expect(R.commit([op, op])).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_LIMIT",
  });
  await expect(
    R.commit(Array.from({ length: 91 }, () => op)),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_TRANSACTION_LIMIT" });
  expect(memory.transactions).toHaveLength(before);
  await expect(
    R.commit([
      {
        Put: {
          ...op.Put!,
          Item: { ...op.Put!.Item, oversized: { S: "x".repeat(400 * 1024) } },
        },
      },
    ]),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_TRANSACTION_LIMIT" });
  expect(memory.transactions).toHaveLength(before);
});
test("transaction and preparation rows have no GSI/TTL and use the dedicated business table", async () => {
  const order = contracts.RestaurantOrderSchema.parse((await create()).data),
    line = contracts.RestaurantOrderItemSchema.parse(
      (await add(order.orderId)).data,
    );
  await submit(order.orderId, line.itemId);
  const scope = K.restaurantTransactionScope(ctx.orgId, ctx.outletId);
  for (const row of rows().filter((r) => String(r.PK).startsWith(scope))) {
    expect(Object.keys(row).some((k) => k.startsWith("GSI"))).toBe(false);
    expect(row).not.toHaveProperty("ttl");
    expect(row.SK).not.toMatch(/^RESTAURANTS#/);
  }
  expect(
    memory.db
      .commandCalls(QueryCommand)
      .every(
        (c) =>
          !c.args[0].input.FilterExpression && c.args[0].input.ConsistentRead,
      ),
  ).toBe(true);
  for (const tx of memory.transactions)
    for (const op of tx.TransactItems ?? [])
      expect((op.Put ?? op.Delete ?? op.ConditionCheck)?.TableName).toBe(
        "liass-ohada-test-restaurants-table",
      );
});
test("worst-case twelve-line submission atomically includes preparation within 83 actions", async () => {
  const session = contracts.GuestSessionSchema.parse((await open()).data),
    order = contracts.RestaurantOrderSchema.parse(
      (await create(session.guestSessionId)).data,
    );
  const selected: { itemId: string; expectedVersion: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const category = await Config.create(
      ctx.orgId,
      "owner",
      "category",
      { outletId: ctx.outletId },
      { clientRequestId: requestId(), name: `Round category ${i}` },
    );
    const station = await Config.create(
      ctx.orgId,
      "owner",
      "station",
      { outletId: ctx.outletId },
      { clientRequestId: requestId(), name: `Station ${i}` },
    );
    const item = await Config.create(
      ctx.orgId,
      "owner",
      "item",
      { outletId: ctx.outletId, categoryId: category.id },
      {
        clientRequestId: requestId(),
        name: `Dish ${i}`,
        price: { amountMinor: 1, currency: "XOF" },
        preparationStationId: station.id,
      },
    );
    const current = await S.order(ctx, order.orderId);
    const line = contracts.RestaurantOrderItemSchema.parse(
      (
        await execute(
          "ADD_ITEM",
          {
            clientRequestId: requestId(),
            expectedVersion: current.data.version,
            menuItemId: item.id,
            categoryId: category.id,
            expectedMenuItemVersion: 1,
            quantity: 1,
            notes: "n".repeat(1000),
          },
          { orderId: order.orderId },
        )
      ).data,
    );
    selected.push({ itemId: line.itemId, expectedVersion: line.version });
  }
  await execute(
    "SUBMIT_ORDER",
    { clientRequestId: requestId(), expectedVersion: 13, items: selected },
    { orderId: order.orderId },
  );
  const tx = memory.transactions.at(-1)!;
  expect(tx.TransactItems).toHaveLength(83);
  expect(
    Buffer.byteLength(JSON.stringify(tx.TransactItems), "utf8"),
  ).toBeLessThan(3 * 1024 * 1024);
  expect(tx.TransactItems?.filter((a) => a.ConditionCheck)).toHaveLength(39);
  expect((await S.order(ctx, order.orderId)).data).toMatchObject({
    dueMinor: 12,
    acceptedLineCount: 12,
    draftLineCount: 0,
  });
});
test("line/session/submission caps reject before business writes", async () => {
  const order = contracts.RestaurantOrderSchema.parse((await create()).data),
    row = await S.order(ctx, order.orderId);
  const key = JSON.stringify([{ S: row.PK }.S, { S: row.SK }.S]);
  memory.rows.set(
    key,
    marshall({
      ...row,
      data: { ...row.data, lineCount: 200, draftLineCount: 200 },
    }),
  );
  await expect(add(order.orderId)).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_LIMIT",
  });
  await expect(
    execute(
      "SUBMIT_ORDER",
      {
        clientRequestId: requestId(),
        expectedVersion: 1,
        items: Array.from({ length: 13 }, (_, i) => ({
          itemId: fixtureId(8000 + i),
          expectedVersion: 1,
        })),
      },
      { orderId: order.orderId },
    ),
  ).rejects.toBeInstanceOf(Error);
  const session = contracts.GuestSessionSchema.parse((await open()).data),
    sr = await S.session(ctx, session.guestSessionId);
  memory.rows.set(
    JSON.stringify([sr.PK, sr.SK]),
    marshall({
      ...sr,
      data: { ...sr.data, orderCount: 50, openOrderCount: 50 },
    }),
  );
  await expect(create(session.guestSessionId)).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_STATE",
  });
});
test("complimentary no-station sale can close; routed work cannot fake completion", async () => {
  for (const itemIndex of [4, 0]) {
    const item = fixture.items[itemIndex];
    await Config.update(
      ctx.orgId,
      "owner",
      "item",
      { outletId: ctx.outletId, categoryId: item.categoryId },
      item.id,
      { expectedVersion: 1, price: { amountMinor: 0, currency: "XOF" } },
    );
    fixture.items[itemIndex] = {
      ...item,
      version: 2,
      price: { amountMinor: 0, currency: "XOF" },
    };
    const order = contracts.RestaurantOrderSchema.parse((await create()).data),
      line = contracts.RestaurantOrderItemSchema.parse(
        (await add(order.orderId, itemIndex)).data,
      );
    await submit(order.orderId, line.itemId);
    const closing = execute(
      "CLOSE_ORDER",
      { clientRequestId: requestId(), expectedVersion: 3 },
      { orderId: order.orderId },
    );
    if (itemIndex === 4) expect((await closing).data.status).toBe("CLOSED");
    else
      await expect(closing).rejects.toMatchObject({
        messageCode: "RESTAURANTS_UNPAID_CLOSE",
      });
  }
});
test("cancellation protects paid/reserved balance and stale occupancy ownership", async () => {
  const order = contracts.RestaurantOrderSchema.parse((await create()).data),
    line = contracts.RestaurantOrderItemSchema.parse(
      (await add(order.orderId)).data,
    );
  await submit(order.orderId, line.itemId);
  const row = await S.order(ctx, order.orderId);
  memory.rows.set(
    JSON.stringify([row.PK, row.SK]),
    marshall({ ...row, data: { ...row.data, reservedMinor: 1 } }),
  );
  const before = rows().length;
  await expect(
    execute(
      "CANCEL_ITEM",
      {
        clientRequestId: requestId(),
        expectedVersion: 3,
        expectedItemVersion: 2,
        reason: "Test",
      },
      { orderId: order.orderId, itemId: line.itemId },
    ),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_TRANSACTION_STATE" });
  expect(rows()).toHaveLength(before);
  const session = contracts.GuestSessionSchema.parse((await open()).data);
  const pointerKey = JSON.stringify([
    K.restaurantOccupancyPK(ctx.orgId, ctx.outletId, session.tableId),
    "ACTIVE",
  ]);
  const pointer = unmarshall(memory.rows.get(pointerKey)!);
  memory.rows.set(
    pointerKey,
    marshall({
      ...pointer,
      data: { ...pointer.data, guestSessionId: fixtureId(9999) },
    }),
  );
  await expect(
    execute(
      "CLOSE_SESSION",
      { clientRequestId: requestId(), expectedVersion: 1 },
      { sessionId: session.guestSessionId },
    ),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_TRANSACTION_INTEGRITY" });
  expect(memory.rows.has(pointerKey)).toBe(true);
});
test("complimentary submission still advances the session financial revision", async () => {
  const item = fixture.items[4];
  await Config.update(
    ctx.orgId,
    "owner",
    "item",
    { outletId: ctx.outletId, categoryId: item.categoryId },
    item.id,
    { expectedVersion: 1, price: { amountMinor: 0, currency: "XOF" } },
  );
  fixture.items[4] = {
    ...item,
    version: 2,
    price: { amountMinor: 0, currency: "XOF" },
  };
  const session = contracts.GuestSessionSchema.parse((await open()).data),
    order = contracts.RestaurantOrderSchema.parse(
      (await create(session.guestSessionId)).data,
    );
  const line = contracts.RestaurantOrderItemSchema.parse(
    (await add(order.orderId, 4)).data,
  );
  await submit(order.orderId, line.itemId);
  expect((await S.session(ctx, session.guestSessionId)).data).toMatchObject({
    version: 3,
    financialRevision: 1,
    dueMinor: 0,
  });
});
test("recent sessions sort descending and cursors bind direction", async () => {
  await open();
  await execute("OPEN_SESSION", {
    clientRequestId: requestId(),
    tableId: fixture.tables[1].id,
    areaId: fixture.areas[1].id,
  });
  const start = new Date(Date.now() - 7 * 86400000).toISOString(),
    end = new Date(Date.now() + 1000).toISOString();
  const page = await Q.run(ctx, "SESSION_HISTORY", {
    start,
    end,
    direction: "DESC",
    limit: 1,
  });
  const next = await Q.run(ctx, "SESSION_HISTORY", {
    start,
    end,
    direction: "DESC",
    limit: 1,
    cursor: page.nextCursor,
  });
  const first = contracts.GuestSessionSchema.parse(page.items[0]),
    second = contracts.GuestSessionSchema.parse(next.items[0]);
  expect(
    K.restaurantTransactionLocatorSK(first.openedAt, first.guestSessionId) >=
      K.restaurantTransactionLocatorSK(second.openedAt, second.guestSessionId),
  ).toBe(true);
  await expect(
    Q.run(ctx, "SESSION_HISTORY", {
      start,
      end,
      direction: "ASC",
      cursor: page.nextCursor,
    }),
  ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
});
test("canonical business rows cannot be hard-deleted through the repository", async () => {
  const order = contracts.RestaurantOrderSchema.parse((await create()).data);
  expect(() => R.remove(awaitRow(order))).toThrow();
  function awaitRow(data: contracts.RestaurantOrder) {
    return R.row(
      ctx,
      {
        PK: K.restaurantOrderPK(ctx.orgId, ctx.outletId, data.orderId),
        SK: "META",
      },
      "ORDER",
      data,
    );
  }
});
test("OWNER handler workflow validates public DTOs without physical keys", async () => {
  memory.seedAccess(ctx.orgId, "owner", "OWNER");
  const call = async (
    name: string,
    body: object = {},
    ids: Record<string, string> = {},
    query?: object,
  ) => {
    const response = await restaurantTransactionHandler(name)({
      headers: { "x-org-id": ctx.orgId, "accept-language": "en" },
      body: JSON.stringify(body),
      pathParameters: { outletId: ctx.outletId, ...ids },
      queryStringParameters: query,
      requestContext: { authorizer: { jwt: { claims: { sub: "owner" } } } },
    });
    expect(response.statusCode).toBe(200);
    const result = JSON.parse(response.body);
    expect(response.body).not.toMatch(/"(PK|SK|entityType|GSI1PK)"/);
    return result;
  };
  const opened = contracts.GuestSessionResponseSchema.parse(
    await call("open-session", {
      clientRequestId: requestId(),
      tableId: fixture.tables[0].id,
      areaId: fixture.areas[0].id,
    }),
  );
  await call("get-session", {}, { sessionId: opened.data.guestSessionId });
  await call("active-table-session", {}, { tableId: opened.data.tableId });
  const created = contracts.RestaurantOrderResponseSchema.parse(
    await call("create-order", {
      clientRequestId: requestId(),
      orderType: "DINE_IN",
      guestSessionId: opened.data.guestSessionId,
    }),
  );
  const added = contracts.RestaurantOrderItemResponseSchema.parse(
    await call(
      "add-draft-item",
      {
        clientRequestId: requestId(),
        expectedVersion: 1,
        menuItemId: fixture.items[0].id,
        categoryId: fixture.items[0].categoryId,
        expectedMenuItemVersion: 1,
        quantity: 1,
      },
      { orderId: created.data.orderId },
    ),
  );
  await call(
    "submit-order",
    {
      clientRequestId: requestId(),
      expectedVersion: 2,
      items: [{ itemId: added.data.itemId, expectedVersion: 1 }],
    },
    { orderId: created.data.orderId },
  );
  await call("unpaid-orders", {}, {}, { limit: "50" });
  await call(
    "cancel-order-item",
    {
      clientRequestId: requestId(),
      expectedVersion: 3,
      expectedItemVersion: 2,
      reason: "Dev test",
    },
    { orderId: created.data.orderId, itemId: added.data.itemId },
  );
  await call(
    "cancel-order",
    { clientRequestId: requestId(), expectedVersion: 4, reason: "Dev test" },
    { orderId: created.data.orderId },
  );
  const session = await S.session(ctx, opened.data.guestSessionId);
  await call(
    "close-session",
    { clientRequestId: requestId(), expectedVersion: session.data.version },
    { sessionId: opened.data.guestSessionId },
  );
});
