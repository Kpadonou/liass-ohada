import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  Directive,
  ElementRef,
  inject,
  input,
  numberAttribute,
  OnDestroy,
  PLATFORM_ID,
} from '@angular/core';

export type PublicRevealMotion = 'fade' | 'left' | 'right' | 'scale' | 'up';

@Directive({
  selector: '[liassPublicReveal]',
})
export class PublicRevealDirective implements AfterViewInit, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly platformId = inject(PLATFORM_ID);
  private observer: IntersectionObserver | null = null;

  readonly motion = input<PublicRevealMotion>('up', { alias: 'liassPublicReveal' });
  readonly delay = input(0, { alias: 'liassPublicRevealDelay', transform: numberAttribute });

  ngAfterViewInit(): void {
    this.element.style.setProperty(
      '--public-reveal-delay',
      `${Math.min(Math.max(this.delay(), 0), 600)}ms`,
    );
    this.element.classList.add(`public-reveal-${this.motion()}`);

    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const windowRef = this.element.ownerDocument.defaultView;
    const reducedMotion =
      windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    if (!windowRef || reducedMotion || typeof windowRef.IntersectionObserver !== 'function') {
      this.element.classList.add('public-reveal-visible');
      return;
    }

    this.element.classList.add('public-reveal-enhanced');
    this.observer = new windowRef.IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }

        this.element.classList.add('public-reveal-visible');
        this.observer?.disconnect();
        this.observer = null;
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
    );
    this.observer.observe(this.element);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
