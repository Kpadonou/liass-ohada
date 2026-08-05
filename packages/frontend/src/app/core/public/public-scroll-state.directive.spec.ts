import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PublicScrollStateDirective } from './public-scroll-state.directive';

@Component({
  imports: [PublicScrollStateDirective],
  template: '<div liassPublicScrollState (liassPublicScrollStateChange)="scrolled = $event"></div>',
})
class ScrollStateHostComponent {
  scrolled = false;
}

describe('PublicScrollStateDirective', () => {
  let fixture: ComponentFixture<ScrollStateHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScrollStateHostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ScrollStateHostComponent);
    fixture.detectChanges();
  });

  it('emits only when the compact sticky-header threshold changes', () => {
    const scrollElement = fixture.nativeElement.querySelector('div') as HTMLElement;

    scrollElement.scrollTop = 24;
    scrollElement.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    expect(fixture.componentInstance.scrolled).toBe(true);

    scrollElement.scrollTop = 0;
    scrollElement.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    expect(fixture.componentInstance.scrolled).toBe(false);
  });
});
