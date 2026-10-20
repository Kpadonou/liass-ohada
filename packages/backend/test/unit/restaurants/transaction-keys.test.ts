import { KeyFactory as K } from "@/lambda/shared/key-builder";
const org = "org-test",
  outlet = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  timestamp = "2026-10-12T09:30:00.000Z",
  hash = "a".repeat(64);
const scope = `ORG#${org}#OUT#${outlet}`;
test("every LR-TX-1 key follows the frozen dictionary", () => {
  expect(K.restaurantTransactionScope(org, outlet)).toBe(scope);
  expect(K.restaurantSessionPK(org, outlet, id)).toBe(`${scope}#GS#${id}`);
  expect(K.restaurantOrderPK(org, outlet, id)).toBe(`${scope}#ORD#${id}`);
  expect(K.restaurantOccupancyPK(org, outlet, id)).toBe(`${scope}#TABLE#${id}`);
  expect(K.restaurantTransactionMetaSK()).toBe("META");
  expect(K.restaurantOccupancySK()).toBe("ACTIVE");
  expect(K.restaurantOrderItemPrefix()).toBe("OI#");
  expect(K.restaurantOrderItemSK(id)).toBe(`OI#${id}`);
  expect(K.restaurantSubmissionSK(id)).toBe(`SUB#${id}`);
  expect(K.restaurantTransactionLocatorSK(timestamp, id)).toBe(
    `${timestamp}#${id}`,
  );
  expect(K.restaurantSessionOrderSK(timestamp, id)).toBe(
    `ORD#${timestamp}#${id}`,
  );
  expect(K.restaurantSessionOrderSK(timestamp, id, true)).toBe(
    `OPENORD#${timestamp}#${id}`,
  );
  expect(K.restaurantTransactionAuditSK(timestamp, id)).toBe(
    `EVT#${timestamp}#${id}`,
  );
  for (const kind of ["GS", "ORD", "UNPAID"] as const)
    expect(K.restaurantTransactionActivePK(org, outlet, kind)).toBe(
      `${scope}#ACTIVE#${kind}`,
    );
  expect(K.restaurantWaiterActivePK(org, outlet, "waiter")).toBe(
    `${scope}#WAITER#waiter#ACTIVE`,
  );
  for (const kind of ["GS", "ORD", "ACT"] as const)
    expect(
      K.restaurantTransactionHistoryPK(org, outlet, kind, "20261012"),
    ).toBe(`${scope}#HIST#${kind}#20261012`);
  expect(
    K.restaurantTransactionHistoryPK(org, outlet, "GS", "20261012", id),
  ).toBe(`${scope}#TABLE#${id}#HIST#GS#20261012`);
  expect(
    K.restaurantTransactionCommandPK(org, outlet, "CREATE_ORDER", "NEW", hash),
  ).toBe(`${scope}#CMD#CREATE_ORDER#NEW#${hash}`);
  expect(K.restaurantTransactionCommandSK("NEW", hash)).toBe("IDEM");
  expect(
    K.restaurantTransactionCommandPK(org, outlet, "SUBMIT_ORDER", id, hash),
  ).toBe(`${scope}#CMD#SUBMIT_ORDER#${id}`);
  expect(K.restaurantTransactionCommandSK(id, hash)).toBe(`IDEM#${hash}`);
  expect(
    K.restaurantTransactionCommandPK(org, outlet, "CREATE_ORDER", "NEW", hash),
  ).not.toBe(
    K.restaurantTransactionCommandPK(
      org,
      outlet,
      "CREATE_ORDER",
      "NEW",
      "b".repeat(64),
    ),
  );
});
test.each(["evil#OUT#other", "", "../foreign", "a b", "a\n"])(
  "invalid scoped segment %p is rejected",
  (segment) => {
    expect(() => K.restaurantTransactionScope(segment, outlet)).toThrow();
    expect(() => K.restaurantSessionPK(org, outlet, segment)).toThrow();
    expect(() => K.restaurantWaiterActivePK(org, outlet, segment)).toThrow();
    expect(() => K.restaurantPreparationSK(id, segment)).toThrow();
    expect(() => K.restaurantWorkPK(org, outlet, segment, "READY")).toThrow();
  },
);
test("preparation uses the frozen per-fire Order and station/state base-table shapes", () => {
  expect(K.restaurantPreparationSK(id, id)).toBe(`PREP#${id}#${id}`);
  expect(K.restaurantPreparationPrefix()).toBe("PREP#");
  expect(K.restaurantWorkPK(org, outlet, id, "READY")).toBe(
    `${scope}#WORK#${id}#READY`,
  );
  expect(K.restaurantWorkSK(timestamp, id, id, id)).toBe(
    `${timestamp}#${id}#${id}#${id}`,
  );
});
test.each(["20261301", "20260231", "2026101", "2026#1012"])(
  "invalid history bucket %p is rejected",
  (bucket) =>
    expect(() =>
      K.restaurantTransactionHistoryPK(org, outlet, "GS", bucket),
    ).toThrow(),
);
test.each([
  "2026-02-31T00:00:00.000Z",
  "2026-10-12",
  "2026-10-12T00:00:00Z",
  "wrong",
])("invalid ordering timestamp %p is rejected", (value) =>
  expect(() => K.restaurantTransactionLocatorSK(value, id)).toThrow(),
);

test("receipt uses frozen BILL manifest/ordered part and owner command keys", () => {
  expect(K.restaurantBillPK(org, outlet, id)).toBe(`${scope}#BILL#${id}`);
  expect(K.restaurantBillPartPrefix()).toBe("PART#");
  expect(K.restaurantBillPartSK(1)).toBe("PART#000001");
  expect(K.restaurantBillPartSK(650)).toBe("PART#000650");
  expect(K.restaurantBillResultSK()).toBe("RESULT");
  expect(
    K.restaurantTransactionCommandPK(org, outlet, "PUBLISH_RECEIPT", id, hash),
  ).toBe(`${scope}#CMD#PUBLISH_RECEIPT#${id}`);
  for (const number of [0, -1, 1.5, 20001, NaN])
    expect(() => K.restaurantBillPartSK(number)).toThrow();
});
