import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LiassLogoComponent } from './liass-logo.component';

describe('LiassLogoComponent', () => {
  let fixture: ComponentFixture<LiassLogoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LiassLogoComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(LiassLogoComponent);
  });

  it('renders the complete horizontal asset at its original aspect ratio', () => {
    fixture.componentRef.setInput('variant', 'horizontal');
    fixture.componentRef.setInput('size', 'sm');
    fixture.componentRef.setInput('theme', 'light');
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const logo = host.querySelector('span');
    const image = host.querySelector('img');

    expect(logo?.className).toContain('h-12');
    expect(logo?.className).toContain('w-auto');
    expect(logo?.className).not.toContain('overflow-hidden');
    expect(image?.getAttribute('src')).toBe(
      '/assets/brand/liass-ohada/logos/logo-horizontal-white-gold.png',
    );
    expect(image?.getAttribute('width')).toBe('2158');
    expect(image?.getAttribute('height')).toBe('661');
    expect(image?.className).toContain('w-auto');
    expect(image?.className).toContain('max-w-none');
  });

  it('keeps the icon variant image-only', () => {
    fixture.componentRef.setInput('variant', 'icon');
    fixture.componentRef.setInput('theme', 'dark');
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const icon = host.querySelector('img');

    expect(host.textContent).not.toContain('Liass-Ohada');
    expect(icon?.getAttribute('src')).toBe(
      '/assets/brand/liass-ohada/logos/monogram-navy-gold.png',
    );
    expect(icon?.getAttribute('width')).toBe('1139');
    expect(icon?.getAttribute('height')).toBe('861');
  });

  it('switches between the appropriate PNG variants for automatic theme selection', () => {
    fixture.componentRef.setInput('theme', 'auto');
    fixture.detectChanges();

    const images = Array.from(fixture.nativeElement.querySelectorAll('img')) as HTMLImageElement[];

    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      '/assets/brand/liass-ohada/logos/logo-horizontal-navy-gold.png',
      '/assets/brand/liass-ohada/logos/logo-horizontal-white-gold.png',
    ]);
    expect(images[0].className).toContain('dark:hidden');
    expect(images[1].className).toContain('dark:block');
  });
});
