import { GuestCapabilitySchema } from '@liass-ohada/shared/restaurants';
import { z } from 'zod';
const Stored = z
  .object({
    guestHandle: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
    capability: GuestCapabilitySchema,
    expiresAt: z.string().datetime(),
  })
  .strict();
/** Tab-only, fingerprint-scoped; no tokens in storage keys or URLs. */
export async function guestStorageKey(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return (
    'liass-restaurants.guest.' +
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  );
}
export function readGuest(key: string) {
  try {
    const parsed = Stored.safeParse(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
export function writeGuest(key: string, value?: z.infer<typeof Stored>) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(Stored.parse(value)));
    else sessionStorage.removeItem(key);
  } catch {
    /* Browsing remains possible if tab storage is disabled. */
  }
}
