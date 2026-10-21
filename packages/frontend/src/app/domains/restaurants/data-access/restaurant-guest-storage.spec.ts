import { guestStorageKey, readGuest, writeGuest } from './restaurant-guest-storage';
describe('Tab-only Guest context', () => {
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  it('isolates QR contexts, stores only capability metadata and survives refresh', async () => {
    const a = await guestStorageKey('a'.repeat(43)),
      b = await guestStorageKey('b'.repeat(43));
    expect(a).not.toBe(b);
    expect(a).not.toContain('a'.repeat(43));
    const value = {
      guestHandle: 'a'.repeat(22),
      capability: 'c'.repeat(100),
      expiresAt: new Date().toISOString(),
    };
    writeGuest(a, value);
    expect(readGuest(a)).toEqual(value);
    expect(readGuest(b)).toBeUndefined();
    expect(
      Object.keys(localStorage).some((key) => key.startsWith('liass-restaurants.guest.')),
    ).toBe(false);
    writeGuest(a);
    expect(readGuest(a)).toBeUndefined();
  });
  it('does not trust malformed tab data', () => {
    sessionStorage.setItem('test', '{"role":"OWNER"}');
    expect(readGuest('test')).toBeUndefined();
  });
});
