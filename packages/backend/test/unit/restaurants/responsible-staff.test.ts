import {
  BatchGetItemCommand,
  BatchGetItemCommandInput,
  GetItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { RestaurantTransactionsService as S } from "@/lambda/domains/restaurants/transaction-service";
import { RestaurantTransactionQueries as Q } from "@/lambda/domains/restaurants/transaction-queries";
import { RestaurantTransactionsRepository as R } from "@/lambda/domains/restaurants/transaction-repository";
import { RestaurantStaffService as Staff } from "@/lambda/domains/restaurants/staff-service";
import { RestaurantStaffRepository as SR } from "@/lambda/domains/restaurants/staff-repository";
import { restaurantTransactionHandler } from "@/lambda/domains/restaurants/transaction-handler";
import { ResponsibleStaff } from "@/lambda/domains/restaurants/responsible-staff";
import { acceptanceFixture } from "./acceptance-fixture";
import { memoryDynamo, fixtureId } from "./memory-dynamo";

let m: ReturnType<typeof memoryDynamo>,
  f: Awaited<ReturnType<typeof acceptanceFixture>>,
  seq: number;
let ctx: { orgId: string; outletId: string; actorId: string };
const req = () => fixtureId(++seq);
const put = (item: Record<string, unknown>) =>
  m.rows.set(
    JSON.stringify([item.PK, item.SK]),
    marshall(item, { removeUndefinedValues: true }),
  );
const patch = (
  key: { PK: string; SK: string },
  values: Record<string, unknown>,
) => {
  const row = unmarshall(m.rows.get(JSON.stringify([key.PK, key.SK]))!);
  put({ ...row, ...values });
};
async function person(userId: string, role = "WAITER", assigned = true) {
  m.seedAccess(ctx.orgId, userId, role);
  put({
    PK: K.userProfilePK(userId),
    SK: K.userProfileSK(),
    entityType: "USER_PROFILE",
    userId,
    email: "hidden@example.com",
    normalizedEmail: "hidden@example.com",
    emailVerified: true,
    displayName: `${userId} S.`,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    lastSyncedFromIdentityAt: "2026-10-15T00:00:00.000Z",
  });
  await Staff.mutate(ctx.orgId, "owner", userId, "BIND", {
    clientRequestId: req(),
    memberUserId: userId,
  });
  if (assigned)
    await Staff.mutate(
      ctx.orgId,
      "owner",
      userId,
      "ASSIGN",
      { clientRequestId: req() },
      ctx.outletId,
    );
}
const open = async (index = 0) =>
  c.GuestSessionSchema.parse(
    (
      await S.mutate(ctx, "OPEN_SESSION", {
        clientRequestId: req(),
        tableId: f.tables[index].id,
        areaId: f.tables[index].serviceAreaId,
      })
    ).data,
  );
const replace = (
  session: c.GuestSession,
  staffId: string | null,
  clientRequestId = req(),
) =>
  S.mutate(
    ctx,
    "REPLACE_RESPONSIBLE_STAFF",
    { clientRequestId, expectedVersion: session.version, staffId },
    { sessionId: session.guestSessionId },
  );
const read = async (session: c.GuestSession) =>
  c.GuestSessionResponseSchema.parse(
    await Q.run(ctx, "GET_SESSION", {}, { sessionId: session.guestSessionId }),
  ).data;
const floor = async () =>
  c.RestaurantServiceFloorResponseSchema.parse(
    await Q.run(ctx, "SERVICE_FLOOR", { limit: 100 }),
  );
const call = (
  session: c.GuestSession,
  actor = "owner",
  body: object = {},
  tenant = ctx.orgId,
  outletId = ctx.outletId,
) =>
  restaurantTransactionHandler("replace-responsible-staff")({
    headers: { "x-org-id": tenant, "accept-language": "en" },
    body: JSON.stringify({
      clientRequestId: req(),
      expectedVersion: session.version,
      staffId: "Aissa",
      ...body,
    }),
    pathParameters: { outletId, sessionId: session.guestSessionId },
    requestContext: { authorizer: { jwt: { claims: { sub: actor } } } },
  });
beforeEach(async () => {
  m = memoryDynamo();
  seq = 5000;
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  f = await acceptanceFixture();
  ctx = { orgId: "org-resto", outletId: f.outlet.id, actorId: "owner" };
  m.seedAccess(ctx.orgId, "owner", "OWNER");
  m.seedAccess(ctx.orgId, "manager", "MANAGER");
  await person("Aissa");
  await person("Binta");
});
afterEach(() => {
  m.db.restore();
  jest.restoreAllMocks();
});

test("assigns an active waiter, exposes current safe name on session/floor, and preserves openedBy", async () => {
  const session = await open();
  expect(session.responsibleStaffId).toBeUndefined();
  expect((await read(session)).responsibleStaff).toBeUndefined();
  const response = await call(session);
  expect(response.statusCode).toBe(200);
  const assigned = c.GuestSessionResponseSchema.parse(
    JSON.parse(response.body),
  ).data;
  expect(assigned.responsibleStaff).toEqual({
    staffId: "Aissa",
    displayName: "Aissa S.",
    available: true,
  });
  expect(assigned.openedBy).toBe("owner");
  expect(assigned.version).toBe(2);
  expect(JSON.stringify(assigned)).not.toMatch(
    /responsibleStaffId|provider|cognito|hidden@example|PK|SK/,
  );
  const occupied = (await floor()).items.find((t) => t.state === "OCCUPIED");
  expect(occupied).toMatchObject({
    responsibleStaff: assigned.responsibleStaff,
    openedBy: "owner",
  });
  for (const table of (await floor()).items.filter((t) => t.state === "FREE"))
    expect("responsibleStaff" in table).toBe(false);
});
test("reassigns atomically, audits before/after and clear retains the open session", async () => {
  const initial = await open();
  const a = c.GuestSessionSchema.parse((await replace(initial, "Aissa")).data);
  const b = c.GuestSessionSchema.parse((await replace(a, "Binta")).data);
  expect(b.responsibleStaffId).toBe("Binta");
  const audit = [...m.rows.values()]
    .map((raw) => unmarshall(raw))
    .find(
      (row) =>
        row.entityType === "RESTAURANT_TRANSACTION_AUDIT" &&
        row.data.version === 3 &&
        row.data.targetId === b.guestSessionId,
    );
  expect(audit?.data).toMatchObject({
    actorId: "owner",
    action: "REPLACE_RESPONSIBLE_STAFF",
    responsibility: {
      before: "Aissa",
      after: "Binta",
      beforeDisplayName: "Aissa S.",
      afterDisplayName: "Binta S.",
      tableId: initial.tableId,
    },
  });
  const cleared = c.GuestSessionSchema.parse((await replace(b, null)).data);
  expect(cleared.status).toBe("OPEN");
  expect(cleared.version).toBe(4);
  expect(cleared.responsibleStaffId).toBeUndefined();
  expect((await read(cleared)).responsibleStaff).toBeUndefined();
  const sessionRows = [...m.rows.values()]
    .map((raw) => unmarshall(raw))
    .filter((row) => row.entityType === "RESTAURANT_GUEST_SESSION");
  expect(sessionRows).toHaveLength(1);
  expect(sessionRows[0].data).not.toHaveProperty("responsibleStaff");
});
test.each(["OWNER", "MANAGER"])(
  "%s may serve with explicit active staff/outlet binding; administration needs no retroactive binding",
  async (role) => {
    const subject = role === "OWNER" ? "owner" : "manager";
    const session = await open();
    expect((await call(session, subject)).statusCode).toBe(200);
    const current = (await S.session(ctx, session.guestSessionId)).data;
    await expect(replace(current, subject)).rejects.toMatchObject({
      messageCode: "RESTAURANTS_RESPONSIBLE_STAFF_INELIGIBLE",
    });
    await person(subject, role);
    const next = c.GuestSessionSchema.parse(
      (await replace(current, subject)).data,
    );
    expect(next.responsibleStaffId).toBe(subject);
  },
);
test.each(["CASHIER", "KITCHEN"])(
  "rejects ineligible %s even with active outlet assignment",
  async (role) => {
    await person("other", role);
    await expect(replace(await open(), "other")).rejects.toMatchObject({
      messageCode: "RESTAURANTS_RESPONSIBLE_STAFF_INELIGIBLE",
    });
  },
);
test.each(["inactive", "unassigned", "membership", "role", "foreign"])(
  "rejects new responsibility when %s",
  async (change) => {
    const session = await open();
    if (change === "inactive")
      await Staff.mutate(ctx.orgId, "owner", "Aissa", "UPDATE", {
        clientRequestId: req(),
        expectedVersion: 1,
        status: "INACTIVE",
      });
    if (change === "unassigned")
      await Staff.mutate(
        ctx.orgId,
        "owner",
        "Aissa",
        "UNASSIGN",
        { clientRequestId: req(), expectedVersion: 1 },
        ctx.outletId,
      );
    if (change === "membership")
      patch(
        { PK: K.orgKey(ctx.orgId), SK: K.orgUserAccessSK("Aissa") },
        { status: "INACTIVE" },
      );
    if (change === "role")
      patch(
        { PK: K.orgKey(ctx.orgId), SK: K.orgUserAccessSK("Aissa") },
        { productRoles: {} },
      );
    if (change === "foreign") {
      m.rows.delete(
        JSON.stringify([K.orgKey(ctx.orgId), K.restaurantStaffSK("Aissa")]),
      );
      m.seedAccess("foreign", "Aissa", "WAITER");
    }
    await expect(replace(session, "Aissa")).rejects.toMatchObject({
      messageCode: "RESTAURANTS_RESPONSIBLE_STAFF_INELIGIBLE",
    });
  },
);
test.each(["inactive", "unassigned", "membership", "role"])(
  "retains association but marks %s staff unavailable without corrupting reads",
  async (change) => {
    const session = c.GuestSessionSchema.parse(
      (await replace(await open(), "Aissa")).data,
    );
    if (change === "inactive")
      await Staff.mutate(ctx.orgId, "owner", "Aissa", "UPDATE", {
        clientRequestId: req(),
        expectedVersion: 1,
        status: "INACTIVE",
      });
    if (change === "unassigned")
      await Staff.mutate(
        ctx.orgId,
        "owner",
        "Aissa",
        "UNASSIGN",
        { clientRequestId: req(), expectedVersion: 1 },
        ctx.outletId,
      );
    if (change === "membership")
      patch(
        { PK: K.orgKey(ctx.orgId), SK: K.orgUserAccessSK("Aissa") },
        { status: "INACTIVE" },
      );
    if (change === "role")
      patch(
        { PK: K.orgKey(ctx.orgId), SK: K.orgUserAccessSK("Aissa") },
        { productRoles: {} },
      );
    expect((await read(session)).responsibleStaff).toMatchObject({
      staffId: "Aissa",
      available: false,
    });
    expect(
      (await floor()).items.find((t) => t.state === "OCCUPIED"),
    ).toMatchObject({
      responsibleStaff: { staffId: "Aissa", available: false },
    });
    expect(
      (await S.session(ctx, session.guestSessionId)).data.responsibleStaffId,
    ).toBe("Aissa");
    await expect(replace(session, "Aissa")).rejects.toMatchObject({
      messageCode: "RESTAURANTS_RESPONSIBLE_STAFF_INELIGIBLE",
    });
  },
);
test("uses current safe profile name while retaining historical audit labels", async () => {
  const s = c.GuestSessionSchema.parse(
    (await replace(await open(), "Aissa")).data,
  );
  patch(
    { PK: K.userProfilePK("Aissa"), SK: K.userProfileSK() },
    { displayName: "Aïssatou N." },
  );
  expect((await read(s)).responsibleStaff?.displayName).toBe("Aïssatou N.");
  patch(
    { PK: K.userProfilePK("Aissa"), SK: K.userProfileSK() },
    { displayName: "hidden@example.com" },
  );
  expect((await read(s)).responsibleStaff?.displayName).toBeNull();
});
test("rejects stale writes and closed/foreign/wrong-outlet sessions; closed tables become free", async () => {
  const initial = await open();
  const changed = c.GuestSessionSchema.parse(
    (await replace(initial, "Aissa")).data,
  );
  await expect(replace(initial, "Binta")).rejects.toMatchObject({
    messageCode: "RESTAURANTS_WRITE_CONFLICT",
  });
  const closed = c.GuestSessionSchema.parse(
    (
      await S.mutate(
        ctx,
        "CLOSE_SESSION",
        { clientRequestId: req(), expectedVersion: changed.version },
        { sessionId: initial.guestSessionId },
      )
    ).data,
  );
  await expect(replace(closed, "Binta")).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_STATE",
  });
  expect(
    (await floor()).items.find((t) => t.tableId === initial.tableId),
  ).toMatchObject({ state: "FREE" });
  for (const scope of [
    { ...ctx, orgId: "foreign" },
    { ...ctx, outletId: fixtureId(999) },
  ])
    await expect(
      S.mutate(
        scope,
        "REPLACE_RESPONSIBLE_STAFF",
        {
          clientRequestId: req(),
          expectedVersion: closed.version,
          staffId: null,
        },
        { sessionId: initial.guestSessionId },
      ),
    ).rejects.toBeDefined();
});
test("durable replay returns the stored result; changed target with same request conflicts", async () => {
  const s = await open(),
    id = req(),
    first = await replace(s, "Aissa", id),
    writes = m.transactions.length;
  expect(await replace(s, "Aissa", id)).toEqual(first);
  expect(m.transactions).toHaveLength(writes);
  await expect(replace(s, "Binta", id)).rejects.toMatchObject({
    messageCode: "RESTAURANTS_IDEMPOTENCY_CONFLICT",
  });
});
test("only one concurrent replacement wins", async () => {
  const s = await open();
  const results = await Promise.allSettled([
    replace(s, "Aissa"),
    replace(s, "Binta"),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await S.session(ctx, s.guestSessionId)).data.version).toBe(2);
});
test.each(["staff", "assignment", "membership", "product", "session"])(
  "atomic commit rejects concurrent %s changes",
  async (change) => {
    const s = await open();
    const original = R.commit.bind(R);
    jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
      if (change === "membership")
        patch(
          { PK: K.orgKey(ctx.orgId), SK: K.orgUserAccessSK("Aissa") },
          { status: "INACTIVE" },
        );
      else if (change === "product")
        patch(
          { PK: K.orgKey(ctx.orgId), SK: K.productAccessSK("RESTAURANTS") },
          { status: "INACTIVE" },
        );
      else {
        const key =
          change === "staff"
            ? SR.staffKey(ctx.orgId, "Aissa")
            : change === "assignment"
              ? SR.assignmentKeys(ctx.orgId, "Aissa", ctx.outletId)[0]
              : {
                  PK: K.restaurantSessionPK(
                    ctx.orgId,
                    ctx.outletId,
                    s.guestSessionId,
                  ),
                  SK: K.restaurantTransactionMetaSK(),
                };
        const row = unmarshall(m.rows.get(JSON.stringify([key.PK, key.SK]))!);
        patch(key, { data: { ...row.data, version: row.data.version + 1 } });
      }
      await original(actions);
    });
    await expect(replace(s, "Aissa")).rejects.toMatchObject({
      messageCode: "RESTAURANTS_WRITE_CONFLICT",
    });
    expect(
      (await S.session(ctx, s.guestSessionId)).data.responsibleStaffId,
    ).toBeUndefined();
  },
);
test.each(["WAITER", "CASHIER", "KITCHEN"])(
  "handler denies %s responsibility management",
  async (role) => {
    m.seedAccess(ctx.orgId, "operational", role);
    expect((await call(await open(), "operational")).statusCode).toBe(403);
  },
);
test("rejects forged input and requires active ProductAccess", async () => {
  const s = await open();
  const forged = await call(s, "owner", { orgId: "foreign", userId: "forged" });
  expect(forged.statusCode).toBe(200);
  expect(
    c.GuestSessionResponseSchema.parse(JSON.parse(forged.body)).data,
  ).toMatchObject({ orgId: ctx.orgId, openedBy: "owner" });
  expect(
    c.ReplaceGuestSessionResponsibleStaffRequestSchema.safeParse({
      clientRequestId: req(),
      expectedVersion: 1,
      staffId: "Aissa",
      orgId: "foreign",
    }).success,
  ).toBe(false);
  expect(
    (await call(s, "owner", { staffId: { userId: "Aissa" } })).statusCode,
  ).toBe(400);
  patch(
    { PK: K.orgKey(ctx.orgId), SK: K.productAccessSK("RESTAURANTS") },
    { status: "INACTIVE" },
  );
  expect((await call(s)).statusCode).toBe(403);
});
test("Service Floor deduplicates staff hydration in batches and handles mixed assigned/unassigned sessions", async () => {
  for (let i = 0; i < 3; i++) {
    const s = await open(i);
    if (i < 2) await replace(s, "Aissa");
  }
  m.db.resetHistory();
  const page = await floor();
  expect(
    page.items.filter((t) => t.state === "OCCUPIED" && t.responsibleStaff),
  ).toHaveLength(2);
  expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
  const batches = m.db.commandCalls(BatchGetItemCommand);
  const staffReads = batches.filter((call) =>
    Object.values(call.args[0].input.RequestItems ?? {}).some((request) =>
      request.Keys?.some((key) => key.SK?.S === K.restaurantStaffSK("Aissa")),
    ),
  );
  expect(staffReads).toHaveLength(1);
  for (const call of batches)
    for (const request of Object.values(call.args[0].input.RequestItems ?? {}))
      expect(
        new Set(request.Keys?.map((key) => JSON.stringify(key))).size,
      ).toBe(request.Keys?.length);
  expect(
    m.db
      .commandCalls(GetItemCommand)
      .filter(
        (call) => call.args[0].input.Key?.SK?.S === K.orgUserAccessSK("Aissa"),
      ),
  ).toHaveLength(0);
  expect(await ResponsibleStaff.sessions(ctx, [])).toEqual([]);
});

test("inactive outlet prevents new assignment and marks retained responsibility unavailable", async () => {
  const s = c.GuestSessionSchema.parse(
    (await replace(await open(), "Aissa")).data,
  );
  const key = {
    PK: K.orgKey(ctx.orgId),
    SK: K.restaurantOutletSK(ctx.outletId),
  };
  const row = unmarshall(m.rows.get(JSON.stringify([key.PK, key.SK]))!);
  patch(key, {
    data: { ...row.data, isActive: false, version: row.data.version + 1 },
  });
  expect(
    (await ResponsibleStaff.read(ctx, ["Aissa"])).get("Aissa")?.available,
  ).toBe(false);
  await expect(replace(s, "Binta")).rejects.toMatchObject({
    messageCode: "RESTAURANTS_PARENT_INACTIVE",
  });
  expect(
    c.GuestSessionSchema.parse((await replace(s, null)).data)
      .responsibleStaffId,
  ).toBeUndefined();
});
test("retains missing staff reference safely and returns no provider fallback", async () => {
  const s = c.GuestSessionSchema.parse(
    (await replace(await open(), "Aissa")).data,
  );
  m.rows.delete(
    JSON.stringify([K.orgKey(ctx.orgId), K.restaurantStaffSK("Aissa")]),
  );
  m.rows.delete(
    JSON.stringify([K.orgKey(ctx.orgId), K.orgUserAccessSK("Aissa")]),
  );
  expect((await read(s)).responsibleStaff).toEqual({
    staffId: "Aissa",
    displayName: null,
    available: false,
  });
});
test("session list and active-table reads use the same responsible presentation", async () => {
  const s = c.GuestSessionSchema.parse(
    (await replace(await open(), "Aissa")).data,
  );
  const list = c.GuestSessionListResponseSchema.parse(
    await Q.run(ctx, "ACTIVE_SESSIONS", {}),
  );
  const active = c.ActiveTableGuestSessionResponseSchema.parse(
    await Q.run(ctx, "ACTIVE_TABLE", {}, { tableId: s.tableId }),
  );
  expect(list.items[0].responsibleStaff).toEqual(active.data?.responsibleStaff);
  expect(active.data?.responsibleStaff?.staffId).toBe("Aissa");
});
test.each(["membership", "profile"])(
  "exhausted %s batch retries fail rather than report absent staff",
  async (blocked) => {
    m.db
      .on(BatchGetItemCommand)
      .callsFake(async (input: BatchGetItemCommandInput) => ({
        Responses: Object.fromEntries(
          Object.entries(input.RequestItems ?? {}).map(([table, request]) => [
            table,
            (request.Keys ?? []).flatMap((key) => {
              const isBlocked =
                blocked === "membership"
                  ? key.SK?.S === K.orgUserAccessSK("Aissa")
                  : key.PK?.S === K.userProfilePK("Aissa");
              const item = m.rows.get(JSON.stringify([key.PK?.S, key.SK?.S]));
              return !isBlocked && item ? [item] : [];
            }),
          ]),
        ),
        UnprocessedKeys: Object.fromEntries(
          Object.entries(input.RequestItems ?? {}).map(([table, request]) => [
            table,
            {
              ...request,
              Keys: (request.Keys ?? []).filter((key) =>
                blocked === "membership"
                  ? key.SK?.S === K.orgUserAccessSK("Aissa")
                  : key.PK?.S === K.userProfilePK("Aissa"),
              ),
            },
          ]),
        ),
      }));
    await expect(ResponsibleStaff.read(ctx, ["Aissa"])).rejects.toMatchObject({
      statusCode: 503,
    });
  },
);
