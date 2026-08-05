import { environment } from '../../../environments/environment';

const appBaseUrl = environment.publicSite.appBaseUrl.replace(/\/$/, '');

export const publicSiteConfig = {
  ...environment.publicSite,
  appBaseUrl,
  signupUrl: `${appBaseUrl}/signup`,
  loginUrl: `${appBaseUrl}/login`
} as const;

export function isPublicSiteHost(
  hostname = globalThis.location?.hostname ?? '',
  applicationHostname = new URL(publicSiteConfig.appBaseUrl).hostname
): boolean {
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') {
    return true;
  }

  try {
    return hostname !== applicationHostname;
  } catch {
    return true;
  }
}
