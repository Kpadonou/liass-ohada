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
      CTA: { SIGNUP: 'Créer mon compte gratuitement', SIGNUP_SHORT: 'Créer mon compte', TRY_FREE: 'Essayer gratuitement', LOGIN: 'Se connecter', EXPLORE: 'Découvrir' },
      HERO: { BADGE: 'Accès anticipé ouvert', TITLE: 'L’ERP pensé pour l’OHADA', DESCRIPTION: 'Pilotez la comptabilité et la trésorerie de votre entreprise. Pour les cabinets, centralisez également les entreprises clientes, les travaux et les échéances de l’équipe dans une seule plateforme conçue pour l’espace OHADA.', REASSURANCE: 'Accès immédiat', EARLY_NOTICE: 'Développement actif', PREVIEW_LABEL: 'Aperçu décoratif', PREVIEW_KICKER: 'Plateforme', PREVIEW_TITLE: 'Opérations', PREVIEW_STATUS: 'Disponible', PREVIEW_DESCRIPTION: 'Description', PREVIEW_ITEMS: { ACCOUNTING: 'Comptabilité', TREASURY: 'Trésorerie', FIRM: 'Cabinet' }, PREVIEW_CAPTION: 'Aperçu fonctionnel de la plateforme' },
      WORKSPACES: { FIRM: { SUBTITLE: 'Gérez votre portefeuille d’entreprises clientes.', FEATURES: { DOSSIERS: 'Portefeuille d’entreprises clientes' } } },
      FACTURATION: { STATUS: 'Bientôt disponible', DISCLAIMER: 'Liass-OHADA est une solution indépendante. Elle ne constitue pas le portail officiel de la Direction générale des Impôts du Bénin.' },
      FAQ: { ITEMS: {} }
    }
  },
  en: {
    COMMON: { LANGUAGE_SELECTOR: { TRIGGER: 'Change language', FRENCH: 'French', ENGLISH: 'English', CURRENT: 'Current language' } },
    PUBLIC: {
      SEO: { TITLE: 'Liass-OHADA — The ERP built for OHADA', DESCRIPTION: 'English description' },
      CTA: { TRY_FREE: 'Try it free' },
      HERO: { DESCRIPTION: 'Run your company’s accounting and treasury operations. Accounting firms can also centralize client companies, team work and deadlines in one platform built for OHADA.' },
      WORKSPACES: { FIRM: { SUBTITLE: 'Manage your portfolio of client companies.' } }
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

  it('keeps desktop navigation and its primary action on one semantic line', () => {
    const host: HTMLElement = fixture.nativeElement;
    const desktopNavigation = host.querySelector<HTMLElement>('.public-desktop-nav');
    const headerAction = host.querySelector<HTMLElement>('.public-desktop-actions .public-button-primary');
    const mobileTrigger = host.querySelector<HTMLElement>('button[aria-label="Ouvrir le menu"]');

    expect(desktopNavigation?.textContent).toContain('Produit');
    expect(desktopNavigation?.textContent).toContain('Fonctionnalités');
    expect(headerAction?.textContent?.trim()).toBe('Essayer gratuitement');
    expect(headerAction?.querySelector('br')).toBeNull();
    expect(desktopNavigation?.className).toContain('min-[86rem]:flex');
    expect(mobileTrigger?.className).toContain('min-[86rem]:hidden');
    expect(host.querySelector('.public-header liass-logo')).not.toBeNull();
  });

  it('uses client-company terminology in public French copy', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('entreprises clientes');
    expect(text.toLocaleLowerCase('fr')).not.toContain('dossiers clients');
  });

  it('uses equivalent client-company terminology in English', async () => {
    transloco.setActiveLang('en');
    fixture.detectChanges();
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('client companies');
    expect(text.toLocaleLowerCase('en')).not.toContain('client dossiers');
  });

  it('keeps the animated product illustration out of the accessibility tree', () => {
    const previewHost = fixture.nativeElement.querySelector('liass-public-product-preview') as HTMLElement | null;
    const preview = fixture.nativeElement.querySelector('.public-product-frame') as HTMLElement | null;
    expect(previewHost?.getAttribute('aria-hidden')).toBe('true');
    expect(preview?.getAttribute('aria-hidden')).toBe('true');
    expect(preview?.querySelector('[aria-label]')).toBeNull();
  });

  it('keeps every public in-page link connected to an existing anchor', () => {
    const host: HTMLElement = fixture.nativeElement;
    const internalLinks = Array.from(host.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'));

    expect(internalLinks.length).toBeGreaterThan(0);
    for (const link of internalLinks) {
      expect(host.querySelector(link.getAttribute('href') as string)).not.toBeNull();
    }
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
