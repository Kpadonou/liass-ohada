import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@ngneat/transloco';

import { PublicLandingPage } from './public-landing.page';

const translations = {
  fr: {
    COMMON: { LANGUAGE_SELECTOR: { TRIGGER: 'Changer de langue', FRENCH: 'Français', ENGLISH: 'English', CURRENT: 'Langue actuelle' } },
    PUBLIC: {
      SEO: { TITLE: 'Liass-OHADA — L’ERP pensé pour l’OHADA', DESCRIPTION: 'Description française' },
      ACCESSIBILITY: { SKIP: 'Aller au contenu principal' },
      BRAND: { LOGO_ALT: 'Logo Liass-OHADA', HOME_LABEL: 'Accueil' },
      NAV: { PRODUCT: 'Produit', FEATURES: 'Fonctionnalités', COMPANIES: 'Entreprises', FIRMS: 'Cabinets', FACTURATION: 'Liass Facturation', EARLY_ACCESS: 'Accès anticipé', DESKTOP_LABEL: 'Navigation', MOBILE_LABEL: 'Navigation mobile', OPEN: 'Ouvrir le menu', CLOSE: 'Fermer le menu' },
      CTA: { SIGNUP: 'Créer mon compte gratuitement', SIGNUP_SHORT: 'Créer mon compte', LOGIN: 'Se connecter', EXPLORE: 'Découvrir' },
      HERO: { BADGE: 'Accès anticipé ouvert', TITLE: 'L’ERP pensé pour l’OHADA', DESCRIPTION: 'Description', REASSURANCE: 'Accès immédiat', EARLY_NOTICE: 'Développement actif', PREVIEW_LABEL: 'Aperçu', PREVIEW_KICKER: 'Plateforme', PREVIEW_TITLE: 'Opérations', PREVIEW_STATUS: 'Disponible', PREVIEW_DESCRIPTION: 'Description', PREVIEW_ITEMS: { ACCOUNTING: 'Comptabilité', TREASURY: 'Trésorerie', FIRM: 'Cabinet' }, PREVIEW_CAPTION: 'Illustration fonctionnelle' },
      FACTURATION: { STATUS: 'Bientôt disponible', DISCLAIMER: 'Liass-OHADA est une solution indépendante. Elle ne constitue pas le portail officiel de la Direction générale des Impôts du Bénin.' },
      FAQ: { ITEMS: {} }
    }
  },
  en: {
    COMMON: { LANGUAGE_SELECTOR: { TRIGGER: 'Change language', FRENCH: 'French', ENGLISH: 'English', CURRENT: 'Current language' } },
    PUBLIC: {
      SEO: { TITLE: 'Liass-OHADA — The ERP built for OHADA', DESCRIPTION: 'English description' }
    }
  }
};

describe('PublicLandingPage', () => {
  let fixture: ComponentFixture<PublicLandingPage>;
  let transloco: TranslocoService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        PublicLandingPage,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: {
            availableLangs: ['fr', 'en'],
            defaultLang: 'fr',
            fallbackLang: 'fr',
            reRenderOnLangChange: true
          }
        })
      ]
    }).compileComponents();

    transloco = TestBed.inject(TranslocoService);
    transloco.setActiveLang('fr');
    fixture = TestBed.createComponent(PublicLandingPage);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('renders one public H1 and no authenticated shell', () => {
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(host.querySelector('h1')?.textContent).toContain('L’ERP pensé pour l’OHADA');
    expect(host.querySelector('liass-app-shell')).toBeNull();
  });

  it('links primary actions directly to configured signup and login routes', () => {
    const host: HTMLElement = fixture.nativeElement;
    const hrefs = Array.from(host.querySelectorAll('a')).map((link) => link.href);

    expect(hrefs.some((href) => href.endsWith('/signup'))).toBe(true);
    expect(hrefs.some((href) => href.endsWith('/login'))).toBe(true);
    expect(hrefs.some((href) => href.includes('waitlist'))).toBe(false);
  });

  it('marks Liass Facturation as upcoming and shows the DGI independence disclaimer', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Bientôt disponible');
    expect(text).toContain('ne constitue pas le portail officiel');
  });

  it('updates SEO metadata when the language changes', async () => {
    transloco.setActiveLang('en');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.title).toBe('Liass-OHADA — The ERP built for OHADA');
    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('English description');
  });
});
