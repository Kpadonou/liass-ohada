import { Component, computed, input, signal } from '@angular/core';

export type LiassLogoSize = 'sm' | 'md' | 'lg';
export type LiassLogoTheme = 'light' | 'dark' | 'auto';
export type LiassLogoVariant = 'horizontal' | 'vertical' | 'icon';

const logoBasePath = '/assets/brand/logos';

const dimensions: Record<
  LiassLogoVariant,
  Record<Exclude<LiassLogoTheme, 'auto'>, { height: number; width: number }>
> = {
  horizontal: {
    dark: { height: 400, width: 1323 },
    light: { height: 440, width: 1375 }
  },
  icon: {
    dark: { height: 720, width: 833 },
    light: { height: 706, width: 820 }
  },
  vertical: {
    dark: { height: 776, width: 906 },
    light: { height: 724, width: 884 }
  }
};

const sizeClasses: Record<LiassLogoVariant, Record<LiassLogoSize, string>> = {
  horizontal: {
    sm: 'h-10 w-40',
    md: 'h-12 w-48',
    lg: 'h-20 w-72'
  },
  icon: {
    sm: 'size-9',
    md: 'size-11',
    lg: 'size-16'
  },
  vertical: {
    sm: 'h-12 w-14',
    md: 'h-16 w-[4.75rem]',
    lg: 'h-24 w-28'
  }
};

function logoSource(variant: LiassLogoVariant, theme: Exclude<LiassLogoTheme, 'auto'>): string {
  return `${logoBasePath}/liass-${variant}-${theme}.png`;
}

@Component({
  selector: 'liass-logo',
  templateUrl: './liass-logo.component.html'
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
      `inline-flex shrink-0 items-center justify-center overflow-hidden ${sizeClasses[this.variant()][this.size()]}`
  );

  protected readonly darkDimensions = computed(() => dimensions[this.variant()].dark);
  protected readonly lightDimensions = computed(() => dimensions[this.variant()].light);
  protected readonly singleDimensions = computed(() =>
    this.theme() === 'light' ? this.lightDimensions() : this.darkDimensions()
  );
  protected readonly darkSource = computed(() => logoSource(this.variant(), 'dark'));
  protected readonly lightSource = computed(() => logoSource(this.variant(), 'light'));
  protected readonly singleSource = computed(() =>
    this.theme() === 'light' ? this.lightSource() : this.darkSource()
  );

  protected handleImageError(): void {
    this.hasImageError.set(true);
  }
}
