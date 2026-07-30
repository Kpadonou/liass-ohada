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
    expect(image?.getAttribute('src')).toBe('/assets/brand/logos/liass-horizontal-light.png');
    expect(image?.getAttribute('width')).toBe('1375');
    expect(image?.getAttribute('height')).toBe('440');
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
    expect(icon?.getAttribute('src')).toBe('/assets/brand/logos/liass-icon-dark.png');
  });
});
