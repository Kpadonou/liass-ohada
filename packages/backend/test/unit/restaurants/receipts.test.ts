import { RestaurantIssuanceProvenanceRepository as Provenance } from "@/lambda/domains/restaurants/issuance-provenance-repository";
import { openCashFixture } from "./cash-fixture";
import { RestaurantCashService as Cash } from "@/lambda/domains/restaurants/cash-service";
import { RestaurantInvoiceService as Invoice } from "@/lambda/domains/restaurants/invoice-service";
import { RestaurantInvoiceSourceVerifier as Source } from "@/lambda/domains/restaurants/invoice-source-verifier";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import {
  RestaurantReceiptService as Receipt,
  receiptPart,
} from "@/lambda/domains/restaurants/receipt-service";
import { RestaurantReceiptRepository as B } from "@/lambda/domains/restaurants/receipt-repository";
import { RestaurantTransactionsService as S } from "@/lambda/domains/restaurants/transaction-service";
import {
  RestaurantTransactionsRepository as R,
  transactionFingerprint as hash,
} from "@/lambda/domains/restaurants/transaction-repository";
import { RestaurantPaymentService as Pay } from "@/lambda/domains/restaurants/payment-service";
import { RestaurantStaffService as Staff } from "@/lambda/domains/restaurants/staff-service";
import { DomainAuthorizationService as Auth } from "@/lambda/shared/services/domain-authorization-service";
import { handler as publishHandler } from "@/lambda/domains/restaurants/publish-receipt";
import { acceptanceFixture } from "./acceptance-fixture";
import { memoryDynamo, fixtureId as id } from "./memory-dynamo";
let m: ReturnType<typeof memoryDynamo>,
  f: Awaited<ReturnType<typeof acceptanceFixture>>,
  seq: number;
const org = "org-resto",
  req = () => id(++seq);
const scope = () => ({ orgId: org, outletId: f.outlet.id });
const ctx = () => ({ ...scope(), actorId: "owner" });
const key = (sessionId: string) => ({
  PK: K.restaurantSessionPK(org, f.outlet.id, sessionId),
  SK: K.restaurantTransactionMetaSK(),
});
function patch(k: { PK: string; SK: string }, data: object) {
  const address = JSON.stringify([k.PK, k.SK]);
  const row = unmarshall(m.rows.get(address)!);
  Object.assign(row.data as object, data);
  m.rows.set(address, marshall(row, { removeUndefinedValues: true }));
}
async function person(actor: string, role: string, assigned = true) {
  m.seedAccess(org, actor, role);
  await Staff.mutate(org, "owner", actor, "BIND", {
    clientRequestId: req(),
    memberUserId: actor,
    operationalLabel: `${actor} staff`,
  });
  if (assigned)
    await Staff.mutate(
      org,
      "owner",
      actor,
      "ASSIGN",
      { clientRequestId: req() },
      f.outlet.id,
    );
}
async function visit(lines = 1) {
  const session = c.GuestSessionSchema.parse(
    (
      await S.mutate(ctx(), "OPEN_SESSION", {
        staffId: "owner",
        clientRequestId: req(),
        tableId: f.tables[0].id,
        areaId: f.tables[0].serviceAreaId,
      })
    ).data,
  );
  const order = c.RestaurantOrderSchema.parse(
    (
      await S.mutate(ctx(), "CREATE_ORDER", {
        clientRequestId: req(),
        orderType: "DINE_IN",
        guestSessionId: session.guestSessionId,
      })
    ).data,
  );
  for (let i = 0; i < lines; i++) {
    const o = await S.order(scope(), order.orderId),
      item = f.items[4];
    const line = c.RestaurantOrderItemSchema.parse(
      (
        await S.mutate(
          ctx(),
          "ADD_ITEM",
          {
            clientRequestId: req(),
            expectedVersion: o.data.version,
            menuItemId: item.id,
            categoryId: item.categoryId,
            expectedMenuItemVersion: item.version,
            quantity: 1,
            notes: `Round ${i}`,
          },
          { orderId: order.orderId },
        )
      ).data,
    );
    await S.mutate(
      ctx(),
      "SUBMIT_ORDER",
      {
        clientRequestId: req(),
        expectedVersion: (await S.order(scope(), order.orderId)).data.version,
        items: [{ itemId: line.itemId, expectedVersion: line.version }],
      },
      { orderId: order.orderId },
    );
  }
  return { sessionId: session.guestSessionId, orderId: order.orderId };
}
async function settle(v: { sessionId: string; orderId: string }) {
  const session = (await S.session(scope(), v.sessionId)).data;
  if (session.dueMinor)
    await Pay.capture(scope(), "owner", v.sessionId, {
      clientRequestId: req(),
      expectedVersion: session.version,
      method: "CASH",
      currency: "XOF",
      allocations: [{ orderId: v.orderId, amountMinor: session.dueMinor }],
      cashTenderedMinor: session.dueMinor + 1000,
    });
  await S.mutate(
    ctx(),
    "CLOSE_ORDER",
    {
      clientRequestId: req(),
      expectedVersion: (await S.order(scope(), v.orderId)).data.version,
    },
    { orderId: v.orderId },
  );
  await S.mutate(
    ctx(),
    "CLOSE_SESSION",
    {
      clientRequestId: req(),
      expectedVersion: (await S.session(scope(), v.sessionId)).data.version,
    },
    { sessionId: v.sessionId },
  );
}
async function finish(
  sessionId: string,
  actor = "owner",
  clientRequestId = req(),
) {
  for (let n = 0; n < 500; n++) {
    const r = await Receipt.publish(scope(), actor, sessionId, {
      clientRequestId,
    });
    if (r.data.state === "FINAL") return r.data.receipt;
  }
  throw new Error("Unbounded build");
}
beforeEach(async () => {
  m = memoryDynamo();
  seq = 210000;
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  f = await acceptanceFixture();
  m.seedAccess(org, "owner", "OWNER");
  m.seedAccess(org, "manager", "MANAGER");
  await person("owner", "OWNER");
  await openCashFixture(scope(), ["owner", "manager"]);
});
afterEach(() => {
  m.db.restore();
  jest.restoreAllMocks();
});
test("closed canonical visit publishes immutable accepted lines and cash evidence without reoccupying table", async () => {
  const v = await visit(2);
  await settle(v);
  patch(key(v.sessionId), { tableName: "Terrasse jardin" });
  const financial = (await S.session(scope(), v.sessionId)).data;
  const request = { clientRequestId: req() };
  const result = await Receipt.publish(scope(), "owner", v.sessionId, request);
  expect(result.data.state).toBe("FINAL");
  const summary = await finish(v.sessionId);
  expect(summary).toMatchObject({
    tableName: "Terrasse jardin",
    dueMinor: 4000,
    paidMinor: 4000,
    lineCount: 2,
    paymentCount: 1,
  });
  const page = await Receipt.read(scope(), "owner", v.sessionId, {});
  expect(page.parts[0].content.kind).toBe("COMMERCIAL");
  expect(JSON.stringify(page)).not.toContain("acceptedBy");
  expect(page.parts.at(-1)?.content).toMatchObject({
    kind: "SETTLEMENT",
    payments: [
      { appliedAmountMinor: 4000, cashTenderedMinor: 5000, changeMinor: 1000 },
    ],
  });
  const count = m.rows.size;
  expect(await Receipt.publish(scope(), "owner", v.sessionId, request)).toEqual(
    result,
  );
  expect(m.rows.size).toBe(count);
  expect((await S.session(scope(), v.sessionId)).data).toMatchObject({
    ...financial,
    finalBillId: summary.receiptId,
    version: financial.version + 1,
  });
  expect((await S.activeTable(scope(), f.tables[0].id)).data).toBeNull();
  expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
});
test("OPEN and inconsistent CLOSED owners cannot publish", async () => {
  const v = await visit();
  await expect(
    Receipt.publish(scope(), "owner", v.sessionId, { clientRequestId: req() }),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_TRANSACTION_STATE" });
  await settle(v);
  patch(key(v.sessionId), { paidMinor: 0 });
  await expect(finish(v.sessionId)).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_INTEGRITY",
  });
  expect(
    (
      unmarshall(
        m.rows.get(JSON.stringify([key(v.sessionId).PK, key(v.sessionId).SK]))!,
      ).data as c.GuestSession
    ).finalBillId,
  ).toBeUndefined();
});
test.each(["owner", "manager", "cashier"])(
  "%s has narrow CLOSED receipt publication/read authority",
  async (actor) => {
    if (actor === "cashier") await person(actor, "CASHIER");
    const v = await visit();
    await settle(v);
    const r = await finish(v.sessionId, actor);
    expect((await Receipt.read(scope(), actor, v.sessionId, {})).data).toEqual(
      r,
    );
  },
);
test.each(["WAITER", "KITCHEN", "CASHIER"])(
  "%s without current assigned authority denied",
  async (role) => {
    const actor = role.toLowerCase();
    await person(actor, role, false);
    const v = await visit();
    await settle(v);
    const result = await publishHandler({
      headers: { "x-org-id": org },
      pathParameters: { outletId: f.outlet.id, sessionId: v.sessionId },
      body: JSON.stringify({ clientRequestId: req() }),
      requestContext: { authorizer: { jwt: { claims: { sub: actor } } } },
    });
    expect(result.statusCode).toBe(403);
  },
);
test("receipt permission projection does not grant checkout history or service to cashier", () => {
  for (const role of ["OWNER", "MANAGER", "CASHIER"])
    expect(Auth.permissionsForRestaurantsRole(role)).toEqual(
      expect.arrayContaining([
        "RESTAURANTS_RECEIPT_READ",
        "RESTAURANTS_RECEIPT_MANAGE",
      ]),
    );
  for (const role of ["WAITER", "KITCHEN"])
    expect(Auth.permissionsForRestaurantsRole(role)).not.toContain(
      "RESTAURANTS_RECEIPT_MANAGE",
    );
  expect(Auth.permissionsForRestaurantsRole("CASHIER")).not.toContain(
    "RESTAURANTS_SERVICE_ORDER_READ",
  );
});
test("concurrent publishers reserve one identity, resume coherent progress and publish once", async () => {
  const v = await visit(3);
  await settle(v);
  const results = await Promise.all([
    finish(v.sessionId, "owner"),
    finish(v.sessionId, "manager"),
  ]);
  expect(results[0]).toEqual(results[1]);
  const stored = [...m.rows.values()].map((r) => unmarshall(r));
  expect(
    stored.filter((r) => r.entityType === "RESTAURANT_BILL_MANIFEST"),
  ).toHaveLength(1);
  expect(
    stored.filter(
      (r) =>
        r.entityType === "RESTAURANT_TRANSACTION_AUDIT" &&
        (r.data as { action: string }).action === "PUBLISH_RECEIPT",
    ),
  ).toHaveLength(1);
});
test("part fingerprints are canonical, bounded and never replace immutable evidence", () => {
  const content = {
    kind: "SETTLEMENT" as const,
    payments: [
      {
        paymentId: id(1),
        method: "CASH" as const,
        appliedAmountMinor: 1,
        committedAt: "2026-10-19T00:00:00.000Z",
        allocations: [{ orderId: id(2), amountMinor: 1 }],
      },
    ],
  };
  expect(receiptPart(1, "0".repeat(64), content)).toEqual(
    receiptPart(1, "0".repeat(64), structuredClone(content)),
  );
  expect(() =>
    receiptPart(1, "0".repeat(64), {
      ...content,
      payments: Array(17).fill(content.payments[0]),
    }),
  ).toThrow();
  expect(() =>
    B.put(
      scope(),
      id(1),
      K.restaurantBillPartSK(1),
      "PART",
      receiptPart(1, "0".repeat(64), content),
      1,
    ),
  ).toThrow();
});
async function synthetic(orderCount: number, totalLines: number, long = false) {
  const v = await visit();
  await settle(v);
  const template = (await S.order(scope(), v.orderId)).data;
  const source = await R.query(
    scope(),
    K.restaurantOrderPK(org, f.outlet.id, v.orderId),
    K.restaurantOrderItemPrefix(),
    "LINE",
    { limit: 100 },
  );
  const accepted = c.RestaurantOrderItemSchema.parse(source.rows[0].data);
  const sourceBytes: number[] = [];
  // Retain canonical closed session/config; replace its bounded source fixture with zero-value accepted sales.
  for (const [key, raw] of m.rows) {
    const row = unmarshall(raw);
    if (
      row.PK === K.restaurantOrderPK(org, f.outlet.id, v.orderId) ||
      (row.PK === K.restaurantSessionPK(org, f.outlet.id, v.sessionId) &&
        String(row.SK).startsWith("ORD#")) ||
      (row.PK === K.restaurantSessionPK(org, f.outlet.id, v.sessionId) &&
        String(row.SK).startsWith("PAY#"))
    )
      m.rows.delete(key);
  }
  const put = (row: ReturnType<typeof R.row>) =>
    m.rows.set(
      JSON.stringify([row.PK, row.SK]),
      marshall(row, { removeUndefinedValues: true }),
    );
  let left = totalLines;
  for (let i = 0; i < orderCount; i++) {
    const count = Math.min(Math.ceil(totalLines / orderCount), left);
    left -= count;
    const orderId = req();
    const o = c.RestaurantOrderSchema.parse({
      ...template,
      orderId,
      dueMinor: 0,
      paidMinor: 0,
      paidByMethodMinor: { CASH: 0, MOBILE_MONEY: 0, CARD: 0 },
      paymentAttemptCount: 0,
      succeededPaymentCount: 0,
      lineCount: count,
      acceptedLineCount: count,
    });
    put(
      R.row(
        scope(),
        {
          PK: K.restaurantOrderPK(org, f.outlet.id, orderId),
          SK: K.restaurantTransactionMetaSK(),
        },
        "ORDER",
        o,
      ),
    );
    put(
      R.row(
        scope(),
        {
          PK: K.restaurantSessionPK(org, f.outlet.id, v.sessionId),
          SK: K.restaurantSessionOrderSK(o.createdAt, orderId),
        },
        "SESSION_ORDER",
        {
          targetId: orderId,
          targetKind: "ORDER",
          timestamp: o.createdAt,
          guestSessionId: v.sessionId,
        },
      ),
    );
    for (let j = 0; j < count; j++) {
      const itemId = req();
      const item = c.RestaurantOrderItemSchema.parse({
        ...accepted,
        orderId,
        itemId,
        notes: long ? "ࠀ".repeat(1000) : `Accepted round ${j}`,
        snapshot: {
          ...accepted.snapshot,
          name: long ? "ࠀ".repeat(160) : "Poulet braisé sauce maison",
          unitPriceMinor: 0,
          grossMinor: 0,
          subtotalMinor: 0,
          lineTotalMinor: 0,
        },
      });
      sourceBytes.push(Buffer.byteLength(JSON.stringify(item)));
      put(
        R.row(
          scope(),
          {
            PK: K.restaurantOrderPK(org, f.outlet.id, orderId),
            SK: K.restaurantOrderItemSK(itemId),
          },
          "LINE",
          item,
        ),
      );
    }
  }
  patch(key(v.sessionId), {
    orderCount,
    dueMinor: 0,
    paidMinor: 0,
    paidByMethodMinor: { CASH: 0, MOBILE_MONEY: 0, CARD: 0 },
  });
  return { ...v, sourceBytes: sourceBytes.reduce((n, v) => n + v, 0) };
}
test.each([
  [1, 5],
  [3, 30],
  [10, 1000],
  [50, 10000],
])(
  "bounded durable build %i Orders / %i maximum-length lines",
  async (orders, lines) => {
    const v = await synthetic(orders, lines, true);
    const commandId = req();
    let first = true,
      calls = 0;
    let result: c.RestaurantReceiptSummary | undefined;
    while (!result && calls++ < 500) {
      const r = await Receipt.publish(scope(), "owner", v.sessionId, {
        clientRequestId: commandId,
      });
      if (r.data.state === "FINAL") result = r.data.receipt;
      else if (first) {
        first = false;
        await expect(
          Receipt.read(scope(), "owner", v.sessionId, {}),
        ).rejects.toMatchObject({ statusCode: 404 });
      }
    }
    expect(result?.lineCount).toBe(lines);
    const parts = [...m.rows.values()]
      .map((r) => unmarshall(r))
      .filter((r) => r.entityType === "RESTAURANT_BILL_PART")
      .map((r) => c.RestaurantReceiptPartSchema.parse(r.data));
    expect(parts.length).toBeGreaterThanOrEqual(Math.ceil(lines / 16));
    const sizes = parts.map((p) => Buffer.byteLength(JSON.stringify(p)));
    for (const p of parts) {
      expect(p.content.kind).toBe("COMMERCIAL");
      if (p.content.kind === "COMMERCIAL") {
        expect(p.content.lines.length).toBeLessThanOrEqual(16);
        expect(p.content.lines[0].notes?.length).toBe(1000);
      }
    }
    expect(Math.max(...sizes)).toBeLessThanOrEqual(64 * 1024);
    const writes = m.transactions.filter((t) =>
      t.TransactItems?.some(
        (a) => a.Put?.Item?.entityType?.S === "RESTAURANT_BILL_PART",
      ),
    );
    const final = m.transactions.find((t) =>
      t.TransactItems?.some(
        (a) => a.Put?.Item?.entityType?.S === "RESTAURANT_BILL_RESULT",
      ),
    )!;
    console.log(
      "RECEIPT_METRIC",
      JSON.stringify({
        orders,
        lines,
        sourceBytes: v.sourceBytes,
        commercialParts: parts.length,
        paymentParts: 0,
        maxPartBytes: Math.max(...sizes),
        maxStoredPartBytes: Math.max(
          ...parts.map((p) =>
            Buffer.byteLength(
              JSON.stringify(
                B.row(
                  scope(),
                  result!.receiptId,
                  K.restaurantBillPartSK(p.number),
                  "PART",
                  p,
                ),
              ),
            ),
          ),
        ),
        totalPartBytes: sizes.reduce((n, v) => n + v, 0),
        totalStoredDocumentBytes: [...m.rows.values()]
          .map((raw) => unmarshall(raw))
          .filter(
            (raw) =>
              raw.PK ===
                K.restaurantBillPK(org, f.outlet.id, result!.receiptId) &&
              [
                "RESTAURANT_BILL_MANIFEST",
                "RESTAURANT_BILL_PART",
                "RESTAURANT_BILL_RESULT",
              ].includes(String(raw.entityType)),
          )
          .reduce(
            (bytes, row) => bytes + Buffer.byteLength(JSON.stringify(row)),
            0,
          ),
        partTransactions: writes.length,
        finalActions: final.TransactItems?.length,
        finalTransactionBytes: Buffer.byteLength(
          JSON.stringify(final.TransactItems),
        ),
        maxPartActions: Math.max(...writes.map((t) => t.TransactItems!.length)),
        maxPartTransactionBytes: Math.max(
          ...writes.map((t) =>
            Buffer.byteLength(JSON.stringify(t.TransactItems)),
          ),
        ),
      }),
    );
    expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
  },
  120000,
);
test("interruption preserves immutable parts, hides BUILDING and resumes without checkout rollback", async () => {
  const v = await synthetic(3, 60);
  const commandId = req();
  const original = R.commit.bind(R);
  let lost = false;
  const spy = jest.spyOn(R, "commit").mockImplementation(async (actions) => {
    await original(actions);
    if (
      !lost &&
      actions.some((a) => a.Put?.Item?.entityType?.S === "RESTAURANT_BILL_PART")
    ) {
      lost = true;
      throw new Error("Lost part response");
    }
  });
  await expect(
    Receipt.publish(scope(), "owner", v.sessionId, {
      clientRequestId: commandId,
    }),
  ).rejects.toThrow("Lost part response");
  spy.mockRestore();
  const reservedInvoiceId = (await S.session(scope(), v.sessionId)).data
    .finalBillId;
  expect(reservedInvoiceId).toBeTruthy();
  expect((await Cash.activeDay(scope()))!.day.data.invoiceCount).toBe(0);
  expect(
    [...m.rows.values()].filter(
      (r) => r.entityType?.S === "RESTAURANT_DOCUMENT_INV",
    ),
  ).toHaveLength(0);
  await expect(
    Invoice.read(scope(), "owner", v.sessionId, {}),
  ).rejects.toMatchObject({ statusCode: 404 });
  await expect(
    Receipt.read(scope(), "owner", v.sessionId, {}),
  ).rejects.toMatchObject({ statusCode: 404 });
  const before = [...m.rows.values()]
    .filter((r) => r.entityType?.S === "RESTAURANT_BILL_PART")
    .map((r) => JSON.stringify(r));
  const result = await finish(v.sessionId, "owner", commandId);
  expect(result.lineCount).toBe(60);
  expect(result.receiptId).toBe(reservedInvoiceId);
  const projections = [...m.rows.values()].filter(
    (r) => r.entityType?.S === "RESTAURANT_DOCUMENT_INV",
  );
  expect(projections).toHaveLength(1);
  expect(unmarshall(projections[0]).data.invoiceId).toBe(reservedInvoiceId);
  expect((await Cash.activeDay(scope()))!.day.data.invoiceCount).toBe(1);
  await finish(v.sessionId, "owner", commandId);
  expect((await Cash.activeDay(scope()))!.day.data.invoiceCount).toBe(1);
  const proofBefore = JSON.stringify(
    [...m.rows.values()].filter((r) =>
      ["RESTAURANT_BILL_PART", "RESTAURANT_BILL_RESULT"].includes(
        r.entityType?.S ?? "",
      ),
    ),
  );
  const canonical = await Invoice.read(scope(), "owner", v.sessionId, {});
  expect(canonical.data.invoiceId).toBe(reservedInvoiceId);
  expect(canonical.data.digest).toBe(result.digest);
  expect(
    JSON.stringify(
      [...m.rows.values()].filter((r) =>
        ["RESTAURANT_BILL_PART", "RESTAURANT_BILL_RESULT"].includes(
          r.entityType?.S ?? "",
        ),
      ),
    ),
  ).toBe(proofBefore);
  const after = [...m.rows.values()].map((r) => JSON.stringify(r));
  expect(after).toEqual(expect.arrayContaining(before));
  expect((await S.session(scope(), v.sessionId)).data.status).toBe("CLOSED");
  expect((await S.activeTable(scope(), f.tables[0].id)).data).toBeNull();
});
test("lost FINAL response replays original result without duplicate final audit", async () => {
  const v = await visit();
  await settle(v);
  const commandId = req(),
    original = R.commit.bind(R);
  let lost = false;
  const spy = jest.spyOn(R, "commit").mockImplementation(async (actions) => {
    await original(actions);
    if (
      !lost &&
      actions.some(
        (a) => a.Put?.Item?.entityType?.S === "RESTAURANT_BILL_RESULT",
      )
    ) {
      lost = true;
      throw new Error("Lost FINAL response");
    }
  });
  await expect(
    Receipt.publish(scope(), "owner", v.sessionId, {
      clientRequestId: commandId,
    }),
  ).rejects.toThrow("Lost FINAL response");
  spy.mockRestore();
  const count = m.rows.size;
  const result = await finish(v.sessionId, "owner", commandId);
  expect(m.rows.size).toBe(count);
  expect(result).toEqual(
    (await Receipt.read(scope(), "owner", v.sessionId, {})).data,
  );
});
test("changed stored part fails chained validation, never publishes FINAL", async () => {
  const v = await synthetic(3, 60);
  const commandId = req(),
    original = R.commit.bind(R);
  let stopped = false;
  const spy = jest.spyOn(R, "commit").mockImplementation(async (actions) => {
    await original(actions);
    if (
      !stopped &&
      actions.some((a) => a.Put?.Item?.entityType?.S === "RESTAURANT_BILL_PART")
    ) {
      stopped = true;
      throw new Error("interrupt");
    }
  });
  await expect(
    Receipt.publish(scope(), "owner", v.sessionId, {
      clientRequestId: commandId,
    }),
  ).rejects.toThrow();
  spy.mockRestore();
  const part = [...m.rows.values()].find(
    (r) => r.entityType?.S === "RESTAURANT_BILL_PART",
  )!;
  const row = unmarshall(part);
  patch({ PK: String(row.PK), SK: String(row.SK) }, { digest: "a".repeat(64) });
  await expect(finish(v.sessionId, "owner", commandId)).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_INTEGRITY",
  });
});
test("paginated FINAL parts bind cursor to receipt, outlet and tenant; no technical table identity", async () => {
  const v = await synthetic(3, 60);
  const result = await finish(v.sessionId);
  const page = await Receipt.read(scope(), "owner", v.sessionId, { limit: 1 });
  expect(page.nextCursor).toBeDefined();
  const next = await Receipt.read(scope(), "owner", v.sessionId, {
    limit: 1,
    cursor: page.nextCursor,
  });
  expect(next.parts[0].number).toBe(2);
  await expect(
    B.parts(
      { ...scope(), orgId: "foreign" },
      result.receiptId,
      result.digest,
      result.partCount,
      { limit: 1, cursor: page.nextCursor },
    ),
  ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
  await expect(
    B.parts(scope(), id(9), result.digest, result.partCount, {
      limit: 1,
      cursor: page.nextCursor,
    }),
  ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
  expect(JSON.stringify(page)).not.toContain("tableCode");
  expect(JSON.stringify(page)).not.toContain('"PK"');
});
test("accepted cancellation remains explicit and nets commercial total", async () => {
  const v = await visit(2);
  const rows = await R.query(
    scope(),
    K.restaurantOrderPK(org, f.outlet.id, v.orderId),
    K.restaurantOrderItemPrefix(),
    "LINE",
    { limit: 100 },
  );
  const item = c.RestaurantOrderItemSchema.parse(rows.rows[0].data);
  await S.mutate(
    ctx(),
    "CANCEL_ITEM",
    {
      clientRequestId: req(),
      expectedVersion: (await S.order(scope(), v.orderId)).data.version,
      expectedItemVersion: item.version,
      reason: "Client changed selection",
    },
    { orderId: v.orderId, itemId: item.itemId },
  );
  await settle(v);
  const result = await finish(v.sessionId);
  expect(result).toMatchObject({
    lineCount: 2,
    dueMinor: 2000,
    paidMinor: 2000,
  });
  expect(
    (await Source.verify(scope(), "owner", v.sessionId, result.receiptId))
      .verified,
  ).toBe(true);
  const page = await Receipt.read(scope(), "owner", v.sessionId, {});
  const commercial = page.parts.flatMap((p) =>
    p.content.kind === "COMMERCIAL" ? p.content.lines : [],
  );
  expect(commercial).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        netAmountMinor: 0,
        cancellationReason: "Client changed selection",
        snapshot: expect.objectContaining({ lineTotalMinor: 2000 }),
      }),
    ]),
  );
});
test("canonical mixed payments reconcile methods, allocations and applied cash only", async () => {
  const v = await visit();
  for (const [method, amount] of [
    ["CASH", 600],
    ["MOBILE_MONEY", 700],
    ["CARD", 700],
  ] as const) {
    const s = (await S.session(scope(), v.sessionId)).data;
    await Pay.capture(scope(), "owner", v.sessionId, {
      clientRequestId: req(),
      expectedVersion: s.version,
      method,
      currency: "XOF",
      allocations: [{ orderId: v.orderId, amountMinor: amount }],
      ...(method === "CASH"
        ? { cashTenderedMinor: 1000 }
        : { externalReference: "Staff-confirmed reference" }),
    });
  }
  await S.mutate(
    ctx(),
    "CLOSE_ORDER",
    {
      clientRequestId: req(),
      expectedVersion: (await S.order(scope(), v.orderId)).data.version,
    },
    { orderId: v.orderId },
  );
  await S.mutate(
    ctx(),
    "CLOSE_SESSION",
    {
      clientRequestId: req(),
      expectedVersion: (await S.session(scope(), v.sessionId)).data.version,
    },
    { sessionId: v.sessionId },
  );
  const result = await finish(v.sessionId);
  expect(result).toMatchObject({
    paidMinor: 2000,
    paymentCount: 3,
    paidByMethodMinor: { CASH: 600, MOBILE_MONEY: 700, CARD: 700 },
  });
  expect(
    (await Source.verify(scope(), "owner", v.sessionId, result.receiptId))
      .verified,
  ).toBe(true);
  const page = await Receipt.read(scope(), "owner", v.sessionId, {});
  const payments = page.parts.flatMap((p) =>
    p.content.kind === "SETTLEMENT" ? p.content.payments : [],
  );
  expect(payments.find((p) => p.method === "CASH")).toMatchObject({
    cashTenderedMinor: 1000,
    changeMinor: 400,
  });
  expect(JSON.stringify(page)).not.toContain("verified");
});
test("FINAL is independent of later outlet/menu/table configuration and never releases a later visit", async () => {
  const v = await visit();
  await settle(v);
  const before = await finish(v.sessionId);
  const page = await Receipt.read(scope(), "owner", v.sessionId, {});
  for (const [key, raw] of m.rows) {
    const row = unmarshall(raw);
    if (
      [
        "RESTAURANT_OUTLET",
        "RESTAURANT_TABLE",
        "RESTAURANT_MENU_ITEM",
      ].includes(String(row.entityType))
    ) {
      const data = row.data as Record<string, unknown>;
      data.name = "Renamed configuration";
      if (data.price)
        (data.price as { amountMinor: number }).amountMinor = 99999;
      m.rows.set(key, marshall(row, { removeUndefinedValues: true }));
    }
  }
  const next = await S.mutate(ctx(), "OPEN_SESSION", {
        staffId: "owner",
    clientRequestId: req(),
    tableId: f.tables[0].id,
    areaId: f.tables[0].serviceAreaId,
  });
  expect(await Receipt.read(scope(), "owner", v.sessionId, {})).toEqual(page);
  expect(await finish(v.sessionId)).toEqual(before);
  expect(
    (await S.activeTable(scope(), f.tables[0].id)).data?.guestSessionId,
  ).toBe(c.GuestSessionSchema.parse(next.data).guestSessionId);
});
test("current CASHIER assignment revocation denies publication replay and receipt reads", async () => {
  await person("cashier", "CASHIER");
  const v = await visit();
  await settle(v);
  const commandId = req();
  await finish(v.sessionId, "cashier", commandId);
  await Staff.mutate(
    org,
    "owner",
    "cashier",
    "UNASSIGN",
    { clientRequestId: req(), expectedVersion: 1 },
    f.outlet.id,
  );
  await expect(finish(v.sessionId, "cashier", commandId)).rejects.toMatchObject(
    { messageCode: "DOMAIN_PERMISSION_REQUIRED" },
  );
  await expect(
    Receipt.read(scope(), "cashier", v.sessionId, {}),
  ).rejects.toMatchObject({ messageCode: "DOMAIN_PERMISSION_REQUIRED" });
});

test("byte bound splits a 16-line source page with maximum cancellation reasons without truncation", async () => {
  const v = await synthetic(1, 32, true);
  for (const [address, raw] of m.rows) {
    const row = unmarshall(raw);
    if (row.entityType !== "RESTAURANT_ORDER_ITEM") continue;
    Object.assign(row.data as object, {
      status: "CANCELLED",
      cancelledAt: "2026-10-19T00:00:00.000Z",
      cancellationReason: "ࠀ".repeat(500),
    });
    m.rows.set(address, marshall(row, { removeUndefinedValues: true }));
  }
  const summary = await finish(v.sessionId);
  expect(summary.commercialPartCount).toBeGreaterThan(2);
  const parts = [...m.rows.values()]
    .filter((r) => r.entityType?.S === "RESTAURANT_BILL_PART")
    .map((r) => c.RestaurantReceiptPartSchema.parse(unmarshall(r).data));
  for (const part of parts) {
    expect(Buffer.byteLength(JSON.stringify(part))).toBeLessThanOrEqual(
      64 * 1024,
    );
    if (part.content.kind === "COMMERCIAL")
      for (const line of part.content.lines)
        expect(line.cancellationReason).toHaveLength(500);
  }
});
test("missing canonical payment evidence fails closed and does not undo checkout", async () => {
  const v = await visit();
  await settle(v);
  for (const [address, raw] of m.rows)
    if (
      raw.PK?.S === K.restaurantSessionPK(org, f.outlet.id, v.sessionId) &&
      raw.SK?.S?.startsWith(K.restaurantPaymentReferencePrefix())
    )
      m.rows.delete(address);
  await expect(finish(v.sessionId)).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_INTEGRITY",
  });
  expect((await S.session(scope(), v.sessionId)).data.status).toBe("CLOSED");
  expect((await S.activeTable(scope(), f.tables[0].id)).data).toBeNull();
  await expect(
    Receipt.read(scope(), "owner", v.sessionId, {}),
  ).rejects.toMatchObject({ statusCode: 404 });
});
test("same command identity from a different publisher conflicts; new identity reuses final document", async () => {
  const v = await visit();
  await settle(v);
  const clientRequestId = req();
  const first = await finish(v.sessionId, "owner", clientRequestId);
  await expect(
    finish(v.sessionId, "manager", clientRequestId),
  ).rejects.toMatchObject({ messageCode: "RESTAURANTS_IDEMPOTENCY_CONFLICT" });
  expect(await finish(v.sessionId, "manager")).toEqual(first);
});
test("foreign outlet and revoked membership deny receipt-specific access", async () => {
  await person("cashier", "CASHIER");
  const v = await visit();
  await settle(v);
  await finish(v.sessionId);
  await expect(
    Receipt.read({ ...scope(), outletId: id(880) }, "cashier", v.sessionId, {}),
  ).rejects.toMatchObject({ statusCode: 403 });
  const k = { PK: K.orgKey(org), SK: K.orgUserAccessSK("cashier") };
  const address = JSON.stringify([k.PK, k.SK]);
  const row = unmarshall(m.rows.get(address)!);
  row.status = "INACTIVE";
  m.rows.set(address, marshall(row));
  await expect(
    Receipt.read(scope(), "cashier", v.sessionId, {}),
  ).rejects.toMatchObject({ statusCode: 403 });
});
test("delayed BUILDING transaction cannot append after FINAL", async () => {
  const v = await visit();
  await settle(v);
  const original = R.commit.bind(R);
  let stale: Parameters<typeof R.commit>[0] | undefined;
  const spy = jest.spyOn(R, "commit").mockImplementation(async (actions) => {
    if (
      !stale &&
      actions.some((a) => a.Put?.Item?.entityType?.S === "RESTAURANT_BILL_PART")
    )
      stale = structuredClone(actions);
    await original(actions);
  });
  await finish(v.sessionId);
  spy.mockRestore();
  expect(stale).toBeDefined();
  await expect(original(stale!)).rejects.toMatchObject({
    name: "TransactionCanceledException",
  });
  expect(
    (await Receipt.read(scope(), "owner", v.sessionId, {})).data.partCount,
  ).toBe(2);
});

test("CASHIER publication has bounded reservation, part and FINAL action counts", async () => {
  await person("cashier", "CASHIER");
  const v = await visit();
  await settle(v);
  const start = m.transactions.length;
  await finish(v.sessionId, "cashier");
  const tx = m.transactions.slice(start);
  const reservation = tx.find((t) =>
    t.TransactItems?.some(
      (a) => a.Put?.Item?.entityType?.S === "RESTAURANT_BILL_COMMAND",
    ),
  )!;
  const part = tx.find((t) =>
    t.TransactItems?.some(
      (a) => a.Put?.Item?.entityType?.S === "RESTAURANT_BILL_PART",
    ),
  )!;
  const final = tx.find((t) =>
    t.TransactItems?.some(
      (a) => a.Put?.Item?.entityType?.S === "RESTAURANT_BILL_RESULT",
    ),
  )!;
  expect(reservation.TransactItems).toHaveLength(8);
  expect(part.TransactItems).toHaveLength(8);
  expect(final.TransactItems).toHaveLength(13);
  console.log(
    "RECEIPT_CASHIER_TX",
    JSON.stringify({
      reservationActions: reservation.TransactItems!.length,
      reservationBytes: Buffer.byteLength(
        JSON.stringify(reservation.TransactItems),
      ),
      partActions: part.TransactItems!.length,
      partBytes: Buffer.byteLength(JSON.stringify(part.TransactItems)),
      finalActions: final.TransactItems!.length,
      finalBytes: Buffer.byteLength(JSON.stringify(final.TransactItems)),
    }),
  );
});

describe("complete source verification", () => {
  const verify = (sessionId: string, invoiceId: string, actor = "owner") =>
    Source.verify(scope(), actor, sessionId, invoiceId);
  const stored = (kind: string) =>
    [...m.rows.values()]
      .map((row) => unmarshall(row))
      .filter((row) => row.entityType === `RESTAURANT_BILL_${kind}`);
  function replace(row: Record<string, unknown>) {
    m.rows.set(
      JSON.stringify([row.PK, row.SK]),
      marshall(row, { removeUndefinedValues: true }),
    );
  }
  // Rebind the existing proof after intentional corruption to test semantic
  // verification independently of the hash-tampering rejection.
  function rechain(change: (parts: c.RestaurantReceiptPart[]) => void) {
    const manifestRow = stored("MANIFEST")[0];
    const manifest =
      manifestRow.data as import("@/lambda/domains/restaurants/receipt-model").ReceiptManifest;
    const rows = stored("PART").sort((a, b) =>
      String(a.SK).localeCompare(String(b.SK)),
    );
    const parts = rows.map((row) =>
      c.RestaurantReceiptPartSchema.parse(row.data),
    );
    change(parts);
    let previous = parts[0].previousDigest;
    for (const [index, part] of parts.entries()) {
      const next = receiptPart(part.number, previous, part.content);
      rows[index].data = next;
      replace(rows[index]);
      previous = next.digest;
    }
    manifest.digest = previous;
    manifest.verifiedDigest = previous;
    manifest.result!.digest = previous;
    replace(manifestRow);
    const resultRow = stored("RESULT")[0];
    (resultRow.data as c.RestaurantReceiptSummary).digest = previous;
    replace(resultRow);
  }
  test("valid FINAL is deterministic, deeply immutable and performs no writes", async () => {
    const v = await visit(2);
    await settle(v);
    const result = await finish(v.sessionId);
    const before = JSON.stringify([...m.rows]),
      transactions = m.transactions.length;
    const first = await verify(v.sessionId, result.receiptId);
    expect(first.verified).toBe(true);
    if (!first.verified) throw new Error(JSON.stringify(first));
    expect(first.evidence.invoice.invoiceId).toBe(result.receiptId);
    expect(first.evidence.lines).toHaveLength(2);
    expect(first.evidence.lines[0].coordinate).toMatchObject({
      orderId: v.orderId,
      partNumber: 1,
      position: 0,
    });
    expect(Object.isFrozen(first.evidence.parts[0].content)).toBe(true);
    expect(await verify(v.sessionId, result.receiptId)).toEqual(first);
    expect(JSON.stringify([...m.rows])).toBe(before);
    expect(m.transactions.length).toBe(transactions);
    expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
  });
  test("actual multiline multipage service flow reads every part", async () => {
    const v = await visit(130);
    await settle(v);
    const result = await finish(v.sessionId);
    expect(result.partCount).toBeGreaterThan(8);
    const read = jest.spyOn(B, "parts");
    const verified = await verify(v.sessionId, result.receiptId);
    expect(verified.verified).toBe(true);
    if (!verified.verified) throw new Error(JSON.stringify(verified));
    expect(verified.evidence.parts).toHaveLength(result.partCount);
    expect(verified.evidence.lines).toHaveLength(130);
    expect(read.mock.calls.length).toBeGreaterThan(1);
  }, 60000);
  test.each([
    "missing",
    "duplicate",
    "reordered",
    "truncated",
    "loop",
    "cross-page-reference",
  ])("rejects %s pagination without partial evidence", async (defect) => {
    const v = await synthetic(10, 130);
    const result = await finish(v.sessionId);
    const read = B.parts.bind(B);
    let calls = 0;
    jest.spyOn(B, "parts").mockImplementation(async (...args) => {
      const page = await read(...args);
      calls++;
      if (defect === "truncated" && calls === 1) delete page.nextCursor;
      if (calls === 2) {
        if (defect === "missing") page.parts = [];
        if (defect === "duplicate")
          page.parts.unshift(structuredClone(page.parts[0]));
        if (defect === "reordered") page.parts.reverse();
        if (defect === "loop") page.nextCursor = args[4].cursor;
        if (defect === "cross-page-reference")
          page.parts[0] = receiptPart(
            page.parts[0].number,
            "0".repeat(64),
            page.parts[0].content,
          );
      }
      return page;
    });
    expect(await verify(v.sessionId, result.receiptId)).toEqual({
      verified: false,
      denial: { code: "SOURCE_INTEGRITY" },
    });
  });
  test.each([
    "digest",
    "missing-part",
    "extra-part",
    "missing-result",
    "missing-manifest",
    "ownership",
    "missing-snapshot",
  ])("rejects stored %s evidence", async (defect) => {
    const v = await visit(2);
    await settle(v);
    const result = await finish(v.sessionId);
    const part = stored("PART")[0];
    if (defect === "digest")
      (part.data as c.RestaurantReceiptPart).digest = "a".repeat(64);
    if (defect === "ownership") part.orgId = "foreign";
    if (defect === "missing-snapshot") {
      const content = (part.data as c.RestaurantReceiptPart).content;
      if (content.kind === "COMMERCIAL")
        delete (content.lines[0] as Partial<c.RestaurantInvoiceLine>).snapshot;
    }
    replace(part);
    if (defect.startsWith("missing-") && defect !== "missing-snapshot") {
      const row =
        defect === "missing-part"
          ? part
          : stored(defect === "missing-result" ? "RESULT" : "MANIFEST")[0];
      m.rows.delete(JSON.stringify([row.PK, row.SK]));
    }
    if (defect === "extra-part") {
      const next = result.partCount + 1;
      replace({
        ...part,
        SK: K.restaurantBillPartSK(next),
        data: { ...(part.data as object), number: next },
      });
    }
    const denied = await verify(v.sessionId, result.receiptId);
    expect(denied.verified).toBe(false);
    expect(denied).not.toHaveProperty("evidence");
    expect(JSON.stringify(denied)).not.toMatch(
      /PK|SK|org-resto|snapshot|stack/,
    );
  });
  test.each([
    "duplicate-coordinate",
    "foreign-order",
    "amount",
    "coverage",
    "allocation",
    "tender",
  ])("rejects rehashed %s corruption", async (defect) => {
    const v = await visit(2);
    await settle(v);
    const result = await finish(v.sessionId);
    rechain((parts) => {
      const commercial = parts.flatMap((part) =>
        part.content.kind === "COMMERCIAL" ? part.content.lines : [],
      );
      const payments = parts.flatMap((part) =>
        part.content.kind === "SETTLEMENT" ? part.content.payments : [],
      );
      if (defect === "duplicate-coordinate")
        commercial[1].itemId = commercial[0].itemId;
      if (defect === "foreign-order") commercial[0].orderId = id(999);
      if (defect === "amount") commercial[0].netAmountMinor++;
      if (defect === "coverage") {
        const part = parts[0];
        if (part.content.kind === "COMMERCIAL") part.content.lines.pop();
      }
      if (defect === "allocation") payments[0].allocations[0].amountMinor--;
      if (defect === "tender") payments[0].changeMinor!++;
    });
    expect(await verify(v.sessionId, result.receiptId)).toEqual({
      verified: false,
      denial: { code: "SOURCE_INTEGRITY" },
    });
  });
  test("proves exhaustion when an extra part lies beyond the final page boundary", async () => {
    const v = await synthetic(8, 8);
    const result = await finish(v.sessionId);
    expect(result.partCount).toBe(8);
    const part = stored("PART")[0];
    replace({
      ...part,
      SK: K.restaurantBillPartSK(9),
      data: { ...(part.data as object), number: 9 },
    });
    expect(await verify(v.sessionId, result.receiptId)).toEqual({
      verified: false,
      denial: { code: "SOURCE_INTEGRITY" },
    });
  });
  test("rejects an oversized manifest before acquiring parts", async () => {
    const v = await visit();
    await settle(v);
    const result = await finish(v.sessionId);
    const manifestRow = stored("MANIFEST")[0];
    const manifest =
      manifestRow.data as import("@/lambda/domains/restaurants/receipt-model").ReceiptManifest;
    manifest.partCount =
      manifest.verifiedCount =
      manifest.commercialPartCount =
        2049;
    manifest.settlementPartCount = 0;
    manifest.result!.partCount = manifest.result!.commercialPartCount = 2049;
    manifest.result!.settlementPartCount = 0;
    replace(manifestRow);
    const resultRow = stored("RESULT")[0];
    resultRow.data = manifest.result;
    replace(resultRow);
    const read = jest.spyOn(B, "parts");
    expect(await verify(v.sessionId, result.receiptId)).toEqual({
      verified: false,
      denial: { code: "SOURCE_LIMIT" },
    });
    expect(read).not.toHaveBeenCalled();
  });
  test("rejects BUILDING without publishing or completing it", async () => {
    const v = await synthetic(10, 130);
    const original = R.commit.bind(R);
    const stop = jest.spyOn(R, "commit").mockImplementation(async (actions) => {
      await original(actions);
      if (
        actions.some(
          (action) =>
            action.Put?.Item?.entityType?.S === "RESTAURANT_BILL_PART",
        )
      )
        throw new Error("interrupt");
    });
    await expect(finish(v.sessionId)).rejects.toThrow("interrupt");
    stop.mockRestore();
    const invoiceId = (await S.session(scope(), v.sessionId)).data.finalBillId!;
    const before = JSON.stringify([...m.rows]);
    expect(await verify(v.sessionId, invoiceId)).toEqual({
      verified: false,
      denial: { code: "NOT_FINAL" },
    });
    expect(JSON.stringify([...m.rows])).toBe(before);
  });
  test("rejects foreign tenant/outlet, wrong invoice and unauthorized role", async () => {
    const v = await visit();
    await settle(v);
    const result = await finish(v.sessionId);
    for (const foreign of [
      { ...scope(), orgId: "foreign" },
      { ...scope(), outletId: id(999) },
    ]) {
      expect(
        (await Source.verify(foreign, "owner", v.sessionId, result.receiptId))
          .verified,
      ).toBe(false);
    }
    expect(await verify(v.sessionId, id(999))).toEqual({
      verified: false,
      denial: { code: "SOURCE_INTEGRITY" },
    });
    m.seedAccess(org, "waiter", "WAITER");
    expect(await verify(v.sessionId, result.receiptId, "waiter")).toEqual({
      verified: false,
      denial: { code: "ACCESS_DENIED" },
    });
  });
  test("rechecks authorization after pagination and sanitizes read failures", async () => {
    const v = await visit();
    await settle(v);
    const result = await finish(v.sessionId);
    const authorize = Receipt.authorize.bind(Receipt);
    let calls = 0;
    jest.spyOn(Receipt, "authorize").mockImplementation(async (...args) => {
      if (++calls === 2)
        throw new (await import("@/lambda/shared/app-error")).AppError(
          403,
          "PRIVATE_DETAIL",
        );
      return authorize(...args);
    });
    expect(await verify(v.sessionId, result.receiptId)).toEqual({
      verified: false,
      denial: { code: "ACCESS_DENIED" },
    });
    jest.spyOn(B, "get").mockRejectedValue(new Error("AWS secret PK details"));
    expect(await verify(v.sessionId, result.receiptId)).toEqual({
      verified: false,
      denial: { code: "READ_UNAVAILABLE" },
    });
  });
});

test.each(["SYNTHETIC", "AUTHENTIC"] as const)(
  "%s FINAL authority failure rolls back publication atomically",
  async (origin) => {
    const v = await visit();
    await settle(v);
    process.env[origin === "AUTHENTIC" ? "RESTAURANTS_AUTHENTIC_PROVENANCE" : "RESTAURANTS_SYNTHETIC_PROVENANCE"] = "1";
    const prepared = jest.spyOn(Provenance, "prepare").mockResolvedValue([
      {
        ConditionCheck: {
          TableName: "platform",
          Key: marshall({ PK: "synthetic-seller", SK: "CURRENT" }),
          ConditionExpression: "attribute_exists(PK)",
        },
      },
      {
        ConditionCheck: {
          TableName: "restaurants",
          Key: marshall({ PK: "synthetic-timezone", SK: "CURRENT" }),
          ConditionExpression: "attribute_exists(PK)",
        },
      },
      {
        Put: {
          TableName: "restaurants",
          Item: marshall({ PK: "synthetic-provenance", SK: "V1" }),
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
    ]);
    const original = R.commit.bind(R);
    const commit = jest
      .spyOn(R, "commit")
      .mockImplementation(async (actions) => {
        if (
          actions.some(
            (a) => a.Put?.Item?.entityType?.S === "RESTAURANT_BILL_RESULT",
          )
        ) {
          expect(
            actions.filter((a) =>
              a.ConditionCheck?.Key?.PK.S?.startsWith("synthetic-"),
            ),
          ).toHaveLength(2);
          expect(
            actions.some((a) => a.Put?.Item?.PK.S === "synthetic-provenance"),
          ).toBe(true);
          throw new Error("synthetic atomic cancellation");
        }
        return original(actions);
      });
    try {
      await expect(finish(v.sessionId)).rejects.toThrow(
        "synthetic atomic cancellation",
      );
      expect(prepared).toHaveBeenCalled();
      expect(
        [...m.rows.values()].some(
          (row) => row.entityType?.S === "RESTAURANT_BILL_RESULT",
        ),
      ).toBe(false);
    } finally {
      commit.mockRestore();
      prepared.mockRestore();
      delete process.env.RESTAURANTS_SYNTHETIC_PROVENANCE;
      delete process.env.RESTAURANTS_AUTHENTIC_PROVENANCE;
    }
  },
);

// Integrated synthetic path: actual commercial publication and source verification,
// with only persistence transport and DGI HTTP mocked.
test.each(["success", "uncertain-create", "uncertain-confirm"])(
  "FINAL through Benin mapping and durable orchestration: %s",
  async (outcome) => {
    const { PutItemCommand } = await import("@aws-sdk/client-dynamodb");
    const { FiscalAttemptStore } =
      await import("@/lambda/domains/fiscal-compliance/persistence/fiscal-attempt-store");
    const { BeninEMecefTestAdapter } =
      await import("@/lambda/domains/fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter");
    const { bindRestaurantIssuanceProvenance } =
      await import("@/lambda/domains/restaurants/issuance-provenance");
    const { provenance: fixture } = await import("./provenance-fixture");
    const v = await visit();
    await settle(v);
    const invoice = await finish(v.sessionId);
    const manifest = await B.get(
      scope(),
      invoice.receiptId,
      K.restaurantTransactionMetaSK(),
      "MANIFEST",
    );
    if (!manifest) throw new Error("Missing synthetic manifest");
    const { bindingDigest: _binding, ...payload } = fixture;
    const captured = bindRestaurantIssuanceProvenance({
      ...payload,
      ...scope(),
      invoiceId: invoice.receiptId,
      guestSessionId: v.sessionId,
      sourceVersion: manifest.sourceVersion,
      financialRevision: manifest.financialRevision,
      finalManifestVersion: manifest.version,
      issuedAt: invoice.issuedAt,
      capturedAt: invoice.issuedAt,
      commercialRootDigest: invoice.digest,
      actorUserId: "owner",
      seller: {
        ...payload.seller,
        orgId: org,
        seller: {
          name: "Synthetic seller",
          identifiers: [
            { scheme: "IFU", issuingCountry: "BJ", value: "synthetic-ifu" },
          ],
        },
        factStates: [
          ...payload.seller.factStates,
          {
            fieldPath: "identifiers",
            state: "VERIFIED",
            evidenceReference: "synthetic-review",
          },
        ],
      },
      timezone: { ...payload.timezone, orgId: org },
    });
    const provenanceRow = {
      PK: K.restaurantBillPK(org, f.outlet.id, invoice.receiptId),
      SK: K.restaurantIssuanceProvenanceSK(),
      ...scope(),
      invoiceId: invoice.receiptId,
      schemaVersion: 1,
      entityType: "RESTAURANT_INVOICE_ISSUANCE_PROVENANCE",
      data: captured,
    };
    m.rows.set(
      JSON.stringify([provenanceRow.PK, provenanceRow.SK]),
      marshall(provenanceRow),
    );
    const verified = await Source.verify(
      scope(),
      "owner",
      v.sessionId,
      invoice.receiptId,
    );
    if (!verified.verified)
      throw new Error("Synthetic source verification failed");
    const classifications = verified.evidence.lines.map(({ line }) => ({
      orderId: line.orderId,
      itemId: line.itemId,
      taxGroup: "B",
      classificationEvidence: "synthetic-explicit-treatment",
    }));
    const mapping = {
      environment: "TEST",
      invoiceType: "FV",
      priceBasis: "TTC",
      pricingEvidence: "synthetic-price-policy",
      commercialMinorUnitsPerFranc: 1,
      taxGroups: ["B"],
      taxMetadataEvidence: "synthetic-metadata",
      operator: {
        actorId: "owner",
        name: "Synthetic operator",
        evidence: "synthetic-operator-review",
      },
      payments: [
        {
          sourceMethod: "CASH",
          providerMethod: "ESPECES",
          evidence: "synthetic-payment-review",
        },
      ],
    };
    process.env.FISCAL_SYNTHETIC_STORAGE = "1";
    // The existing Restaurants harness supports transactional writes; add the
    // single-item conditional store boundary without bypassing its revision check.
    m.db.on(PutItemCommand).callsFake(async (input) => {
      const row = input.Item!;
      const address = JSON.stringify([row.PK.S, row.SK.S]);
      const prior = m.rows.get(address);
      const expected = input.ExpressionAttributeValues?.[":version"]?.N;
      if (
        expected === undefined ? Boolean(prior) : prior?.version.N !== expected
      )
        throw Object.assign(new Error("synthetic conflict"), {
          name: "ConditionalCheckFailedException",
        });
      m.rows.set(address, row);
      return {};
    });
    const identity = {
      orgId: org,
      environment: "TEST" as const,
      sourceDomain: "restaurants",
      sourceDocumentType: "INVOICE",
      sourceDocumentId: invoice.receiptId,
      jurisdiction: "BJ",
      obligation: "NORMALIZE",
    };
    const principal = { orgId: org, actorId: "owner" };
    const syntheticSecurity = {
      dateTime: "synthetic-date",
      qrCode: "synthetic-qr",
      codeMECeFDGI: "synthetic-code",
      counters: "1/1",
      nim: "synthetic-device",
    };
    const transport = jest.fn(async (request: { method: string }) => {
      if (
        (outcome === "uncertain-create" && request.method === "POST") ||
        (outcome === "uncertain-confirm" && request.method === "PUT")
      )
        throw new Error("synthetic timeout");
      return {
        status: 200,
        body: JSON.stringify(
          request.method === "POST"
            ? { uid: "synthetic-uid", total: invoice.dueMinor }
            : syntheticSecurity,
        ),
      };
    });
    const authorize = async (p: { orgId: string; actorId: string }) => {
      if (p.orgId !== org) throw new Error("foreign tenant");
      await Receipt.authorize(scope(), p.actorId);
    };
    const { restaurantBeninSyntheticWorkflow } =
      await import("@/lambda/domains/restaurants/benin-synthetic-workflow");
    const instance = () =>
      restaurantBeninSyntheticWorkflow({
        outletId: f.outlet.id,
        sessionId: v.sessionId,
        classifications,
        mapping,
        adapter: new BeninEMecefTestAdapter({ transport }),
        credential: () => "synthetic-token",
        authorize,
      });
    try {
      await instance().create(
        principal,
        identity,
        "synthetic-attempt",
        "create",
      );
      if (outcome !== "uncertain-create")
        await instance().confirm(principal, identity, "confirm", {
          confirm: true,
        });
      const state = await new FiscalAttemptStore().read(identity);
      expect(state?.sourceDigest).toBe(invoice.digest);
      expect(state?.status).toBe(
        outcome === "success" ? "CONFIRMED" : "UNKNOWN_OUTCOME",
      );
      if (outcome === "success") {
        expect(state?.security).toEqual(syntheticSecurity);
        expect(state?.securityEvidenceOrigin).toBe("SYNTHETIC");
        expect(state?.providerTotal).toBe(invoice.dueMinor);
      } else expect(state?.security).toBeUndefined();
      await expect(
        instance().create(principal, identity, "replacement", "create-again"),
      ).rejects.toThrow();
      await expect(
        instance().confirm(principal, identity, "confirm-again", {
          confirm: true,
        }),
      ).rejects.toThrow();
      await expect(
        instance().confirm(
          { ...principal, orgId: "foreign" },
          identity,
          "foreign",
          { confirm: true },
        ),
      ).rejects.toThrow();
      expect(transport.mock.calls.map(([r]) => r.method)).toEqual(
        outcome === "uncertain-create" ? ["POST"] : ["POST", "PUT"],
      );
      expect(JSON.stringify(state)).not.toContain("synthetic-token");
    } finally {
      delete process.env.FISCAL_SYNTHETIC_STORAGE;
    }
  },
);

test("authentic FINAL atomically freezes authorities and replays without recapture", async () => {
  const { OrganizationLegalIdentityService: Seller } = await import("@/lambda/shared/services/organization-legal-identity-service");
  const { provenance: fixture } = await import("./provenance-fixture");
  const v = await visit();
  await settle(v);
  process.env.RESTAURANTS_PILOT_PROVENANCE_ORG_ID = org;
  const timezone = { ...fixture.timezone, orgId: org };
  const current = { PK: K.orgKey(org), SK: K.restaurantIssuanceTimezoneCurrentSK(), orgId: org,
    entityType: "RESTAURANTS_ISSUANCE_TIMEZONE_CURRENT", status: "ACTIVE", version: 1,
    selectedRevisionId: timezone.reference, configurationDigest: timezone.configurationDigest,
    approvalReference: timezone.approvalReference, approvalVersion: timezone.approvalVersion };
  const revision = { PK: current.PK, SK: K.restaurantIssuanceTimezoneRevisionSK(timezone.reference),
    ...timezone, revisionId: timezone.reference, recordVersion: 1,
    entityType: "RESTAURANTS_ISSUANCE_TIMEZONE_REVISION" };
  for (const row of [current, revision]) m.rows.set(JSON.stringify([row.PK, row.SK]), marshall(row));
  const sellerKey = { PK: current.PK, SK: "PLATFORM_SELLER_TEST_CURRENT" };
  m.rows.set(JSON.stringify([sellerKey.PK, sellerKey.SK]), marshall({ ...sellerKey, version: 1 }));
  const seller = jest.spyOn(Seller, "readSellerIssuanceAuthority").mockResolvedValue({
    sellerAuthority: { ...fixture.seller, orgId: org },
    check: { ConditionCheck: { TableName: "platform", Key: marshall(sellerKey),
      ConditionExpression: "#f0 = :v0", ExpressionAttributeNames: { "#f0": "version" },
      ExpressionAttributeValues: marshall({ ":v0": 1 }) } },
  });
  try {
    const invoice = await finish(v.sessionId);
    const verified = await Source.verify(scope(), "owner", v.sessionId, invoice.receiptId);
    expect(verified.verified).toBe(true);
    if (!verified.verified) throw new Error("verification failed");
    const provenance = verified.evidence.issuanceProvenance;
    expect(provenance.verified).toBe(true);
    if (!provenance.verified) throw new Error("provenance missing");
    expect(provenance.evidence.evidenceOrigin).toBe("AUTHENTIC");
    expect(provenance.evidence.issuedAt).toBe(invoice.issuedAt);
    expect(provenance.evidence.commercialRootDigest).toBe(invoice.digest);
    expect(verified.evidence.parts.map(({ content }) => content.kind)).toEqual([
      "COMMERCIAL",
      "SETTLEMENT",
    ]);
    expect(verified.evidence.lines).toHaveLength(1);
    expect(verified.evidence.lines[0].coordinate).toMatchObject({
      orderId: v.orderId,
      partNumber: 1,
    });
    expect(verified.evidence.invoice.paidByMethodMinor).toEqual({
      CASH: verified.evidence.invoice.dueMinor,
      MOBILE_MONEY: 0,
      CARD: 0,
    });
    const { prepareRestaurantFiscalInvoice } = await import(
      "@/lambda/domains/restaurants/fiscal-preparation"
    );
    const preparationInput = {
      scope: scope(),
      actorId: "owner",
      sessionId: v.sessionId,
      invoiceId: invoice.receiptId,
      classifications: [{
        orderId: v.orderId,
        itemId: verified.evidence.lines[0].line.itemId,
        taxGroup: "B",
        classificationEvidence: "offline-fixture-only",
      }],
    };
    expect(await prepareRestaurantFiscalInvoice(preparationInput)).toMatchObject({
      ready: true,
      preparation: {
        currency: "XOF",
        commercialRootDigest: invoice.digest,
        totalMinor: String(verified.evidence.invoice.paidMinor),
        providerMutationEnabled: false,
      },
    });
    expect(await prepareRestaurantFiscalInvoice({ ...preparationInput, classifications: [] })).toEqual({
      ready: false,
      reason: "MISSING_FISCAL_CLASSIFICATION",
    });
    seller.mockClear();
    delete process.env.RESTAURANTS_PILOT_PROVENANCE_ORG_ID;
    expect(await finish(v.sessionId)).toEqual(invoice);
    expect(seller).not.toHaveBeenCalled();
  } finally { seller.mockRestore(); delete process.env.RESTAURANTS_PILOT_PROVENANCE_ORG_ID; }
});
