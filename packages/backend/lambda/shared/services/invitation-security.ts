import { createHash, randomBytes } from "crypto";

/** Shared cryptographic primitives; Cabinet and COMPANY keep their own lifecycle/storage. */
export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
export function newInvitationToken() {
  const rawToken = randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashInvitationToken(rawToken) };
}
