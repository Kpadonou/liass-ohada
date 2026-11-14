import { describe, expect, it } from 'vitest';

import { LIASS_BRAND } from './liass-brand-assets';

describe('LIASS_BRAND', () => {
  it('keeps every logo variant mapped to its light and dark PNG assets', () => {
    expect(LIASS_BRAND.logo).toEqual({
      light: '/assets/brand/liass-ohada/logos/logo-horizontal-navy-gold.png',
      dark: '/assets/brand/liass-ohada/logos/logo-horizontal-white-gold.png',
    });
    expect(LIASS_BRAND.monogram).toEqual({
      light: '/assets/brand/liass-ohada/logos/monogram-navy-gold.png',
      dark: '/assets/brand/liass-ohada/logos/monogram-white-gold.png',
    });
    expect(LIASS_BRAND.stacked).toEqual({
      light: '/assets/brand/liass-ohada/logos/logo-stacked-navy-gold.png',
      dark: '/assets/brand/liass-ohada/logos/logo-stacked-white-gold.png',
    });
  });

  it('retains the browser and social metadata asset references', () => {
    expect(LIASS_BRAND.favicon).toBe('/assets/brand/liass-ohada/icons/favicon.ico');
    expect(LIASS_BRAND.favicon16).toBe('/assets/brand/liass-ohada/icons/favicon-16x16.png');
    expect(LIASS_BRAND.favicon32).toBe('/assets/brand/liass-ohada/icons/favicon-32x32.png');
    expect(LIASS_BRAND.appleTouchIcon).toBe(
      '/assets/brand/liass-ohada/icons/apple-touch-icon.png',
    );
    expect(LIASS_BRAND.manifest).toBe('/assets/brand/liass-ohada/site.webmanifest');
    expect(LIASS_BRAND.socialImage).toBe(
      '/assets/brand/liass-ohada/social/og-image-light-1200x630.png',
    );
  });
});
