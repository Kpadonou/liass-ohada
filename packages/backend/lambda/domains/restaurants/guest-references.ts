import { createHmac, hkdfSync } from "crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";
import { capabilityKey, GuestPrincipal } from "./guest-capability";

const scope = (p: GuestPrincipal) =>
  JSON.stringify([
    p.environment,
    p.orgId,
    p.restaurantId,
    p.outletId,
    p.areaId,
    p.tableId,
    p.qrFingerprint,
    p.sessionId ?? null,
    p.guestHandle,
  ]);
const key = async (usage: string) =>
  new Uint8Array(
    hkdfSync(
      "sha256",
      await capabilityKey(),
      "restaurants-guest-references-v1",
      usage,
      32,
    ),
  );
const ReferenceSchema = z
  .object({
    v: z.literal(1),
    aud: z.literal("restaurants-guest-reference"),
    usage: z.enum(["selection", "continuation"]),
    binding: z.string(),
    environment: z.string(),
    iat: z.number().int(),
    exp: z.number().int(),
    value: z.string().max(2048),
  })
  .strict()
  .refine((c) => c.exp > c.iat && c.exp - c.iat === 900);
export async function publicReference(p: GuestPrincipal, value: string) {
  return createHmac("sha256", await key("public-reference"))
    .update(scope(p))
    .update(value)
    .digest("base64url");
}
export async function sealReference(
  p: GuestPrincipal,
  usage: "selection" | "continuation",
  value: string,
  window: number,
) {
  return new EncryptJWT(
    ReferenceSchema.parse({
      v: 1,
      aud: "restaurants-guest-reference",
      usage,
      environment: p.environment,
      binding: await publicReference(p, "context"),
      value,
      iat: window,
      exp: window + 900,
    }),
  )
    .setProtectedHeader({
      alg: "dir",
      enc: "A256GCM",
      typ: "resto-" + usage + "+jwt",
    })
    .encrypt(await key(usage));
}
/** Future commands must also compare the enclosed configuration with canonical data. */
export async function openReference(
  p: GuestPrincipal,
  usage: "selection" | "continuation",
  token: string,
) {
  const { payload } = await jwtDecrypt(token, await key(usage), {
    keyManagementAlgorithms: ["dir"],
    contentEncryptionAlgorithms: ["A256GCM"],
    audience: "restaurants-guest-reference",
    typ: "resto-" + usage + "+jwt",
    requiredClaims: ["iat", "exp"],
  });
  const c = ReferenceSchema.parse(payload);
  if (
    c.usage !== usage ||
    c.environment !== process.env.STAGE ||
    c.environment !== p.environment ||
    c.binding !== (await publicReference(p, "context")) ||
    c.iat > Math.floor(Date.now() / 1000) + 5
  )
    throw new Error("Invalid reference");
  return c;
}
