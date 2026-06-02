import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { vi } from 'vitest';

import { WorkspacesApi } from '../../data-access/workspaces.api';
import { OnboardingPage } from './onboarding.page';

const translations = {
  en: {
    IDENTITY: {
      AUTH_LAYOUT: {
        APPROVED_MESSAGE: 'Approved for OHADA workflows',
        BACK_TO_DASHBOARD: 'Back to dashboard'
      },
      ONBOARDING: {
        EYEBROW: 'Onboarding',
        TITLE: 'Create your Liass-OHADA workspace',
        SUBTITLE: 'Start with the organization profile.',
        TYPE_CARD_TITLE: 'Choose your workspace type',
        TYPE_CARD_SUBTITLE: 'This shapes the initial profile.',
        DETAILS_CARD_TITLE: 'Set up the initial organization',
        DETAILS_CARD_SUBTITLE: 'Prepare the workspace.',
        NO_BACKEND_READY: 'Organization provisioning is not available yet.',
        STEPS: {
          WORKSPACE_TYPE: 'Workspace type',
          ORGANIZATION_DETAILS: 'Organization details'
        },
        CHOICES: {
          COMPANY: {
            TITLE: 'Create a Company',
            DESCRIPTION: 'For PME and standard business tenants.'
          },
          ACCOUNTING_FIRM: {
            TITLE: 'Register as an Accounting Firm',
            DESCRIPTION: 'For Cabinet Comptable teams.'
          }
        },
        FIELDS: {
          COMPANY_NAME: 'Company name',
          ACCOUNTING_FIRM_NAME: 'Accounting firm name',
          COUNTRY: 'Country',
          ACCOUNTING_FRAMEWORK: 'Accounting framework'
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
          SUBMIT: 'Prepare workspace'
        },
        VALIDATION: {
          WORKSPACE_TYPE: 'Choose a workspace type.',
          ORGANIZATION_NAME: 'Enter an organization name.',
          COUNTRY: 'Choose a country.',
          ACCOUNTING_FRAMEWORK: 'Choose an accounting framework.'
        }
      }
    }
  }
};

type OnboardingPageHarness = OnboardingPage & {
  backToWorkspaceType: () => void;
  continueToDetails: () => void;
  form: {
    controls: {
      accountingFramework: { setValue: (value: string) => void };
      country: { setValue: (value: string) => void };
      organizationName: { setValue: (value: string) => void };
      workspaceType: { setValue: (value: string) => void };
    };
  };
  selectWorkspaceType: (workspaceType: 'ACCOUNTING_FIRM' | 'COMPANY') => void;
  submitOnboarding: () => void;
};

describe('OnboardingPage', () => {
  let fixture: ComponentFixture<OnboardingPage>;
  let page: OnboardingPageHarness;
  let router: Router;
  let workspacesApi: { listWorkspaces: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();
    workspacesApi = { listWorkspaces: vi.fn().mockResolvedValue([]) };

    await TestBed.configureTestingModule({
      imports: [
        OnboardingPage,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: {
            availableLangs: ['en'],
            defaultLang: 'en',
          },
        }),
      ],
      providers: [
        provideRouter([]),
        { provide: WorkspacesApi, useValue: workspacesApi },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(OnboardingPage);
    page = fixture.componentInstance as unknown as OnboardingPageHarness;
  });

  it('renders the workspace type entry step', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Create your Liass-OHADA workspace');
    expect(fixture.nativeElement.textContent).toContain('Create a Company');
    expect(fixture.nativeElement.textContent).toContain('Register as an Accounting Firm');
  });

  it('requires a workspace type before showing organization details', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    page.continueToDetails();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Choose a workspace type.');
    expect(fixture.nativeElement.textContent).not.toContain('Company name');
  });

  it('validates required organization details', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    page.selectWorkspaceType('COMPANY');
    page.continueToDetails();
    page.form.controls.country.setValue('');
    page.form.controls.accountingFramework.setValue('');
    page.submitOnboarding();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Enter an organization name.');
    expect(fixture.nativeElement.textContent).toContain('Choose a country.');
    expect(fixture.nativeElement.textContent).toContain('Choose an accounting framework.');
  });

  it('keeps valid submit at the backend provisioning boundary', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    page.selectWorkspaceType('ACCOUNTING_FIRM');
    page.continueToDetails();
    page.form.controls.organizationName.setValue('Cabinet Demo');
    page.submitOnboarding();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Organization provisioning is not available yet.');
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
