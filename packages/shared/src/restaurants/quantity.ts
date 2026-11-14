import { z } from "zod";

export const RESTAURANT_QUANTITY_SCALE = 1000;

export function restaurantQuantityToMilli(value: number): number {
  if (!Number.isFinite(value) || value < 0)
    throw new Error("INVALID_RESTAURANT_QUANTITY");
  const fixed = value.toFixed(3);
  if (Number(fixed) !== value) throw new Error("INVALID_RESTAURANT_QUANTITY");
  const milli = Number(fixed.replace(".", ""));
  if (!Number.isSafeInteger(milli))
    throw new Error("INVALID_RESTAURANT_QUANTITY");
  return milli;
}

export const RestaurantNonnegativeQuantitySchema = z
  .number()
  .nonnegative()
  .refine((value) => {
    try {
      restaurantQuantityToMilli(value);
      return true;
    } catch {
      return false;
    }
  }, "Quantity must have at most three decimal places");
export const RestaurantQuantitySchema =
  RestaurantNonnegativeQuantitySchema.positive();

export function restaurantQuantityFromMilli(value: number | bigint): number {
  const milli = typeof value === "bigint" ? value : BigInt(value);
  if (milli < 0n || milli > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("INVALID_RESTAURANT_QUANTITY");
  return RestaurantNonnegativeQuantitySchema.parse(
    Number(milli) / RESTAURANT_QUANTITY_SCALE,
  );
}

export function restaurantQuantityAmountMinor(
  unitAmountMinor: number,
  quantity: number,
): number {
  if (!Number.isSafeInteger(unitAmountMinor) || unitAmountMinor < 0)
    throw new Error("INVALID_RESTAURANT_AMOUNT");
  const numerator =
    BigInt(unitAmountMinor) * BigInt(restaurantQuantityToMilli(quantity));
  const amount = (numerator + 500n) / 1000n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("INVALID_RESTAURANT_AMOUNT");
  return Number(amount);
}
