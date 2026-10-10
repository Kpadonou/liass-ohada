import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { CreateInitialWorkspaceResponse } from '@liass-ohada/shared/shared';
import { TranslocoService } from '@ngneat/transloco';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { vi } from 'vitest';

import { OnboardingApi } from '../../data-access/onboarding.api';
import { WorkspacesApi } from '../../data-access/workspaces.api';
import { OnboardingPage } from './onboarding.page';

const onboardingTranslations = {
  EYEBROW: 'Onboarding',
  TITLE: 'Welcome to Liass-OHADA',
  INTENT_QUESTION: 'What would you like to do first?',
  SUBTITLE: 'Choose your main need.',
  STEPS: {
    LABEL: 'Workspace creation steps',
    INTENT: 'Your need',
    ORGANIZATION: 'Your organization',
    CONFIGURATION: 'Configuration',
    PROGRESS: 'Step {{ current }} of {{ total }}'
  },
  INTENTS: {
    SELECTED: 'Need selected',
    COMING_SOON: 'Coming soon',
    ACCOUNTING: {
      TITLE: 'Manage my accounting',
      DESCRIPTION: "Manage your organization's accounting and treasury."
    },
    BENIN_INVOICING: {
      BRAND: 'Liass-Facturation',
      TITLE: 'Issue standardized invoices in Benin',
      DESCRIPTION: 'An invoicing experience for Beninese businesses.'
    },
    ACCOUNTING_FIRM: {
      TITLE: 'Manage my accounting firm',
      DESCRIPTION: 'Bring your client companies and team together.'
    }
  },
  ORGANIZATION: {
    COMPANY_TITLE: 'Your organization',
    COMPANY_DESCRIPTION: 'Provide the essential organization information.',
    CABINET_TITLE: 'Your accounting firm',
    CABINET_DESCRIPTION: 'Provide the essential accounting firm information.'
  },
  CONFIGURATION: {
    ACCOUNTING_TITLE: 'Accounting configuration',
    ACCOUNTING_DESCRIPTION: 'Choose the framework for your organization.',
    CABINET_TITLE: 'Preferences for new client companies',
    CABINET_DESCRIPTION: 'Prepare future client dossier creation.'
  },
  FIELDS: {
    COMPANY_NAME: 'Company name',
    ACCOUNTING_FIRM_NAME: 'Accounting firm name',
    COUNTRY: 'Country',
    ACCOUNTING_FRAMEWORK: 'Accounting framework',
    DEFAULT_ACCOUNTING_FRAMEWORK: 'Default suggested framework',
    DEFAULT_ACCOUNTING_FRAMEWORK_HELPER:
      'This choice will be suggested by default and can be adapted for each dossier.'
  },
  FRAMEWORKS: {
    SYSCOHADA_REVISED: 'Revised SYSCOHADA',
    SYCEBNL: 'SYCEBNL'
  },
  COUNTRIES: {
    BENIN: 'Benin'
  },
  ACTIONS: {
    BACK: 'Back',
    CONTINUE: 'Continue',
    SUBMIT: 'Create workspace',
    SUBMITTING: 'Creating workspace...'
  },
  ERRORS: {
    AUTH_REQUIRED: 'Sign in again.',
    CREATE_FAILED: 'Workspace creation could not finish.',
    DUPLICATE_WORKSPACE: 'A workspace already exists for this account.',
    MISSING_ROUTE: 'Workspace creation is unavailable.',
    NETWORK: 'The network connection failed.',
    SERVER: 'The service hit an error.',
    VALIDATION: 'The response could not be verified.'
  },
  VALIDATION: {
    INTENT: 'Choose what you would like to do first.',
    ORGANIZATION_NAME: 'Enter an organization name.',
    COUNTRY: 'Choose a country.',
    ACCOUNTING_FRAMEWORK: 'Choose an accounting framework.'
  }
};

const translations = {
  en: {
    COMMON: { SELECT: { NO_RESULTS: 'No results', SEARCH_PLACEHOLDER: 'Search...' } },
    IDENTITY: { ONBOARDING: onboardingTranslations }
  },
  fr: {
    COMMON: { SELECT: { NO_RESULTS: 'Aucun résultat', SEARCH_PLACEHOLDER: 'Rechercher...' } },
    IDENTITY: {
      ONBOARDING: {
        ...onboardingTranslations,
        TITLE: 'Bienvenue sur Liass-OHADA',
        INTENT_QUESTION: 'Que souhaitez-vous faire en premier ?',
        SUBTITLE: 'Choisissez votre besoin principal.',
        INTENTS: {
          ...onboardingTranslations.INTENTS,
          COMING_SOON: 'Bientôt disponible',
          ACCOUNTING: {
            TITLE: 'Tenir ma comptabilité',
            DESCRIPTION: 'Gérez la comptabilité et la trésorerie de votre organisation.'
          },
          ACCOUNTING_FIRM: {
            TITLE: 'Gérer mon cabinet comptable',
            DESCRIPTION: 'Centralisez vos entreprises clientes et votre équipe.'
          }
        }
      }
    }
  }
};

const createdAt = '2026-06-03T00:00:00.000Z';

function response(workspaceType: 'ACCOUNTING_FIRM' | 'COMPANY'): CreateInitialWorkspaceResponse {
  const isFirm = workspaceType === 'ACCOUNTING_FIRM';
  const orgId = isFirm ? 'org-firm' : 'org-created';
  const name = isFirm ? 'Cabinet Demo' : 'Demo SARL';

  return {
    organization: {
      orgId,
      name,
      workspaceType,
      status: 'ACTIVE',
      country: 'BJ',
      accountingFramework: 'SYSCOHADA_REVISED',
      createdAt,
      updatedAt: createdAt
    },
    cabinet: isFirm
      ? {
          cabinetId: 'cab-created',
          orgId,
          name,
          status: 'ACTIVE',
          country: 'BJ',
          ownerUserId: 'user-123',
          createdAt,
          updatedAt: createdAt
        }
      : null,
    workspace: {
      orgId,
      role: 'OWNER',
      cabinetId: isFirm ? 'cab-created' : undefined,
      accessSource: 'DIRECT',
      displayName: name,
      workspaceType,
      status: 'ACTIVE',
      country: 'BJ',
      accountingFramework: 'SYSCOHADA_REVISED'
    },
    activeOrgId: orgId
  };
}

type OnboardingPageHarness = OnboardingPage & {
  back: () => void;
  continueFromIntent: () => void;
  continueFromOrganization: () => void;
  currentStep: () => 'configuration' | 'intent' | 'organization';
  form: {
    controls: {
      accountingFramework: { setValue: (value: string) => void };
      country: { setValue: (value: string) => void };
      organizationName: { setValue: (value: string) => void; value: string };
      workspaceType: { value: string };
    };
  };
  onboardingErrorKey: () => string | null;
  selectIntent: (intent: 'ACCOUNTING' | 'ACCOUNTING_FIRM') => void;
  selectedIntent: () => 'ACCOUNTING' | 'ACCOUNTING_FIRM' | null;
  submitOnboarding: () => Promise<void>;
  submitting: () => boolean;
};

describe('OnboardingPage', () => {
  let fixture: ComponentFixture<OnboardingPage>;
  let page: OnboardingPageHarness;
  let router: Router;
  let onboardingApi: { createInitialWorkspace: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();
    onboardingApi = { createInitialWorkspace: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [
        OnboardingPage,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: {
            availableLangs: ['en', 'fr'],
            defaultLang: 'en'
          }
        })
      ],
      providers: [
        provideRouter([]),
        { provide: OnboardingApi, useValue: onboardingApi },
        { provide: WorkspacesApi, useValue: { listWorkspaces: vi.fn().mockResolvedValue([]) } }
      ]
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(OnboardingPage);
    page = fixture.componentInstance as unknown as OnboardingPageHarness;
  });

  async function initialize(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function openConfiguration(intent: 'ACCOUNTING' | 'ACCOUNTING_FIRM', name: string): void {
    page.selectIntent(intent);
    page.continueFromIntent();
    page.form.controls.organizationName.setValue(name);
    page.continueFromOrganization();
    fixture.detectChanges();
  }

  it('starts zero-workspace onboarding with three business intentions and no technical labels', async () => {
    await initialize();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('What would you like to do first?');
    expect(text).toContain('Manage my accounting');
    expect(text).toContain('Manage my accounting firm');
    expect(text).toContain('Liass-Facturation');
    expect(text).toContain('Coming soon');
    expect(text).not.toContain('COMPANY');
    expect(text).not.toContain('ACCOUNTING_FIRM');
    expect(text).not.toContain('ProductAccess');
  });

  it('announces Liass-Facturation as unavailable and provides no provisioning control', async () => {
    await initialize();

    const card = fixture.nativeElement.querySelector(
      'article[aria-disabled="true"]'
    ) as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('Coming soon');
    expect(card.querySelector('button')).toBeNull();
    expect(onboardingApi.createInitialWorkspace).not.toHaveBeenCalled();
  });

  it('makes Accounting and Accounting Firm keyboard-native selectable buttons', async () => {
    await initialize();

    const choices = fixture.nativeElement.querySelectorAll('button[aria-pressed]');
    expect(choices).toHaveLength(2);
    expect(
      Array.from(choices).every((choice) => (choice as HTMLButtonElement).type === 'button')
    ).toBe(true);
  });

  it('derives COMPANY internally for Accounting and separates organization from configuration', async () => {
    onboardingApi.createInitialWorkspace.mockResolvedValue(response('COMPANY'));
    await initialize();

    page.selectIntent('ACCOUNTING');
    expect(page.form.controls.workspaceType.value).toBe('COMPANY');
    page.continueFromIntent();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Your organization');
    expect(fixture.nativeElement.textContent).not.toContain('Accounting configuration');

    page.form.controls.organizationName.setValue('Demo SARL');
    page.continueFromOrganization();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Accounting configuration');
    expect(
      fixture.nativeElement.querySelector('mat-select[formControlName="accountingFramework"]')
    ).toBeTruthy();

    page.form.controls.accountingFramework.setValue('SYSCOHADA_REVISED');
    await page.submitOnboarding();

    expect(onboardingApi.createInitialWorkspace).toHaveBeenCalledWith({
      workspaceType: 'COMPANY',
      products: ['ACCOUNTING'],
      organizationName: 'Demo SARL',
      country: 'BJ',
      accountingFramework: 'SYSCOHADA_REVISED'
    });
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard'], { replaceUrl: true });
  });

  it('requires an explicit accounting-framework choice', async () => {
    await initialize();
    openConfiguration('ACCOUNTING', 'Demo SARL');

    await page.submitOnboarding();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Choose an accounting framework.');
    expect(onboardingApi.createInitialWorkspace).not.toHaveBeenCalled();
  });

  it('derives ACCOUNTING_FIRM internally and presents the framework as a client-company default', async () => {
    onboardingApi.createInitialWorkspace.mockResolvedValue(response('ACCOUNTING_FIRM'));
    await initialize();
    openConfiguration('ACCOUNTING_FIRM', 'Cabinet Demo');

    const text = fixture.nativeElement.textContent;
    expect(page.form.controls.workspaceType.value).toBe('ACCOUNTING_FIRM');
    expect(text).toContain('Preferences for new client companies');
    expect(text).toContain('Default suggested framework');
    expect(text).toContain('can be adapted for each dossier');
    expect(text).not.toContain('ACCOUNTING_FIRM');

    page.form.controls.accountingFramework.setValue('SYCEBNL');
    await page.submitOnboarding();

    expect(onboardingApi.createInitialWorkspace).toHaveBeenCalledWith({
      workspaceType: 'ACCOUNTING_FIRM',
      organizationName: 'Cabinet Demo',
      country: 'BJ',
      accountingFramework: 'SYCEBNL'
    });
    expect(router.navigate).toHaveBeenCalledWith(['/cabinet/dashboard'], { replaceUrl: true });
  });

  it('preserves organization input across Back and creates nothing before final submission', async () => {
    await initialize();
    openConfiguration('ACCOUNTING', 'Demo SARL');

    page.back();
    expect(page.currentStep()).toBe('organization');
    expect(page.form.controls.organizationName.value).toBe('Demo SARL');
    page.back();
    expect(page.currentStep()).toBe('intent');
    page.selectIntent('ACCOUNTING_FIRM');

    expect(page.selectedIntent()).toBe('ACCOUNTING_FIRM');
    expect(onboardingApi.createInitialWorkspace).not.toHaveBeenCalled();
  });

  it('requires an explicit framework choice again after changing intent', async () => {
    await initialize();
    openConfiguration('ACCOUNTING', 'Demo SARL');
    page.form.controls.accountingFramework.setValue('SYSCOHADA_REVISED');
    page.back();
    page.back();

    page.selectIntent('ACCOUNTING_FIRM');
    page.continueFromIntent();
    page.continueFromOrganization();
    await page.submitOnboarding();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Choose an accounting framework.');
    expect(onboardingApi.createInitialWorkspace).not.toHaveBeenCalled();
  });

  it('shows French intent copy with translation parity', async () => {
    TestBed.inject(TranslocoService).setActiveLang('fr');
    await initialize();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Bienvenue sur Liass-OHADA');
    expect(text).toContain('Que souhaitez-vous faire en premier ?');
    expect(text).toContain('Tenir ma comptabilité');
    expect(text).toContain('Bientôt disponible');
    expect(text).toContain('Gérer mon cabinet comptable');
  });

  it('keeps creation errors contextual and does not redirect', async () => {
    onboardingApi.createInitialWorkspace.mockRejectedValue(
      new HttpErrorResponse({
        status: 409,
        error: { message: { code: 'WORKSPACE_ALREADY_EXISTS' } }
      })
    );
    await initialize();
    openConfiguration('ACCOUNTING', 'Demo SARL');
    page.form.controls.accountingFramework.setValue('SYSCOHADA_REVISED');

    await page.submitOnboarding();
    fixture.detectChanges();

    expect(page.onboardingErrorKey()).toBe('IDENTITY.ONBOARDING.ERRORS.DUPLICATE_WORKSPACE');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('shows a network error without redirecting', async () => {
    onboardingApi.createInitialWorkspace.mockRejectedValue(new HttpErrorResponse({ status: 0 }));
    await initialize();
    openConfiguration('ACCOUNTING', 'Demo SARL');
    page.form.controls.accountingFramework.setValue('SYSCOHADA_REVISED');

    await page.submitOnboarding();
    fixture.detectChanges();

    expect(page.onboardingErrorKey()).toBe('IDENTITY.ONBOARDING.ERRORS.NETWORK');
    expect(fixture.nativeElement.textContent).toContain('network connection failed');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('shows a response-validation error without redirecting', async () => {
    onboardingApi.createInitialWorkspace.mockRejectedValue(
      Object.assign(new Error('Invalid response'), { name: 'ZodError' })
    );
    await initialize();
    openConfiguration('ACCOUNTING', 'Demo SARL');
    page.form.controls.accountingFramework.setValue('SYSCOHADA_REVISED');

    await page.submitOnboarding();
    fixture.detectChanges();

    expect(page.onboardingErrorKey()).toBe('IDENTITY.ONBOARDING.ERRORS.VALIDATION');
    expect(fixture.nativeElement.textContent).toContain('response could not be verified');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('shows a generic translated error when workspace creation fails', async () => {
    onboardingApi.createInitialWorkspace.mockRejectedValue(new Error('boom'));
    await initialize();
    openConfiguration('ACCOUNTING', 'Demo SARL');
    page.form.controls.accountingFramework.setValue('SYSCOHADA_REVISED');

    await page.submitOnboarding();
    fixture.detectChanges();

    expect(page.onboardingErrorKey()).toBe('IDENTITY.ONBOARDING.ERRORS.CREATE_FAILED');
    expect(fixture.nativeElement.textContent).toContain('Workspace creation could not finish.');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('prevents duplicate submissions while a request is in flight', async () => {
    let resolveRequest: (value: CreateInitialWorkspaceResponse) => void = () => undefined;
    onboardingApi.createInitialWorkspace.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );
    await initialize();
    openConfiguration('ACCOUNTING', 'Demo SARL');
    page.form.controls.accountingFramework.setValue('SYSCOHADA_REVISED');

    const firstSubmission = page.submitOnboarding();
    await Promise.resolve();
    expect(page.submitting()).toBe(true);
    await page.submitOnboarding();
    expect(onboardingApi.createInitialWorkspace).toHaveBeenCalledTimes(1);

    resolveRequest(response('COMPANY'));
    await firstSubmission;
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard'], { replaceUrl: true });
  });
});
