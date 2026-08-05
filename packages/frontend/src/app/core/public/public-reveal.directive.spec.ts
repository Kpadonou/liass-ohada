import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PublicRevealDirective } from './public-reveal.directive';

@Component({
  imports: [PublicRevealDirective],
  template:
    '<section liassPublicReveal="up" [liassPublicRevealDelay]="80">Always readable</section>',
})
class RevealHostComponent {}

describe('PublicRevealDirective', () => {
  let fixture: ComponentFixture<RevealHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RevealHostComponent] }).compileComponents();
  });

  afterEach(() => {
    fixture?.destroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('leaves content rendered and visible when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    fixture = TestBed.createComponent(RevealHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const section = fixture.nativeElement.querySelector('section') as HTMLElement;
    expect(section.textContent).toContain('Always readable');
    expect(section.classList.contains('public-reveal-enhanced')).toBe(false);
    expect(section.classList.contains('public-reveal-visible')).toBe(true);
  });

  it('observes once and reveals safely when the section enters the viewport', async () => {
    let callback: IntersectionObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();

    class MockIntersectionObserver {
      constructor(observerCallback: IntersectionObserverCallback) {
        callback = observerCallback;
      }
      observe = observe;
      disconnect = disconnect;
    }

    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    fixture = TestBed.createComponent(RevealHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const section = fixture.nativeElement.querySelector('section') as HTMLElement;
    expect(section.classList.contains('public-reveal-enhanced')).toBe(true);
    expect(observe).toHaveBeenCalledWith(section);

    callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);

    expect(section.classList.contains('public-reveal-visible')).toBe(true);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('does not enable entrance motion when reduced motion is requested', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    fixture = TestBed.createComponent(RevealHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const section = fixture.nativeElement.querySelector('section') as HTMLElement;
    expect(section.classList.contains('public-reveal-enhanced')).toBe(false);
    expect(section.classList.contains('public-reveal-visible')).toBe(true);
  });
});
