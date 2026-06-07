import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { CreateInitialWorkspaceResponse } from '@liass-ohada/shared/shared';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { vi } from 'vitest';

import { WorkspacesApi } from '../../data-access/workspaces.api';
import { OnboardingApi } from '../../data-access/onboarding.api';
import { OnboardingPage } from './onboarding.page';

const translations = {
  en: {
    COMMON: {
      SELECT: {
        NO_RESULTS: 'No results',
        SEARCH_PLACEHOLDER: 'Search...'
      }
    },
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
          SUBMIT: 'Create workspace',
          SUBMITTING: 'Creating workspace...'
        },
        ERRORS: {
          CREATE_FAILED: 'Workspace creation could not finish.',
          DUPLICATE_WORKSPACE: 'A workspace already exists for this account.',
          NETWORK: 'The workspace could not be created because the network connection failed.',
          VALIDATION: 'The workspace was created, but the response could not be verified.'
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

const createdAt = '2026-06-03T00:00:00.000Z';

function companyResponse(): CreateInitialWorkspaceResponse {
  return {
    organization: {
      orgId: 'org-created',
      name: 'Demo SARL',
      workspaceType: 'COMPANY',
      status: 'ACTIVE',
      country: 'BJ',
      accountingFramework: 'SYSCOHADA_REVISED',
      createdAt,
      updatedAt: createdAt
    },
    cabinet: null,
    workspace: {
      orgId: 'org-created',
      role: 'OWNER',
      accessSource: 'DIRECT',
      displayName: 'Demo SARL',
      workspaceType: 'COMPANY',
      status: 'ACTIVE',
      country: 'BJ',
      accountingFramework: 'SYSCOHADA_REVISED'
    },
    activeOrgId: 'org-created'
  };
}

function accountingFirmResponse(): CreateInitialWorkspaceResponse {
  return {
    organization: {
      orgId: 'org-firm',
      name: 'Cabinet Demo',
      workspaceType: 'ACCOUNTING_FIRM',
      status: 'ACTIVE',
      country: 'BJ',
      accountingFramework: 'SYSCOHADA_REVISED',
      createdAt,
      updatedAt: createdAt
    },
    cabinet: {
      cabinetId: 'cab-created',
      orgId: 'org-firm',
      name: 'Cabinet Demo',
      status: 'ACTIVE',
      country: 'BJ',
      ownerUserId: 'user-123',
      createdAt,
      updatedAt: createdAt
    },
    workspace: {
      orgId: 'org-firm',
      role: 'OWNER',
      cabinetId: 'cab-created',
      accessSource: 'DIRECT',
      displayName: 'Cabinet Demo',
      workspaceType: 'ACCOUNTING_FIRM',
      status: 'ACTIVE',
      country: 'BJ',
      accountingFramework: 'SYSCOHADA_REVISED'
    },
    activeOrgId: 'org-firm'
  };
}

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
  onboardingErrorKey: () => string | null;
  selectWorkspaceType: (workspaceType: 'ACCOUNTING_FIRM' | 'COMPANY') => void;
  submitOnboarding: () => Promise<void>;
  submitting: () => boolean;
};

describe('OnboardingPage', () => {
  let fixture: ComponentFixture<OnboardingPage>;
  let page: OnboardingPageHarness;
  let router: Router;
  let onboardingApi: { createInitialWorkspace: ReturnType<typeof vi.fn> };
  let workspacesApi: { listWorkspaces: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();
    onboardingApi = { createInitialWorkspace: vi.fn() };
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
        { provide: OnboardingApi, useValue: onboardingApi },
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
    expect(fixture.nativeElement.querySelector('liass-auth-layout')).toBeNull();
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
    await page.submitOnboarding();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Enter an organization name.');
    expect(fixture.nativeElement.textContent).toContain('Choose a country.');
    expect(fixture.nativeElement.textContent).toContain('Choose an accounting framework.');
  });

  it('uses a searchable country select while keeping accounting framework as a standard select', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    page.selectWorkspaceType('COMPANY');
    page.continueToDetails();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('liass-searchable-select')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('mat-select[formControlName="country"]')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('mat-select[formControlName="accountingFramework"]')
    ).toBeTruthy();
  });

  it('creates a company workspace, selects the returned active tenant, and redirects to dashboard', async () => {
    onboardingApi.createInitialWorkspace.mockResolvedValue(companyResponse());
    fixture.detectChanges();
    await fixture.whenStable();

    page.selectWorkspaceType('COMPANY');
    page.continueToDetails();
    page.form.controls.organizationName.setValue('Demo SARL');
    await page.submitOnboarding();
    fixture.detectChanges();

    expect(onboardingApi.createInitialWorkspace).toHaveBeenCalledWith({
      workspaceType: 'COMPANY',
      organizationName: 'Demo SARL',
      country: 'BJ',
      accountingFramework: 'SYSCOHADA_REVISED'
    });
    expect(Object.keys(onboardingApi.createInitialWorkspace.mock.calls[0][0]).sort()).toEqual([
      'accountingFramework',
      'country',
      'organizationName',
      'workspaceType'
    ]);
    expect(localStorage.getItem('liass-ohada.activeOrgId')).toBe('org-created');
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard'], { replaceUrl: true });
  });

  it('submits through the visible create button', async () => {
    onboardingApi.createInitialWorkspace.mockResolvedValue(companyResponse());
    fixture.detectChanges();
    await fixture.whenStable();

    page.selectWorkspaceType('COMPANY');
    page.continueToDetails();
    page.form.controls.organizationName.setValue('Demo SARL');
    fixture.detectChanges();

    const createButton = fixture.nativeElement.querySelector(
      'button[type="submit"]'
    ) as HTMLButtonElement;
    createButton.click();
    await fixture.whenStable();

    expect(onboardingApi.createInitialWorkspace).toHaveBeenCalledWith({
      workspaceType: 'COMPANY',
      organizationName: 'Demo SARL',
      country: 'BJ',
      accountingFramework: 'SYSCOHADA_REVISED'
    });
  });

  it('creates an accounting-firm workspace and routes to the cabinet dashboard', async () => {
    onboardingApi.createInitialWorkspace.mockResolvedValue(accountingFirmResponse());
    fixture.detectChanges();
    await fixture.whenStable();

    page.selectWorkspaceType('ACCOUNTING_FIRM');
    page.continueToDetails();
    page.form.controls.organizationName.setValue('Cabinet Demo');
    await page.submitOnboarding();
    fixture.detectChanges();

    expect(onboardingApi.createInitialWorkspace).toHaveBeenCalledWith({
      workspaceType: 'ACCOUNTING_FIRM',
      organizationName: 'Cabinet Demo',
      country: 'BJ',
      accountingFramework: 'SYSCOHADA_REVISED'
    });
    expect(localStorage.getItem('liass-ohada.activeOrgId')).toBe('org-firm');
    expect(router.navigate).toHaveBeenCalledWith(['/cabinet/dashboard'], { replaceUrl: true });
  });

  it('shows a duplicate workspace error without redirecting', async () => {
    onboardingApi.createInitialWorkspace.mockRejectedValue(
      new HttpErrorResponse({
        status: 409,
        error: { message: { code: 'WORKSPACE_ALREADY_EXISTS' } }
      })
    );
    fixture.detectChanges();
    await fixture.whenStable();

    page.selectWorkspaceType('COMPANY');
    page.continueToDetails();
    page.form.controls.organizationName.setValue('Demo SARL');
    await page.submitOnboarding();
    fixture.detectChanges();

    expect(page.onboardingErrorKey()).toBe('IDENTITY.ONBOARDING.ERRORS.DUPLICATE_WORKSPACE');
    expect(fixture.nativeElement.textContent).toContain('A workspace already exists for this account.');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('shows a network error without redirecting', async () => {
    onboardingApi.createInitialWorkspace.mockRejectedValue(new HttpErrorResponse({ status: 0 }));
    fixture.detectChanges();
    await fixture.whenStable();

    page.selectWorkspaceType('COMPANY');
    page.continueToDetails();
    page.form.controls.organizationName.setValue('Demo SARL');
    await page.submitOnboarding();
    fixture.detectChanges();

    expect(page.onboardingErrorKey()).toBe('IDENTITY.ONBOARDING.ERRORS.NETWORK');
    expect(fixture.nativeElement.textContent).toContain('network connection failed');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('shows a validation error when response schema validation fails', async () => {
    onboardingApi.createInitialWorkspace.mockRejectedValue(
      Object.assign(new Error('Invalid response'), { name: 'ZodError' })
    );
    fixture.detectChanges();
    await fixture.whenStable();

    page.selectWorkspaceType('COMPANY');
    page.continueToDetails();
    page.form.controls.organizationName.setValue('Demo SARL');
    await page.submitOnboarding();
    fixture.detectChanges();

    expect(page.onboardingErrorKey()).toBe('IDENTITY.ONBOARDING.ERRORS.VALIDATION');
    expect(fixture.nativeElement.textContent).toContain('response could not be verified');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('shows a generic translated error when workspace creation fails', async () => {
    onboardingApi.createInitialWorkspace.mockRejectedValue(new Error('boom'));
    fixture.detectChanges();
    await fixture.whenStable();

    page.selectWorkspaceType('COMPANY');
    page.continueToDetails();
    page.form.controls.organizationName.setValue('Demo SARL');
    await page.submitOnboarding();
    fixture.detectChanges();

    expect(page.onboardingErrorKey()).toBe('IDENTITY.ONBOARDING.ERRORS.CREATE_FAILED');
    expect(fixture.nativeElement.textContent).toContain('Workspace creation could not finish.');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('prevents duplicate submissions while a request is in flight', async () => {
    let resolveRequest: (response: CreateInitialWorkspaceResponse) => void = () => undefined;
    onboardingApi.createInitialWorkspace.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );
    fixture.detectChanges();
    await fixture.whenStable();

    page.selectWorkspaceType('COMPANY');
    page.continueToDetails();
    page.form.controls.organizationName.setValue('Demo SARL');
    const firstSubmission = page.submitOnboarding();
    await Promise.resolve();

    expect(page.submitting()).toBe(true);
    await page.submitOnboarding();
    expect(onboardingApi.createInitialWorkspace).toHaveBeenCalledTimes(1);

    resolveRequest(companyResponse());
    await firstSubmission;

    expect(router.navigate).toHaveBeenCalledWith(['/dashboard'], { replaceUrl: true });
  });
});
