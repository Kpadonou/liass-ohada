import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LiassPageHeaderComponent } from './page-header.component';

describe('LiassPageHeaderComponent', () => {
  let fixture: ComponentFixture<LiassPageHeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LiassPageHeaderComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(LiassPageHeaderComponent);
    fixture.componentRef.setInput('eyebrow', 'Eyebrow');
    fixture.componentRef.setInput('title', 'Page title');
    fixture.componentRef.setInput('subtitle', 'Page subtitle');
    fixture.detectChanges();
  });

  it('renders as a block-level layout primitive so page spacing stays reliable', () => {
    expect(fixture.nativeElement.classList.contains('block')).toBe(true);
  });
});
