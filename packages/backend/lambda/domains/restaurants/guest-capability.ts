import { randomBytes, hkdfSync } from "crypto";
import { EncryptJWT, jwtDecrypt, errors } from "jose";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { z } from "zod";

const secrets = new SecretsManagerClient({});
const ClaimsSchema = z
  .object({
    kind: z.literal("GUEST"),
    v: z.literal(1),
    environment: z.string().min(1),
    aud: z.literal("restaurants-guest"),
    usage: z.literal("guest-capability"),
    guestHandle: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
    orgId: z.string().min(1),
    restaurantId: z.string().uuid(),
    outletId: z.string().uuid(),
    areaId: z.string().uuid(),
    tableId: z.string().uuid(),
    qrFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    sessionId: z.string().uuid().optional(),
    rights: z.array(z.enum(["CARTE_READ", "CALL_WAITER", "ORDER_SUBMIT"])),
    enteredAt: z.number().int().nonnegative(),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const ttl = c.sessionId ? 1800 : 600;
    if (
      c.exp <= c.iat ||
      c.exp - c.iat > ttl ||
      c.enteredAt > c.iat ||
      c.exp > c.enteredAt + (c.sessionId ? 28800 : 600) ||
      (!c.sessionId && c.rights.includes("ORDER_SUBMIT"))
    )
      ctx.addIssue({ code: "custom", message: "Invalid capability scope" });
  });
export type GuestPrincipal = z.infer<typeof ClaimsSchema>;
export class GuestCapabilityExpired extends Error {}
let cached: { key: Uint8Array; until: number; secretId: string } | undefined;
export async function capabilityKey(): Promise<Uint8Array> {
  const secretId = process.env.RESTAURANTS_GUEST_SECRET_ARN;
  if (!secretId) throw new Error("Guest protection unavailable");
  if (cached?.secretId === secretId && cached.until > Date.now())
    return cached.key;
  const value = await secrets.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  const secret = z
    .object({ key: z.string().min(64).max(128) })
    .strict()
    .parse(JSON.parse(value.SecretString ?? "{}"));
  const key = new Uint8Array(
    hkdfSync(
      "sha256",
      Buffer.from(secret.key),
      Buffer.from("restaurants-guest-v1"),
      Buffer.from("capability"),
      32,
    ),
  );
  cached = { key, secretId, until: Date.now() + 60_000 };
  return key;
}
export const newGuestHandle = () => randomBytes(16).toString("base64url");
export async function sealGuest(claims: GuestPrincipal): Promise<string> {
  const parsed = ClaimsSchema.parse(claims);
  return new EncryptJWT(parsed)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "resto-guest+jwt" })
    .encrypt(await capabilityKey());
}
export async function openGuest(token: string): Promise<GuestPrincipal> {
  try {
    const { payload, protectedHeader } = await jwtDecrypt(
      token,
      await capabilityKey(),
      {
        keyManagementAlgorithms: ["dir"],
        contentEncryptionAlgorithms: ["A256GCM"],
        audience: "restaurants-guest",
        typ: "resto-guest+jwt",
        requiredClaims: ["iat", "exp"],
      },
    );
    if (protectedHeader.alg !== "dir" || protectedHeader.enc !== "A256GCM")
      throw new Error("Invalid capability");
    const principal = ClaimsSchema.parse(payload);
    if (
      !process.env.STAGE ||
      principal.environment !== process.env.STAGE ||
      principal.iat > Math.floor(Date.now() / 1000) + 5
    )
      throw new Error("Invalid capability");
    return principal;
  } catch (error) {
    if (error instanceof errors.JWTExpired) throw new GuestCapabilityExpired();
    throw new Error("Invalid capability");
  }
}
