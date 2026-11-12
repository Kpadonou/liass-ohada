import { Component, computed, input, signal } from '@angular/core';

import { LIASS_BRAND } from '../../branding/liass-brand-assets';

export type LiassLogoSize = 'sm' | 'md' | 'lg';
export type LiassLogoTheme = 'light' | 'dark' | 'auto';
export type LiassLogoVariant = 'horizontal' | 'vertical' | 'icon';

type LogoDimensions = { height: number; width: number };

const brandAssets = {
  horizontal: LIASS_BRAND.logo,
  icon: LIASS_BRAND.monogram,
  vertical: LIASS_BRAND.stacked,
} satisfies Record<LiassLogoVariant, { light: string; dark: string }>;

const dimensions: Record<LiassLogoVariant, { light: LogoDimensions; dark: LogoDimensions }> = {
  horizontal: {
    light: { height: 944, width: 1377 },
    dark: { height: 661, width: 2158 },
  },
  icon: {
    light: { height: 861, width: 1139 },
    dark: { height: 1061, width: 1226 },
  },
  vertical: {
    light: { height: 783, width: 1175 },
    dark: { height: 1057, width: 1438 },
  },
};

const sizeClasses: Record<LiassLogoVariant, Record<LiassLogoSize, string>> = {
  horizontal: {
    sm: 'h-12 w-auto',
    md: 'h-14 w-auto',
    lg: 'h-20 w-auto',
  },
  icon: {
    sm: 'size-9',
    md: 'size-11',
    lg: 'size-16',
  },
  vertical: {
    sm: 'h-12 w-14',
    md: 'h-16 w-[4.75rem]',
    lg: 'h-24 w-28',
  },
};

@Component({
  selector: 'liass-logo',
  templateUrl: './liass-logo.component.html',
})
export class LiassLogoComponent {
  readonly alt = input('liass-ohada logo');
  readonly fallbackText = input('Liass-OHADA');
  readonly size = input<LiassLogoSize>('md');
  readonly theme = input<LiassLogoTheme>('auto');
  readonly variant = input<LiassLogoVariant>('horizontal');

  protected readonly hasImageError = signal(false);

  protected readonly containerClass = computed(
    () =>
      `inline-flex shrink-0 items-center justify-center ${sizeClasses[this.variant()][this.size()]}`,
  );
  protected readonly imageClass = computed(() =>
    this.variant() === 'horizontal'
      ? 'block h-full w-auto max-w-none object-contain'
      : 'block h-full w-full object-contain',
  );

  protected readonly lightBackgroundAsset = computed(() => ({
    source: brandAssets[this.variant()].light,
    ...dimensions[this.variant()].light,
  }));
  protected readonly darkBackgroundAsset = computed(() => ({
    source: brandAssets[this.variant()].dark,
    ...dimensions[this.variant()].dark,
  }));
  protected readonly selectedAsset = computed(() =>
    this.theme() === 'light' ? this.darkBackgroundAsset() : this.lightBackgroundAsset(),
  );

  protected handleImageError(): void {
    this.hasImageError.set(true);
  }
}
