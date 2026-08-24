import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@ngneat/transloco';

import { PublicLandingPage } from './public-landing.page';
import { publicSiteConfig } from './public-site.config';

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
    PUBLIC: {
      SEO: {
        TITLE: 'Liass-OHADA — L’ERP pensé pour l’OHADA',
        DESCRIPTION: 'Description française',
      },
      ACCESSIBILITY: { SKIP: 'Aller au contenu principal' },
      STATUS: { AVAILABLE: 'Disponible', IN_DEVELOPMENT: 'En développement', COMING: 'À venir' },
      BRAND: { LOGO_ALT: 'Logo Liass-OHADA', HOME_LABEL: 'Accueil' },
      NAV: {
        PRODUCT: 'Produit',
        FEATURES: 'Fonctionnalités',
        COMPANIES: 'Entreprises',
        FIRMS: 'Cabinets',
        FACTURATION: 'Liass Facturation',
        EARLY_ACCESS: 'Accès anticipé',
        DESKTOP_LABEL: 'Navigation',
        MOBILE_LABEL: 'Navigation mobile',
        OPEN: 'Ouvrir le menu',
        CLOSE: 'Fermer le menu',
      },
      CTA: {
        SIGNUP: 'Créer mon compte gratuitement',
        SIGNUP_SHORT: 'Créer mon compte',
        TRY_FREE: 'Essayer gratuitement',
        LOGIN: 'Se connecter',
        EXPLORE: 'Découvrir',
      },
      HERO: {
        BADGE: 'Accès anticipé ouvert',
        TITLE: 'L’ERP pensé pour l’OHADA',
        DESCRIPTION:
          'Une plateforme ERP moderne pour piloter les opérations essentielles de votre organisation dans l’espace OHADA. Commencez aujourd’hui avec la comptabilité et la trésorerie.',
        REASSURANCE: 'Accès immédiat',
        EARLY_NOTICE: 'Développement actif',
        PREVIEW_LABEL: 'Aperçu décoratif',
        PREVIEW_KICKER: 'Une plateforme, des capacités intégrées',
        PREVIEW_TITLE: 'Opérations',
        PREVIEW_STATUS: 'Disponible',
        PREVIEW_DESCRIPTION: 'Description',
        PREVIEW_ITEMS: { ACCOUNTING: 'Comptabilité', TREASURY: 'Trésorerie', FIRM: 'Cabinet' },
        PREVIEW_CAPTION: 'Aperçu fonctionnel de la plateforme',
      },
      WORKSPACES: {
        FIRM: {
          SUBTITLE: 'Gérez votre portefeuille d’entreprises clientes.',
          FEATURES: { DOSSIERS: 'Portefeuille d’entreprises clientes' },
        },
      },
      FEATURES: {
        FLAGSHIP: {
          KICKER: 'Offre phare',
          TITLE: 'Comptabilité & finance',
          DESCRIPTION: 'Un environnement intégré.',
        },
        CAPABILITIES: {
          ACCOUNTING: { TITLE: 'Comptabilité générale', DESCRIPTION: 'Comptes et écritures.' },
          TREASURY: { TITLE: 'Trésorerie intégrée', DESCRIPTION: 'Mouvements et rapprochement.' },
          PROJECT_ACCOUNTING: {
            TITLE: 'Comptabilité de projet',
            DESCRIPTION: 'Projets et budgets.',
          },
          REPORTING: { TITLE: 'Livres, reporting & clôture', DESCRIPTION: 'Livres et contrôles.' },
        },
        FIRM: {
          KICKER: 'Expérience métier',
          TITLE: 'Cabinets comptables',
          DESCRIPTION: 'Pilotage des entreprises clientes.',
          DOSSIERS: 'Portefeuille d’entreprises clientes',
          TEAM: 'Équipe',
          WORK: 'Travaux',
          DEADLINES: 'Échéances',
          DASHBOARD: 'Pilotage',
        },
      },
      ROADMAP: {
        DOMAINS: {
          SALES: { TITLE: 'Ventes & facturation', DESCRIPTION: 'Pensé pour les ventes.' },
          PURCHASES: { TITLE: 'Achats & fournisseurs', DESCRIPTION: 'Pensé pour les achats.' },
          INVENTORY: { TITLE: 'Stocks & inventaire', DESCRIPTION: 'Pensé pour les stocks.' },
          FIXED_ASSETS: { TITLE: 'Immobilisations', DESCRIPTION: 'Pensé pour les actifs.' },
          PAYROLL: { TITLE: 'Paie & RH', DESCRIPTION: 'Pensé pour la paie.' },
          TAX: {
            TITLE: 'Fiscalité & déclarations',
            DESCRIPTION: 'Pensé pour les obligations nationales.',
          },
          RESTAURANTS: { TITLE: 'Liass-Resto', DESCRIPTION: 'Pensé pour les restaurants et bars.' },
        },
      },
      FACTURATION: {
        STATUS: 'À venir',
        DISCLAIMER:
          'Liass-OHADA est une solution indépendante. Elle ne constitue pas le portail officiel de la Direction générale des Impôts du Bénin.',
      },
      FAQ: { ITEMS: {} },
    },
  },
  en: {
    COMMON: {
      LANGUAGE_SELECTOR: {
        TRIGGER: 'Change language',
        FRENCH: 'French',
        ENGLISH: 'English',
        CURRENT: 'Current language',
      },
    },
    PUBLIC: {
      SEO: { TITLE: 'Liass-OHADA — The ERP built for OHADA', DESCRIPTION: 'English description' },
      STATUS: { AVAILABLE: 'Available', IN_DEVELOPMENT: 'In development', COMING: 'Coming later' },
      CTA: { TRY_FREE: 'Try it free' },
      HERO: {
        DESCRIPTION:
          'A modern ERP platform for running your organization’s essential operations across the OHADA region.',
      },
      WORKSPACES: { FIRM: { SUBTITLE: 'Manage your portfolio of client companies.' } },
    },
  },
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
            reRenderOnLangChange: true,
          },
        }),
      ],
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

  it('positions Liass-OHADA as an ERP platform while keeping Accounting as the flagship', () => {
    const host: HTMLElement = fixture.nativeElement;
    const hero = host.querySelector('.public-hero-copy')?.textContent ?? '';
    const flagship = host.querySelector<HTMLElement>(
      '[data-marketing-domain="accounting-finance"]',
    );

    expect(hero).toContain('plateforme ERP');
    expect(hero.toLocaleLowerCase('fr')).not.toContain('logiciel de comptabilité');
    expect(flagship?.textContent).toContain('Comptabilité & finance');
    expect(flagship?.getAttribute('data-public-status')).toBe('AVAILABLE');
  });

  it('keeps Treasury and Project Accounting inside the Accounting flagship hierarchy', () => {
    const flagship = fixture.nativeElement.querySelector(
      '[data-marketing-domain="accounting-finance"]',
    ) as HTMLElement | null;
    const treasury = flagship?.querySelector('[data-marketing-domain="treasury"]');
    const projectAccounting = flagship?.querySelector(
      '[data-marketing-domain="project-accounting"]',
    );

    expect(treasury?.textContent).toContain('Trésorerie intégrée');
    expect(treasury?.getAttribute('data-public-status')).toBe('AVAILABLE');
    expect(projectAccounting?.textContent).toContain('Comptabilité de projet');
    expect(projectAccounting?.getAttribute('data-public-status')).toBe('IN_DEVELOPMENT');
    expect(projectAccounting?.textContent).toContain('En développement');
  });

  it('uses only the approved visible status taxonomy', () => {
    const host: HTMLElement = fixture.nativeElement;
    const statusNodes = Array.from(host.querySelectorAll<HTMLElement>('[data-public-status]'));
    const configuredStatuses = new Set(statusNodes.map((node) => node.dataset['publicStatus']));
    const visibleStatuses = statusNodes.map((node) => node.textContent ?? '').join(' ');

    expect(configuredStatuses).toEqual(new Set(['AVAILABLE', 'IN_DEVELOPMENT', 'COMING']));
    expect(visibleStatuses).toContain('Disponible');
    expect(visibleStatuses).toContain('En développement');
    expect(visibleStatuses).toContain('À venir');
  });

  it('presents Liass-Resto as future-only and omits Hospitality, Retail, and release dates', () => {
    const host: HTMLElement = fixture.nativeElement;
    const restaurants = host.querySelector<HTMLElement>('[data-marketing-domain="restaurants"]');
    const text = host.textContent ?? '';

    expect(restaurants?.textContent).toContain('Liass-Resto');
    expect(restaurants?.textContent).toContain('restaurants et bars');
    expect(restaurants?.getAttribute('data-public-status')).toBe('COMING');
    expect(text).not.toMatch(/Hospitality|Retail/i);
    expect(text).not.toMatch(/Q[1-4]\s+20\d{2}|20\d{2}\s*[-–]\s*20\d{2}/);
  });

  it('links every signup and login action directly to its centralized application route', () => {
    const host: HTMLElement = fixture.nativeElement;
    const signupLinks = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('a[data-auth-cta="signup"]'),
    );
    const loginLinks = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('a[data-auth-cta="login"]'),
    );

    expect(signupLinks).toHaveLength(8);
    expect(loginLinks).toHaveLength(4);
    expect(signupLinks.every((link) => link.href === publicSiteConfig.signupUrl)).toBe(true);
    expect(loginLinks.every((link) => link.href === publicSiteConfig.loginUrl)).toBe(true);
    expect([...signupLinks, ...loginLinks].some((link) => link.href.includes('waitlist'))).toBe(
      false,
    );
  });

  it('keeps desktop navigation and its primary action on one semantic line', () => {
    const host: HTMLElement = fixture.nativeElement;
    const desktopNavigation = host.querySelector<HTMLElement>('.public-desktop-nav');
    const headerAction = host.querySelector<HTMLElement>(
      '.public-desktop-actions .public-button-primary',
    );
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
    const previewHost = fixture.nativeElement.querySelector(
      'liass-public-product-preview',
    ) as HTMLElement | null;
    const preview = fixture.nativeElement.querySelector(
      '.public-product-frame',
    ) as HTMLElement | null;
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

  it('marks Liass Facturation as future-only and shows the DGI independence disclaimer', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('À venir');
    expect(text).toContain('ne constitue pas le portail officiel');
  });

  it('updates SEO metadata when the language changes', async () => {
    transloco.setActiveLang('en');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.title).toBe('Liass-OHADA — The ERP built for OHADA');
    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'English description',
    );
  });
});
