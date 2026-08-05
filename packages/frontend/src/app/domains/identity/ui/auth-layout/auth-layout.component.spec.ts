import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@ngneat/transloco';

import { publicSiteConfig } from '../../../../core/public/public-site.config';
import { AuthLayoutComponent } from './auth-layout.component';

const translations = {
  fr: {
    COMMON: {
      LANGUAGE_SELECTOR: {
        TRIGGER: 'Changer de langue',
        FRENCH: 'Français',
        ENGLISH: 'English',
        CURRENT: 'Langue actuelle'
      }
    },
    IDENTITY: {
      AUTH_LAYOUT: {
        BACK_TO_PUBLIC_SITE: 'Retour au site Liass-OHADA',
        LOGO_ALT: 'Logo Liass-OHADA',
        REASSURANCE: {
          LABEL: 'Repères de confiance',
          SECURE: 'Accès sécurisé',
          ISOLATION: 'Isolation des organisations',
          OHADA: 'Conçu pour l’espace OHADA'
        }
      }
    }
  },
  en: {
    COMMON: {
      LANGUAGE_SELECTOR: {
        TRIGGER: 'Change language',
        FRENCH: 'French',
        ENGLISH: 'English',
        CURRENT: 'Current language'
      }
    },
    IDENTITY: {
      AUTH_LAYOUT: {
        BACK_TO_PUBLIC_SITE: 'Back to the Liass-OHADA website',
        LOGO_ALT: 'Liass-OHADA logo',
        REASSURANCE: {
          LABEL: 'Trust indicators',
          SECURE: 'Secure access',
          ISOLATION: 'Organization data isolation',
          OHADA: 'Built for the OHADA region'
        }
      }
    }
  }
};

describe('AuthLayoutComponent', () => {
  let fixture: ComponentFixture<AuthLayoutComponent>;
  let transloco: TranslocoService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        AuthLayoutComponent,
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
      ],
      providers: [provideRouter([])]
    }).compileComponents();

    transloco = TestBed.inject(TranslocoService);
    transloco.setActiveLang('fr');
    fixture = TestBed.createComponent(AuthLayoutComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('renders the transparent white horizontal logo on the compact navy surface', () => {
    const host: HTMLElement = fixture.nativeElement;
    const brandSurface = host.querySelector('.liass-auth-brand-surface');
    const logo = brandSurface?.querySelector<HTMLImageElement>('liass-logo img');

    expect(brandSurface).not.toBeNull();
    expect(logo?.getAttribute('src')).toBe('/assets/brand/logos/liass-horizontal-light.png');
    expect(logo?.getAttribute('width')).toBe('1375');
    expect(logo?.getAttribute('height')).toBe('440');
    expect(logo?.className).toContain('w-auto');
  });

  it('removes the split promotional panel and keeps one centered auth frame', () => {
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelector('.liass-auth-marketing-panel')).toBeNull();
    expect(host.querySelectorAll('.liass-auth-frame')).toHaveLength(1);
    expect(host.querySelectorAll('.liass-auth-card')).toHaveLength(1);
  });

  it('returns to the centrally configured public site', () => {
    const link = fixture.nativeElement.querySelector(
      '[data-testid="auth-public-return"]'
    ) as HTMLAnchorElement;

    expect(link.href).toBe(new URL(publicSiteConfig.publicBaseUrl).toString());
    expect(link.textContent).toContain('Retour au site Liass-OHADA');
  });

  it('renders restrained verifiable reassurance copy', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Accès sécurisé');
    expect(text).toContain('Isolation des organisations');
    expect(text).toContain('Conçu pour l’espace OHADA');
    expect(text).not.toMatch(/100\s?%|certifi/i);
  });

  it('renders the English shell copy after a language change', async () => {
    transloco.setActiveLang('en');
    fixture.detectChanges();
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Back to the Liass-OHADA website');
    expect(text).toContain('Secure access');
  });
});
