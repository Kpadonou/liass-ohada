/** Only the existing permanent-QR route selects the minimal public bootstrap. */
export const isGuestEntryPath = (pathname: string) => /^\/g\/[^/]+\/?$/.test(pathname);
