import * as c from "@liass-ohada/shared/restaurants";
import { fixtureId } from "./memory-dynamo";
const base = { clientRequestId: fixtureId(1), name: "Héritage Bistro" };
describe("RESTO-1 strict public contracts", () => {
  test.each(["DISABLED", "STAFF_APPROVAL", "DIRECT"])(
    "policy %s is canonical",
    (value) => expect(c.GuestOrderingPolicySchema.parse(value)).toBe(value),
  );
  test.each(["ENABLED", "APPROVAL", "AUTO", "staff_approval"])(
    "rejects policy alias %s",
    (value) =>
      expect(c.GuestOrderingPolicySchema.safeParse(value).success).toBe(false),
  );
  test("defaults and normalized table code", () => {
    expect(
      c.CreateRestaurantRequestSchema.parse(base).guestOrderingPolicy,
    ).toBe("STAFF_APPROVAL");
    expect(c.RestaurantTableCodeSchema.parse(" t01 ")).toBe("T01");
    expect(
      c.CreateMenuItemRequestSchema.parse({
        ...base,
        price: { amountMinor: 0, currency: "XOF" },
      }),
    ).toMatchObject({ availability: "AVAILABLE", guestReorderEnabled: false });
  });
  test.each([-1, 0.1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])(
    "rejects invalid minor price %s",
    (amountMinor) =>
      expect(
        c.MenuPriceSchema.safeParse({ amountMinor, currency: "XOF" }).success,
      ).toBe(false),
  );
  test.each(["xof", "EURO", "", "X0F"])("rejects currency %s", (currency) =>
    expect(
      c.MenuPriceSchema.safeParse({ amountMinor: 500, currency }).success,
    ).toBe(false),
  );
  test.each(["", "not-an-id", "ORG#secret"])("rejects ID %s", (value) =>
    expect(c.RestaurantIdSchema.safeParse(value).success).toBe(false),
  );
  test.each(["", " ", "a".repeat(161)])("rejects name %s", (name) =>
    expect(
      c.CreateOutletRequestSchema.safeParse({ ...base, name }).success,
    ).toBe(false),
  );
  test.each(["", "T 01", "TABLE#01", "a".repeat(33)])(
    "rejects table code %s",
    (value) =>
      expect(c.RestaurantTableCodeSchema.safeParse(value).success).toBe(false),
  );
  test.each([0, -1, 1.5, 1001])("rejects capacity %s", (value) =>
    expect(c.RestaurantTableCapacitySchema.safeParse(value).success).toBe(
      false,
    ),
  );
  test.each([
    "PK",
    "SK",
    "GSI1PK",
    "entityType",
    "orgId",
    "outletId",
    "unexpected",
  ])("rejects leaked/input field %s", (field) => {
    expect(
      c.CreateRestaurantRequestSchema.safeParse({ ...base, [field]: "secret" })
        .success,
    ).toBe(false);
    expect(
      c.RestaurantSchema.safeParse({
        id: fixtureId(1),
        name: "Restaurant",
        isActive: true,
        version: 1,
        createdAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:00:00.000Z",
        guestOrderingPolicy: "STAFF_APPROVAL",
        [field]: "secret",
      }).success,
    ).toBe(false);
  });
  test("availability and reorder types are strict", () => {
    expect(c.MenuItemAvailabilitySchema.safeParse("DISABLED").success).toBe(
      false,
    );
    expect(
      c.CreateMenuItemRequestSchema.safeParse({
        ...base,
        price: { amountMinor: 500, currency: "XOF" },
        guestReorderEnabled: "true",
      }).success,
    ).toBe(false);
    expect(
      c.UpdateMenuItemRequestSchema.safeParse({ expectedVersion: 1 }).success,
    ).toBe(false);
  });
});

test("pre-service contracts expose intent state without tenant/session selectors", () => {
  const request = c.GuestOrderRequestSchema.parse({
    requestId: "00000000-0000-4000-8000-000000000001",
    state: "PENDING_SERVICE",
    submittedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 900000).toISOString(),
    lines: [
      { name: "Eau", quantity: 1, note: "", amountMinor: 500, currency: "XOF" },
    ],
  });
  expect(request.state).toBe("PENDING_SERVICE");
  expect(
    c.GuestOrderRequestSchema.safeParse({
      ...request,
      sessionId: "00000000-0000-4000-8000-000000000002",
    }).success,
  ).toBe(false);
  expect(
    c.GuestResolveRequestSchema.safeParse({
      token: "A".repeat(43),
      previousCapability: "c".repeat(100),
    }).success,
  ).toBe(true);
  expect(
    c.GuestResolveRequestSchema.safeParse({
      token: "A".repeat(43),
      guestHandle: "a".repeat(22),
    }).success,
  ).toBe(false);
});
