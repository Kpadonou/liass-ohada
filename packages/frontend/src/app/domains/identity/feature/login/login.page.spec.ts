import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { Router, provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@ngneat/transloco';
import { vi } from 'vitest';

import { AuthStore } from '../../data-access/auth.store';
import { LoginPage } from './login.page';

const translations = {
  fr: {
    COMMON: { LANGUAGE_SELECTOR: { TRIGGER: 'Changer de langue', FRENCH: 'Français', ENGLISH: 'English', CURRENT: 'Langue actuelle' } },
    IDENTITY: {
      AUTH_LAYOUT: {
        BACK_TO_PUBLIC_SITE: 'Retour au site Liass-OHADA',
        LOGO_ALT: 'Logo Liass-OHADA',
        REASSURANCE: { LABEL: 'Repères', SECURE: 'Accès sécurisé', ISOLATION: 'Isolation des organisations', OHADA: 'Conçu pour l’espace OHADA' }
      },
      AUTH_SOCIAL: { LABEL: 'Fournisseurs', GOOGLE: 'Continuer avec Google', LINKEDIN: 'Continuer avec LinkedIn', DIVIDER: 'Ou', LOADING: 'Ouverture…' },
      LOGIN: {
        TITLE: 'Bienvenue sur Liass-OHADA',
        SUBTITLE: 'Connectez-vous pour accéder à votre espace de travail.',
        NEW_PASSWORD_TITLE: 'Créez un nouveau mot de passe',
        NEW_PASSWORD_SUBTITLE: 'Finalisez la sécurisation de votre compte.',
        NEW_PASSWORD_NOTICE: 'Créez un nouveau mot de passe.',
        FORGOT_PASSWORD: 'Mot de passe oublié ?',
        NO_ACCOUNT: 'Vous n’avez pas encore de compte ?',
        FIELDS: { EMAIL: 'Email', PASSWORD: 'Mot de passe', NEW_PASSWORD: 'Nouveau mot de passe', CONFIRM_NEW_PASSWORD: 'Confirmer le nouveau mot de passe' },
        PLACEHOLDERS: { EMAIL: 'info@entreprise.com', PASSWORD: 'Mot de passe', NEW_PASSWORD: 'Nouveau mot de passe', CONFIRM_NEW_PASSWORD: 'Confirmation' },
        ACTIONS: {
          SIGN_IN: 'Se connecter', SIGNING_IN: 'Connexion en cours…', SIGN_UP: 'Créer mon compte',
          SET_NEW_PASSWORD: 'Définir le nouveau mot de passe', SETTING_NEW_PASSWORD: 'Enregistrement en cours…',
          SHOW_PASSWORD: 'Afficher le mot de passe', HIDE_PASSWORD: 'Masquer le mot de passe',
          SHOW_NEW_PASSWORD: 'Afficher le nouveau mot de passe', HIDE_NEW_PASSWORD: 'Masquer le nouveau mot de passe',
          SHOW_CONFIRM_PASSWORD: 'Afficher la confirmation', HIDE_CONFIRM_PASSWORD: 'Masquer la confirmation'
        },
        VALIDATION: {
          EMAIL: 'Saisissez une adresse email valide.', PASSWORD: 'Saisissez votre mot de passe.',
          NEW_PASSWORD_REQUIRED: 'Saisissez un nouveau mot de passe.', NEW_PASSWORD_MIN_LENGTH: 'Utilisez au moins 12 caractères.',
          CONFIRM_NEW_PASSWORD: 'Confirmez votre nouveau mot de passe.', PASSWORDS_DO_NOT_MATCH: 'Les mots de passe ne correspondent pas.'
        }
      }
    }
  },
  en: {
    COMMON: { LANGUAGE_SELECTOR: { TRIGGER: 'Change language', FRENCH: 'French', ENGLISH: 'English', CURRENT: 'Current language' } },
    IDENTITY: {
      AUTH_LAYOUT: {
        BACK_TO_PUBLIC_SITE: 'Back to the Liass-OHADA website',
        LOGO_ALT: 'Liass-OHADA logo',
        REASSURANCE: { LABEL: 'Trust', SECURE: 'Secure access', ISOLATION: 'Organization data isolation', OHADA: 'Built for the OHADA region' }
      },
      AUTH_SOCIAL: { LABEL: 'Providers', GOOGLE: 'Continue with Google', LINKEDIN: 'Continue with LinkedIn', DIVIDER: 'Or', LOADING: 'Opening…' },
      LOGIN: {
        TITLE: 'Welcome to Liass-OHADA', SUBTITLE: 'Sign in to access your workspace.',
        NEW_PASSWORD_TITLE: 'Create a new password', NEW_PASSWORD_SUBTITLE: 'Finish securing your account.', NEW_PASSWORD_NOTICE: 'Create a new password.',
        FORGOT_PASSWORD: 'Forgot password?', NO_ACCOUNT: 'Don’t have an account yet?',
        FIELDS: { EMAIL: 'Email', PASSWORD: 'Password', NEW_PASSWORD: 'New password', CONFIRM_NEW_PASSWORD: 'Confirm new password' },
        PLACEHOLDERS: { EMAIL: 'info@company.com', PASSWORD: 'Password', NEW_PASSWORD: 'New password', CONFIRM_NEW_PASSWORD: 'Confirmation' },
        ACTIONS: {
          SIGN_IN: 'Sign in', SIGNING_IN: 'Signing in…', SIGN_UP: 'Create my account', SET_NEW_PASSWORD: 'Set new password', SETTING_NEW_PASSWORD: 'Saving…',
          SHOW_PASSWORD: 'Show password', HIDE_PASSWORD: 'Hide password', SHOW_NEW_PASSWORD: 'Show new password', HIDE_NEW_PASSWORD: 'Hide new password',
          SHOW_CONFIRM_PASSWORD: 'Show confirmation', HIDE_CONFIRM_PASSWORD: 'Hide confirmation'
        },
        VALIDATION: { EMAIL: 'Enter a valid email.', PASSWORD: 'Enter your password.', NEW_PASSWORD_REQUIRED: 'Enter a new password.', NEW_PASSWORD_MIN_LENGTH: 'Use at least 12 characters.', CONFIRM_NEW_PASSWORD: 'Confirm your new password.', PASSWORDS_DO_NOT_MATCH: 'Passwords do not match.' }
      }
    }
  }
};

type LoginHarness = LoginPage & {
  form: FormGroup;
  submit(): Promise<void>;
};

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  let transloco: TranslocoService;
  let router: Router;
  let authStore: {
    loading: ReturnType<typeof signal<boolean>>;
    requiresNewPassword: ReturnType<typeof signal<boolean>>;
    error: ReturnType<typeof signal<string | null>>;
    loginWithGoogle: ReturnType<typeof vi.fn>;
    loginWithLinkedIn: ReturnType<typeof vi.fn>;
    login: ReturnType<typeof vi.fn>;
    confirmNewPassword: ReturnType<typeof vi.fn>;
    loadWorkspaces: ReturnType<typeof vi.fn>;
    workspaceDestination: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authStore = {
      loading: signal(false),
      requiresNewPassword: signal(false),
      error: signal<string | null>(null),
      loginWithGoogle: vi.fn().mockResolvedValue(undefined),
      loginWithLinkedIn: vi.fn().mockResolvedValue(undefined),
      login: vi.fn().mockResolvedValue(undefined),
      confirmNewPassword: vi.fn().mockResolvedValue(undefined),
      loadWorkspaces: vi.fn().mockResolvedValue(undefined),
      workspaceDestination: vi.fn().mockReturnValue('/dashboard')
    };

    await TestBed.configureTestingModule({
      imports: [
        LoginPage,
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
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('uses the shared authentication shell with one clear heading', () => {
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('liass-auth-layout')).not.toBeNull();
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(host.querySelector('h1')?.textContent).toContain('Bienvenue sur Liass-OHADA');
  });

  it('keeps Google and LinkedIn redirect actions available', async () => {
    (fixture.nativeElement.querySelector('[data-testid="google-auth-button"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(authStore.loginWithGoogle).toHaveBeenCalledOnce();

    (fixture.nativeElement.querySelector('[data-testid="linkedin-auth-button"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(authStore.loginWithLinkedIn).toHaveBeenCalledOnce();
  });

  it('preserves native login submission and workspace routing', async () => {
    const page = fixture.componentInstance as LoginHarness;
    page.form.get('email')?.setValue('user@example.com');
    page.form.get('password')?.setValue('password');

    await page.submit();

    expect(authStore.login).toHaveBeenCalledWith('user@example.com', 'password');
    expect(authStore.loadWorkspaces).toHaveBeenCalledWith(true);
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('preserves the unavailable forgot-password state and signup navigation', () => {
    const host: HTMLElement = fixture.nativeElement;
    const forgot = host.querySelector('[data-testid="forgot-password-unavailable"]');
    const signup = host.querySelector<HTMLAnchorElement>('a[href="/signup"]');

    expect(forgot?.getAttribute('aria-disabled')).toBe('true');
    expect(forgot?.getAttribute('href')).toBeNull();
    expect(signup).not.toBeNull();
  });

  it('disables all authentication actions and announces loading', () => {
    authStore.loading.set(true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(
      host.querySelectorAll<HTMLButtonElement>(
        '[data-testid="google-auth-button"], [data-testid="linkedin-auth-button"], [data-testid="native-login-submit"]'
      )
    );
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Ouverture');
  });

  it('renders complete English login copy', async () => {
    transloco.setActiveLang('en');
    fixture.detectChanges();
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Welcome to Liass-OHADA');
    expect(text).toContain('Sign in to access your workspace.');
    expect(text).toContain('Don’t have an account yet?');
  });
});
