import { isPublicSiteHost, publicSiteConfig } from './public-site.config';

describe('public site configuration', () => {
  it('keeps application CTAs centralized and free of waitlist routes', () => {
    expect(publicSiteConfig.signupUrl).toBe(`${publicSiteConfig.appBaseUrl}/signup`);
    expect(publicSiteConfig.loginUrl).toBe(`${publicSiteConfig.appBaseUrl}/login`);
    expect(publicSiteConfig.signupUrl).not.toContain('waitlist');
  });

  it('shows the landing on the public and local hosts', () => {
    expect(isPublicSiteHost('liassohada.com')).toBe(true);
    expect(isPublicSiteHost('www.liassohada.com')).toBe(true);
    expect(isPublicSiteHost('localhost')).toBe(true);
  });

  it('preserves the existing application root behavior on the app host', () => {
    expect(isPublicSiteHost('app.liassohada.com', 'app.liassohada.com')).toBe(false);
  });
});
