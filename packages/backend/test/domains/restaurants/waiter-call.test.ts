import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { WaiterCalls } from "../../../lambda/domains/restaurants/waiter-call";
import { dynamoClient } from "../../../lambda/shared/dynamo-client";
import { GuestService } from "../../../lambda/domains/restaurants/guest-service";
import { RestaurantServiceAccess } from "../../../lambda/domains/restaurants/service-access";
import { RestaurantsRepository } from "../../../lambda/domains/restaurants/restaurant-repository";
import { KeyFactory as K } from "../../../lambda/shared/key-builder";
import { GuestWaiterCallResponseSchema } from "@liass-ohada/shared/restaurants";
const scope = {
  orgId: "org-a",
  outletId: "11111111-1111-4111-8111-111111111111",
};
const table = {
  tableId: "22222222-2222-4222-8222-222222222222",
  areaId: "33333333-3333-4333-8333-333333333333",
  tableName: "Cour 3",
};
const sessionId = "44444444-4444-4444-8444-444444444444";
let rows: Map<string, Record<string, any>>;
let transitions: number;
const key = (r: Record<string, any>) => r.PK + "|" + r.SK;
const calls = () => [...rows.values()].filter((r) => r.SK === "META");
const conflict = () =>
  Object.assign(new Error("conflict"), {
    name: "TransactionCanceledException",
    CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
  });
beforeEach(() => {
  process.env.RESTAURANTS_TABLE_NAME = "restaurants-test";
  process.env.TABLE_NAME = "platform-test";
  jest.useFakeTimers().setSystemTime(new Date("2026-10-24T10:00:00.000Z"));
  rows = new Map();
  transitions = 0;
  jest.spyOn(dynamoClient, "send").mockImplementation((async (command: any) => {
    const input = command.input;
    if (command.constructor.name === "GetItemCommand") {
      expect(input.ConsistentRead).toBe(true);
      const row = rows.get(key(unmarshall(input.Key)));
      return {
        Item: row ? marshall(row, { removeUndefinedValues: true }) : undefined,
      };
    }
    if (command.constructor.name === "QueryCommand") {
      expect(input.Limit).toBe(100);
      expect(input.IndexName).toBeUndefined();
      const v = unmarshall(input.ExpressionAttributeValues);
      return {
        Items: [...rows.values()]
          .filter(
            (r) => r.PK === v[":pk"] && r.SK >= v[":lo"] && r.SK <= v[":hi"],
          )
          .sort((a, b) => a.SK.localeCompare(b.SK))
          .slice(0, 100)
          .map((r) => marshall(r, { removeUndefinedValues: true })),
      };
    }
    if (command.constructor.name === "TransactWriteItemsCommand") {
      // Validate every condition before applying any write, without yielding: atomic CAS.
      for (const action of input.TransactItems) {
        if (!action.Put) continue;
        const row = unmarshall(action.Put.Item),
          old = rows.get(key(row));
        const v =
          action.Put.ExpressionAttributeValues &&
          unmarshall(action.Put.ExpressionAttributeValues);
        if (
          v ? !old || old.version !== v[":v"] || old.callId !== v[":id"] : !!old
        )
          throw conflict();
      }
      for (const action of input.TransactItems) {
        if (action.Put) {
          const row = unmarshall(action.Put.Item);
          rows.set(key(row), row);
        }
        if (action.Delete) rows.delete(key(unmarshall(action.Delete.Key)));
      }
      transitions++;
      return {};
    }
    throw new Error("Unexpected command " + command.constructor.name);
  }) as any);
  jest
    .spyOn(RestaurantServiceAccess, "authorize")
    .mockResolvedValue({ role: "WAITER", actions: [] });
  jest
    .spyOn(RestaurantsRepository, "get")
    .mockResolvedValue({ data: { isActive: true } } as any);
  jest.spyOn(GuestService, "verify").mockResolvedValue({
    principal: { ...scope, ...table, rights: ["CALL_WAITER"] },
    context: { table: { name: table.tableName, code: "T3" } },
  } as any);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
it("FREE creates REQUESTED without any session or internal public fields", async () => {
  const response = await WaiterCalls.request("capability");
  expect(response.state).toBe("REQUESTED");
  expect(calls()).toHaveLength(1);
  expect(calls()[0].sessionId).toBeUndefined();
  expect(Object.keys(response).sort()).toEqual(["requestedAt", "state"]);
  expect(GuestWaiterCallResponseSchema.safeParse(response).success).toBe(true);
  expect(
    [...rows.values()].some((r) => r.entityType === "RESTAURANT_GUEST_SESSION"),
  ).toBe(false);
});
it("OCCUPIED binds only the canonical session", async () => {
  await WaiterCalls.create(scope, { ...table, sessionId });
  expect(calls()[0].sessionId).toBe(sessionId);
});
it("racing creates converge on one call and one activity entry", async () => {
  const results = await Promise.all([
    WaiterCalls.create(scope, table),
    WaiterCalls.create(scope, table),
    WaiterCalls.create(scope, table),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(results[1]).toEqual(results[2]);
  expect(calls()).toHaveLength(1);
  expect(transitions).toBe(1);
  expect(
    [...rows.values()].filter(
      (r) => r.PK === K.restaurantWaiterActivityPK(scope.orgId, scope.outletId),
    ),
  ).toHaveLength(1);
});
it("active until 10m, permits a new call at expiry without TTL deletion", async () => {
  await WaiterCalls.create(scope, table);
  const first = calls()[0].callId;
  jest.advanceTimersByTime(599999);
  await WaiterCalls.create(scope, table);
  expect(calls()).toHaveLength(1);
  jest.advanceTimersByTime(1);
  await WaiterCalls.create(scope, table);
  expect(calls()).toHaveLength(2);
  expect(calls()[1].callId).not.toBe(first);
});
it("racing acknowledgements produce one transition/audit and durable 60s cooldown", async () => {
  await WaiterCalls.create(scope, table);
  const id = calls()[0].callId;
  const [a, b] = await Promise.all([
    WaiterCalls.acknowledge(scope, "waiter", id),
    WaiterCalls.acknowledge(scope, "other", id),
  ]);
  expect(a).toEqual(b);
  expect(transitions).toBe(2);
  expect([...rows.values()].filter((r) => r.SK === "ACK_AUDIT")).toHaveLength(
    1,
  );
  expect(calls()[0].acknowledgedBy).toBe("waiter");
  expect(JSON.stringify(a)).not.toContain("acknowledgedBy");
  expect(await WaiterCalls.create(scope, table)).toEqual({
    state: "COOLDOWN",
    retryAfterSeconds: 60,
  });
  jest.advanceTimersByTime(59001);
  expect(await WaiterCalls.create(scope, table)).toEqual({
    state: "COOLDOWN",
    retryAfterSeconds: 1,
  });
  jest.advanceTimersByTime(999);
  expect((await WaiterCalls.create(scope, table)).state).toBe("REQUESTED");
});
it.each(["OWNER", "MANAGER", "WAITER"])(
  "allows %s read and acknowledgement",
  async (role) => {
    jest
      .mocked(RestaurantServiceAccess.authorize)
      .mockResolvedValue({ role, actions: [] });
    await WaiterCalls.create(scope, table);
    expect((await WaiterCalls.activity(scope, "actor")).items).toHaveLength(1);
    expect(
      (await WaiterCalls.acknowledge(scope, "actor", calls()[0].callId)).state,
    ).toBe("ACKNOWLEDGED");
  },
);
it.each(["CASHIER", "KITCHEN"])("denies %s", async (role) => {
  jest
    .mocked(RestaurantServiceAccess.authorize)
    .mockResolvedValue({ role, actions: [] });
  await expect(WaiterCalls.activity(scope, "actor")).rejects.toMatchObject({
    statusCode: 403,
  });
  await expect(
    WaiterCalls.acknowledge(scope, "actor", sessionId),
  ).rejects.toMatchObject({ statusCode: 403 });
});
it("excludes expired and acknowledged calls and sorts oldest first", async () => {
  await WaiterCalls.create(scope, table);
  jest.advanceTimersByTime(1000);
  await WaiterCalls.create(scope, { ...table, tableId: sessionId });
  const active = await WaiterCalls.activity(scope, "actor");
  expect(active.items).toHaveLength(2);
  expect(active.items[0].tableId).toBe(table.tableId);
  await WaiterCalls.acknowledge(scope, "actor", calls()[0].callId);
  expect((await WaiterCalls.activity(scope, "actor")).items).toHaveLength(1);
  jest.advanceTimersByTime(600000);
  expect((await WaiterCalls.activity(scope, "actor")).items).toHaveLength(0);
});
it("cross-org and cross-outlet calls cannot be acknowledged", async () => {
  await WaiterCalls.create(scope, table);
  const id = calls()[0].callId;
  await expect(
    WaiterCalls.acknowledge({ ...scope, orgId: "other" }, "actor", id),
  ).rejects.toMatchObject({ statusCode: 404 });
  await expect(
    WaiterCalls.acknowledge({ ...scope, outletId: sessionId }, "actor", id),
  ).rejects.toMatchObject({ statusCode: 404 });
});
it.each(["UNAVAILABLE", "EXPIRED", "VISIT_ENDED"] as const)(
  "canonical denial %s precedes every write",
  async (state) => {
    jest.mocked(GuestService.verify).mockResolvedValue({ state });
    expect(await WaiterCalls.request("bad")).toEqual({ state });
    expect(transitions).toBe(0);
  },
);

it("an active physical-table call never migrates to a subsequent session", async () => {
  await WaiterCalls.create(scope, { ...table, sessionId });
  const original = calls()[0].callId;
  await WaiterCalls.create(scope, {
    ...table,
    sessionId: "55555555-5555-4555-8555-555555555555",
  });
  expect(calls()).toHaveLength(1);
  expect(calls()[0].callId).toBe(original);
  expect(calls()[0].sessionId).toBe(sessionId);
});
it("never advances cooldown on duplicate acknowledgement", async () => {
  await WaiterCalls.create(scope, table);
  const id = calls()[0].callId;
  const first = await WaiterCalls.acknowledge(scope, "actor", id);
  const until = calls()[0].cooldownUntil;
  jest.advanceTimersByTime(30000);
  expect(await WaiterCalls.acknowledge(scope, "actor", id)).toEqual(first);
  expect(calls()[0].cooldownUntil).toBe(until);
});
it("rejects cross-outlet pagination cursors and bounds every activity query", async () => {
  const cursor = Buffer.from(
    JSON.stringify({
      PK: K.restaurantWaiterActivityPK("other", scope.outletId),
      SK: "x",
    }),
  ).toString("base64url");
  await expect(
    WaiterCalls.activity(scope, "actor", cursor),
  ).rejects.toMatchObject({ statusCode: 404 });
  await expect(
    WaiterCalls.activity(scope, "actor", "invalid"),
  ).rejects.toMatchObject({ statusCode: 404 });
});
