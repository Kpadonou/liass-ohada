import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@ngneat/transloco';

import { LanguageSelectorComponent } from './language-selector.component';

const translations = {
  fr: {
    COMMON: {
      LANGUAGE_SELECTOR: {
        TRIGGER: 'Changer de langue',
        FRENCH: 'Français',
        ENGLISH: 'English',
        CURRENT: 'Langue actuelle',
      },
    },
  },
  en: {
    COMMON: {
      LANGUAGE_SELECTOR: {
        TRIGGER: 'Change language',
        FRENCH: 'Français',
        ENGLISH: 'English',
        CURRENT: 'Current language',
      },
    },
  },
};

describe('LanguageSelectorComponent', () => {
  let fixture: ComponentFixture<LanguageSelectorComponent>;
  let translocoService: TranslocoService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        LanguageSelectorComponent,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: {
            availableLangs: ['fr', 'en'],
            defaultLang: 'fr',
            fallbackLang: 'fr',
            reRenderOnLangChange: true,
          },
        }),
      ],
    }).compileComponents();

    localStorage.clear();
    translocoService = TestBed.inject(TranslocoService);
    translocoService.setActiveLang('fr');
    fixture = TestBed.createComponent(LanguageSelectorComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((container) => container.remove());
  });

  it('renders the language menu trigger', () => {
    const button = fixture.nativeElement.querySelector(
      '[data-testid="language-trigger"]',
    ) as HTMLButtonElement;

    expect(button).toBeTruthy();
    expect(button.textContent?.trim()).toBe('FR');
    expect(button.getAttribute('aria-label')).toBe('Changer de langue');
  });

  it('renders available languages in the menu', async () => {
    openMenu(fixture);
    await fixture.whenStable();

    const menuText = document.body.textContent ?? '';
    expect(menuText).toContain('Français');
    expect(menuText).toContain('English');
  });

  it('switches the active language from the menu', async () => {
    openMenu(fixture);
    await fixture.whenStable();

    findMenuItem('English').click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(translocoService.getActiveLang()).toBe('en');
    expect(localStorage.getItem('liass-ohada.language')).toBe('en');
  });

  it('marks the current active language', async () => {
    translocoService.setActiveLang('en');
    fixture.detectChanges();
    await fixture.whenStable();
    openMenu(fixture);
    await fixture.whenStable();

    const activeItem = document.body.querySelector('[aria-current="true"]') as HTMLElement;
    expect(activeItem).toBeTruthy();
    expect(activeItem.textContent).toContain('English');
  });
});

function openMenu(fixture: ComponentFixture<LanguageSelectorComponent>): void {
  const button = fixture.nativeElement.querySelector(
    '[data-testid="language-trigger"]',
  ) as HTMLButtonElement;
  button.click();
  fixture.detectChanges();
}

function findMenuItem(label: string): HTMLButtonElement {
  const item = Array.from(document.body.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(label),
  );

  if (!item) {
    throw new Error(`Could not find menu item ${label}`);
  }

  return item;
}
