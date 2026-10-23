import { z } from "zod";

const reference = z.string().min(16).max(4096);
export const GuestCarteItemSchema = z
  .object({
    reference,
    selectionRef: reference,
    name: z.string().min(1).max(160),
    amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    availability: z.enum(["AVAILABLE", "UNAVAILABLE"]),
  })
  .strict();
export const GuestCarteResponseSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("READY"),
      currency: z.string().regex(/^[A-Z]{3}$/),
      referencesExpireAt: z.iso.datetime(),
      categories: z
        .array(
          z
            .object({
              reference,
              name: z.string().min(1).max(160),
              position: z.number().int().nonnegative(),
              items: z.array(GuestCarteItemSchema).max(500),
            })
            .strict(),
        )
        .max(500),
      nextCursor: reference.optional(),
    })
    .strict(),
  z
    .object({
      state: z.enum(["NO_MENU", "UNAVAILABLE", "EXPIRED", "VISIT_ENDED"]),
    })
    .strict(),
]);
export type GuestCarteResponse = z.infer<typeof GuestCarteResponseSchema>;
export type GuestCarte = Extract<GuestCarteResponse, { state: "READY" }>;
