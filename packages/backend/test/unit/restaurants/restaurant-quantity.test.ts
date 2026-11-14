import {
  restaurantQuantityAmountMinor,
  restaurantQuantityFromMilli,
  restaurantQuantityToMilli,
  RestaurantQuantitySchema,
} from "@liass-ohada/shared/restaurant-quantity";

describe("restaurant decimal quantity arithmetic", () => {
  test.each([
    [2.5, 2500],
    [3.25, 3250],
    [3, 3000],
  ])("normalizes %s without truncation", (quantity, milli) => {
    expect(restaurantQuantityToMilli(quantity)).toBe(milli);
    expect(restaurantQuantityFromMilli(milli)).toBe(quantity);
    expect(RestaurantQuantitySchema.parse(quantity)).toBe(quantity);
  });

  test.each([
    [2360, 2.5, 5900],
    [1180, 3.25, 3835],
    [2000, 3, 6000],
    [1, 2.5, 3],
  ])("rounds %s × %s once to XOF %s", (unit, quantity, amount) => {
    expect(restaurantQuantityAmountMinor(unit, quantity)).toBe(amount);
  });

  test("fails closed beyond the supported fixed scale", () => {
    expect(() => restaurantQuantityToMilli(1.0001)).toThrow(
      "INVALID_RESTAURANT_QUANTITY",
    );
    expect(RestaurantQuantitySchema.safeParse(1.0001).success).toBe(false);
  });
});
