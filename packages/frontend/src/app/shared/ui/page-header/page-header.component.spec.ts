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

  it('renders breadcrumb context, page title, and subtitle without the old module block', () => {
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Eyebrow');
    expect(text).toContain('Page title');
    expect(text).toContain('Page subtitle');
    expect(text).not.toContain('MODULE COURANT');
    expect(text).not.toContain('Current module');
  });

  it('renders a local page action area when an action label is provided', () => {
    fixture.componentRef.setInput('actionIcon', 'more_horiz');
    fixture.componentRef.setInput('actionLabel', 'Actions de la page');
    fixture.detectChanges();

    const actions = fixture.nativeElement.querySelector('[data-testid="page-actions"]');

    expect(actions).not.toBeNull();
    expect(actions.textContent).toContain('Actions de la page');
  });
});
