import { Component, computed, ElementRef, HostListener, inject, input, output } from '@angular/core';

export type LiassDropdownAlign = 'start' | 'end';
export type LiassDropdownWidth = 'sm' | 'md' | 'lg';

const alignClasses: Record<LiassDropdownAlign, string> = {
  end: 'right-0',
  start: 'left-0'
};

const widthClasses: Record<LiassDropdownWidth, string> = {
  lg: 'w-[360px]',
  md: 'w-[280px]',
  sm: 'w-44'
};

@Component({
  selector: 'liass-dropdown',
  templateUrl: './dropdown.component.html'
})
export class LiassDropdownComponent {
  readonly align = input<LiassDropdownAlign>('end');
  readonly open = input(false);
  readonly width = input<LiassDropdownWidth>('md');

  readonly closed = output<void>();

  private readonly elementRef = inject(ElementRef<HTMLElement>);

  protected readonly panelClass = computed(
    () =>
      `absolute ${alignClasses[this.align()]} z-50 mt-2 ${widthClasses[this.width()]} rounded-app-panel border border-app-border bg-app-overlay p-2 text-app-text shadow-app-popover`
  );

  @HostListener('document:click', ['$event'])
  protected closeOnOutsideClick(event: MouseEvent): void {
    if (!this.open() || this.elementRef.nativeElement.contains(event.target as Node)) {
      return;
    }

    this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  protected closeOnEscape(): void {
    if (this.open()) {
      this.closed.emit();
    }
  }
}
