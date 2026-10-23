import { isGuestEntryPath } from './guest-entry';
describe('Guest-only bootstrap selection', () => {
  it.each(['/g/opaque', '/g/opaque/', '/g/invalid-token'])('uses public startup for %s', (path) =>
    expect(isGuestEntryPath(path)).toBe(true),
  );
  it.each([
    '/',
    '/login',
    '/auth/callback',
    '/select-workspace',
    '/restaurants',
    '/accounting',
    '/sales',
    '/g',
    '/g/token/extra',
  ])('preserves staff startup for %s', (path) => expect(isGuestEntryPath(path)).toBe(false));
});
