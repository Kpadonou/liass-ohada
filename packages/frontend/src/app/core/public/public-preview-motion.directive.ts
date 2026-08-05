import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  Directive,
  ElementRef,
  inject,
  NgZone,
  OnDestroy,
  PLATFORM_ID,
} from '@angular/core';

@Directive({
  selector: '[liassPublicPreviewMotion]',
})
export class PublicPreviewMotionDirective implements AfterViewInit, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly ngZone = inject(NgZone);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly cleanups: Array<() => void> = [];
  private animationFrame: number | null = null;

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const windowRef = this.element.ownerDocument.defaultView;
    if (
      !windowRef ||
      windowRef.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      !windowRef.matchMedia?.('(hover: hover) and (pointer: fine)').matches
    ) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (this.animationFrame !== null) {
        windowRef.cancelAnimationFrame(this.animationFrame);
      }

      this.animationFrame = windowRef.requestAnimationFrame(() => {
        const bounds = this.element.getBoundingClientRect();
        const x = Math.min(Math.max((event.clientX - bounds.left) / bounds.width, 0), 1);
        const y = Math.min(Math.max((event.clientY - bounds.top) / bounds.height, 0), 1);

        this.element.style.setProperty('--preview-spot-x', `${x * 100}%`);
        this.element.style.setProperty('--preview-spot-y', `${y * 100}%`);
        this.element.style.setProperty('--preview-tilt-x', `${(0.5 - y) * 2.4}deg`);
        this.element.style.setProperty('--preview-tilt-y', `${(x - 0.5) * 2.8}deg`);
        this.animationFrame = null;
      });
    };

    const resetPointer = () => {
      this.element.style.setProperty('--preview-spot-x', '62%');
      this.element.style.setProperty('--preview-spot-y', '38%');
      this.element.style.setProperty('--preview-tilt-x', '0deg');
      this.element.style.setProperty('--preview-tilt-y', '0deg');
    };

    const handleVisibility = () => {
      this.element.classList.toggle('public-motion-paused', this.element.ownerDocument.hidden);
    };

    this.ngZone.runOutsideAngular(() => {
      this.element.addEventListener('pointermove', handlePointerMove, { passive: true });
      this.element.addEventListener('pointerleave', resetPointer, { passive: true });
      this.element.ownerDocument.addEventListener('visibilitychange', handleVisibility, {
        passive: true,
      });
    });

    this.cleanups.push(
      () => this.element.removeEventListener('pointermove', handlePointerMove),
      () => this.element.removeEventListener('pointerleave', resetPointer),
      () => this.element.ownerDocument.removeEventListener('visibilitychange', handleVisibility),
    );
  }

  ngOnDestroy(): void {
    const windowRef = this.element.ownerDocument.defaultView;
    if (this.animationFrame !== null) {
      windowRef?.cancelAnimationFrame(this.animationFrame);
    }
    this.cleanups.forEach((cleanup) => cleanup());
  }
}
