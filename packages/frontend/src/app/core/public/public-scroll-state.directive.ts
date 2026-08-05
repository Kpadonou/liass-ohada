import {
  AfterViewInit,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  NgZone,
  output,
} from '@angular/core';

@Directive({
  selector: '[liassPublicScrollState]',
})
export class PublicScrollStateDirective implements AfterViewInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly ngZone = inject(NgZone);
  private scrolled = false;

  readonly stateChange = output<boolean>({ alias: 'liassPublicScrollStateChange' });

  ngAfterViewInit(): void {
    const handleScroll = () => {
      const nextState = this.element.scrollTop > 16;
      if (nextState === this.scrolled) {
        return;
      }

      this.scrolled = nextState;
      this.ngZone.run(() => this.stateChange.emit(nextState));
    };

    this.ngZone.runOutsideAngular(() => {
      this.element.addEventListener('scroll', handleScroll, { passive: true });
    });
    this.destroyRef.onDestroy(() => this.element.removeEventListener('scroll', handleScroll));
  }
}
