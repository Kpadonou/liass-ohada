import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@ngneat/transloco';
import { vi } from 'vitest';

import { AuthStore } from '../../data-access/auth.store';
import { SignupPage } from './signup.page';

const translations = {
  fr: {
    COMMON: { LANGUAGE_SELECTOR: { TRIGGER: 'Changer de langue', FRENCH: 'Français', ENGLISH: 'English', CURRENT: 'Langue actuelle' } },
    IDENTITY: {
      AUTH_LAYOUT: {
        BACK_TO_PUBLIC_SITE: 'Retour au site Liass-OHADA', LOGO_ALT: 'Logo Liass-OHADA',
        REASSURANCE: { LABEL: 'Repères', SECURE: 'Accès sécurisé', ISOLATION: 'Isolation des organisations', OHADA: 'Conçu pour l’espace OHADA' }
      },
      AUTH_SOCIAL: { LABEL: 'Fournisseurs', GOOGLE: 'Continuer avec Google', LINKEDIN: 'Continuer avec LinkedIn', DIVIDER: 'Ou', LOADING: 'Ouverture…' },
      SIGNUP: {
        TITLE: 'Créer votre compte Liass-OHADA',
        SUBTITLE: 'Créez gratuitement votre compte et configurez votre premier espace.',
        EMAIL_UNAVAILABLE: 'La création par email n’est pas encore disponible. Continuez avec Google ou LinkedIn pour créer votre compte.',
        HAVE_ACCOUNT: 'Vous avez déjà un compte ?',
        FIELDS: { FIRST_NAME: 'Prénom', LAST_NAME: 'Nom', EMAIL: 'Email', PASSWORD: 'Mot de passe' },
        PLACEHOLDERS: { FIRST_NAME: 'Prénom', LAST_NAME: 'Nom', EMAIL: 'Email', PASSWORD: 'Mot de passe' },
        ACTIONS: { SIGN_UP: 'Créer mon compte', SIGN_IN: 'Se connecter' }
      }
    }
  },
  en: {
    COMMON: { LANGUAGE_SELECTOR: { TRIGGER: 'Change language', FRENCH: 'French', ENGLISH: 'English', CURRENT: 'Current language' } },
    IDENTITY: {
      AUTH_LAYOUT: {
        BACK_TO_PUBLIC_SITE: 'Back to the Liass-OHADA website', LOGO_ALT: 'Liass-OHADA logo',
        REASSURANCE: { LABEL: 'Trust', SECURE: 'Secure access', ISOLATION: 'Organization data isolation', OHADA: 'Built for the OHADA region' }
      },
      AUTH_SOCIAL: { LABEL: 'Providers', GOOGLE: 'Continue with Google', LINKEDIN: 'Continue with LinkedIn', DIVIDER: 'Or', LOADING: 'Opening…' },
      SIGNUP: {
        TITLE: 'Create your Liass-OHADA account',
        SUBTITLE: 'Create your free account and set up your first workspace.',
        EMAIL_UNAVAILABLE: 'Email registration is not available yet. Continue with Google or LinkedIn to create your account.',
        HAVE_ACCOUNT: 'Already have an account?',
        FIELDS: { FIRST_NAME: 'First name', LAST_NAME: 'Last name', EMAIL: 'Email', PASSWORD: 'Password' },
        PLACEHOLDERS: { FIRST_NAME: 'First name', LAST_NAME: 'Last name', EMAIL: 'Email', PASSWORD: 'Password' },
        ACTIONS: { SIGN_UP: 'Create my account', SIGN_IN: 'Sign in' }
      }
    }
  }
};

describe('SignupPage', () => {
  let fixture: ComponentFixture<SignupPage>;
  let transloco: TranslocoService;
  let authStore: {
    loading: ReturnType<typeof signal<boolean>>;
    loginWithGoogle: ReturnType<typeof vi.fn>;
    loginWithLinkedIn: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authStore = {
      loading: signal(false),
      loginWithGoogle: vi.fn().mockResolvedValue(undefined),
      loginWithLinkedIn: vi.fn().mockResolvedValue(undefined)
    };

    await TestBed.configureTestingModule({
      imports: [
        SignupPage,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: { availableLangs: ['fr', 'en'], defaultLang: 'fr', fallbackLang: 'fr', reRenderOnLangChange: true }
        })
      ],
      providers: [provideRouter([]), { provide: AuthStore, useValue: authStore }]
    }).compileComponents();

    transloco = TestBed.inject(TranslocoService);
    transloco.setActiveLang('fr');
    fixture = TestBed.createComponent(SignupPage);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('uses the shared authentication shell with the requested French heading', () => {
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('liass-auth-layout')).not.toBeNull();
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(host.querySelector('h1')?.textContent).toContain('Créer votre compte Liass-OHADA');
  });

  it('preserves Google and LinkedIn signup redirects', async () => {
    (fixture.nativeElement.querySelector('[data-testid="google-auth-button"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(authStore.loginWithGoogle).toHaveBeenCalledOnce();

    (fixture.nativeElement.querySelector('[data-testid="linkedin-auth-button"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(authStore.loginWithLinkedIn).toHaveBeenCalledOnce();
  });

  it('keeps native signup non-submitting while no native signup behavior exists', () => {
    const host: HTMLElement = fixture.nativeElement;
    const submit = host.querySelector('[data-testid="native-signup-submit"]') as HTMLButtonElement;
    const nativeFields = Array.from(host.querySelectorAll<HTMLInputElement>('form input'));

    expect(submit.disabled).toBe(true);
    expect(nativeFields).toHaveLength(4);
    expect(nativeFields.every((field) => field.disabled)).toBe(true);
  });

  it('links existing users back to login', () => {
    const host = fixture.nativeElement as HTMLElement;
    const login = host.querySelector<HTMLAnchorElement>('a[href="/login"]');
    expect(login).not.toBeNull();
  });

  it('disables both social actions and announces loading', () => {
    authStore.loading.set(true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(
      host.querySelectorAll<HTMLButtonElement>(
        '[data-testid="google-auth-button"], [data-testid="linkedin-auth-button"]'
      )
    );
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Ouverture');
  });

  it('renders English signup copy without waitlist or approval language', async () => {
    transloco.setActiveLang('en');
    fixture.detectChanges();
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Create your Liass-OHADA account');
    expect(text).toContain('Create your free account and set up your first workspace.');
    expect(text).toContain('Already have an account?');
    expect(text).not.toMatch(/waitlist|approval|administrator/i);
  });
});
