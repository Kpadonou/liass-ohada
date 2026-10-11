import { HttpErrorResponse } from '@angular/common/http';
import { FormGroup, FormControl } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  CreateInitialWorkspaceResponseSchema,
  type CreateInitialWorkspaceResponse,
  type ProductCode,
  restaurantsPermissionsForRole
} from '@liass-ohada/shared/shared';
import { TranslocoService, TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';
import { AuthStore } from '../../data-access/auth.store';
import { OnboardingApi } from '../../data-access/onboarding.api';
import { WorkspacesApi } from '../../data-access/workspaces.api';
import {
  ProductAccessQueries,
  productAccessQueryKeys
} from '../../../../core/product-access/product-access.queries';
import { ProductAccessApi } from '../../../../core/product-access/product-access.api';
import { resolveProductAvailability } from '../../../../core/product-access/product-availability';
import { productAccessGuard } from '../../../../core/product-access/product-access.guard';
import { OnboardingPage } from './onboarding.page';

const copy = {
  EYEBROW: 'Onboarding',
  TITLE: 'Welcome to Liass-OHADA',
  INTENT_QUESTION: 'Choose your workspace type',
  SUBTITLE: 'Choose your workspace.',
  STEPS: {
    LABEL: 'Workspace creation steps',
    INTENT: 'Workspace type',
    ORGANIZATION: 'Organization',
    PRODUCTS: 'Products',
    CONFIGURATION: 'Configuration',
    REVIEW: 'Review',
    PROGRESS: 'Step {{ current }} of {{ total }}'
  },
  INTENTS: {
    SELECTED: 'Selected',
    COMPANY: { TITLE: 'Company', DESCRIPTION: 'Choose products for your organization.' },
    ACCOUNTING_FIRM: {
      TITLE: 'Accounting firm',
      DESCRIPTION: 'Bring your clients and team together.'
    }
  },
  ORGANIZATION: {
    COMPANY_TITLE: 'Your organization',
    COMPANY_DESCRIPTION: 'Provide organization information.',
    CABINET_TITLE: 'Your accounting firm',
    CABINET_DESCRIPTION: 'Provide firm information.'
  },
  PRODUCTS: {
    TITLE: 'Choose your products',
    DESCRIPTION: 'Select one or more independent products.',
    ACCOUNTING: { TITLE: 'Accounting', DESCRIPTION: 'Accounting, treasury and projects.' },
    SALES: { TITLE: 'Invoicing', DESCRIPTION: 'Customers, catalog and invoicing.' },
    RESTAURANTS: { TITLE: 'Liass-Resto', DESCRIPTION: 'Restaurant setup, menu and tables.' }
  },
  CONFIGURATION: {
    ACCOUNTING_TITLE: 'Accounting configuration',
    ACCOUNTING_DESCRIPTION: 'Choose your framework.',
    CABINET_TITLE: 'Preferences for new client companies',
    CABINET_DESCRIPTION: 'Prepare future dossiers.'
  },
  REVIEW: { TITLE: 'Review your workspace', DESCRIPTION: 'Check your choices.' },
  FIELDS: {
    COMPANY_NAME: 'Company name',
    ACCOUNTING_FIRM_NAME: 'Accounting firm name',
    COUNTRY: 'Country',
    ACCOUNTING_FRAMEWORK: 'Accounting framework',
    DEFAULT_ACCOUNTING_FRAMEWORK: 'Default suggested framework',
    DEFAULT_ACCOUNTING_FRAMEWORK_HELPER: 'Can be adapted for each dossier.'
  },
  FRAMEWORKS: { SYSCOHADA_REVISED: 'Revised SYSCOHADA', SYCEBNL: 'SYCEBNL' },
  COUNTRIES: { BENIN: 'Benin' },
  ACTIONS: {
    BACK: 'Back',
    CONTINUE: 'Continue',
    SUBMIT: 'Create workspace',
    SUBMITTING: 'Creating workspace...'
  },
  VALIDATION: {
    INTENT: 'Choose a workspace type.',
    PRODUCTS: 'Select at least one product to continue.',
    ORGANIZATION_NAME: 'Enter an organization name.',
    COUNTRY: 'Choose a country.',
    ACCOUNTING_FRAMEWORK: 'Choose an accounting framework.'
  },
  ERRORS: {
    AUTH_REQUIRED: 'Sign in again.',
    CREATE_FAILED: 'Creation could not finish.',
    DUPLICATE_WORKSPACE: 'A workspace already exists.',
    MISSING_ROUTE: 'Creation unavailable.',
    NETWORK: 'Network failed.',
    SERVER: 'Service error.',
    VALIDATION: 'The response could not be verified.'
  }
};
const translations = {
  en: {
    COMMON: { SELECT: { NO_RESULTS: 'No results', SEARCH_PLACEHOLDER: 'Search...' } },
    IDENTITY: { ONBOARDING: copy }
  },
  fr: {
    COMMON: { SELECT: { NO_RESULTS: 'Aucun résultat', SEARCH_PLACEHOLDER: 'Rechercher...' } },
    IDENTITY: {
      ONBOARDING: {
        ...copy,
        TITLE: 'Bienvenue sur Liass-OHADA',
        INTENTS: {
          ...copy.INTENTS,
          COMPANY: { TITLE: 'Entreprise', DESCRIPTION: 'Choisissez vos produits.' }
        },
        PRODUCTS: {
          ...copy.PRODUCTS,
          ACCOUNTING: { TITLE: 'Comptabilité', DESCRIPTION: 'Comptabilité et trésorerie.' },
          SALES: { TITLE: 'Facturation', DESCRIPTION: 'Clients et facturation.' }
        }
      }
    }
  }
};
const combinations: ProductCode[][] = [
  ['ACCOUNTING'],
  ['SALES'],
  ['RESTAURANTS'],
  ['ACCOUNTING', 'SALES'],
  ['ACCOUNTING', 'RESTAURANTS'],
  ['SALES', 'RESTAURANTS'],
  ['ACCOUNTING', 'SALES', 'RESTAURANTS']
];
const timestamp = '2026-10-10T00:00:00.000Z';
function response(
  products: ProductCode[] = ['ACCOUNTING'],
  firm = false
): CreateInitialWorkspaceResponse {
  const orgId = firm ? 'org-firm' : 'org-created';
  const framework = products.includes('ACCOUNTING')
    ? { accountingFramework: 'SYSCOHADA_REVISED' }
    : {};
  return CreateInitialWorkspaceResponseSchema.parse({
    organization: {
      orgId,
      name: firm ? 'Cabinet Demo' : 'Héritage Bistro',
      country: 'BJ',
      workspaceType: firm ? 'ACCOUNTING_FIRM' : 'COMPANY',
      status: 'ACTIVE',
      createdAt: timestamp,
      updatedAt: timestamp,
      ...framework
    },
    cabinet: firm
      ? {
          cabinetId: 'cab-created',
          orgId,
          name: 'Cabinet Demo',
          country: 'BJ',
          status: 'ACTIVE',
          ownerUserId: 'user-123',
          createdAt: timestamp,
          updatedAt: timestamp
        }
      : null,
    workspace: {
      orgId,
      role: 'OWNER',
      accessSource: 'DIRECT',
      displayName: firm ? 'Cabinet Demo' : 'Héritage Bistro',
      workspaceType: firm ? 'ACCOUNTING_FIRM' : 'COMPANY',
      status: 'ACTIVE',
      country: 'BJ',
      ...framework,
      ...(firm ? { cabinetId: 'cab-created', cabinetRole: 'CABINET_ADMIN' } : {}),
      ...(products.includes('RESTAURANTS') ? { productRoles: { RESTAURANTS: 'OWNER' } } : {})
    },
    activeOrgId: orgId,
    productAccess: products.map((productCode) => ({
      orgId,
      productCode,
      status: 'ACTIVE',
      createdAt: timestamp,
      updatedAt: timestamp
    }))
  });
}
type Harness = {
  selectIntent: (intent: 'COMPANY' | 'ACCOUNTING_FIRM') => void;
  continueFromIntent: () => void;
  continueFromOrganization: () => void;
  continueFromProducts: () => void;
  continueFromConfiguration: () => void;
  toggleProduct: (product: ProductCode) => void;
  back: () => void;
  submitOnboarding: () => Promise<void>;
  currentStep: () => string;
  selectedProducts: () => readonly ProductCode[];
  submitting: () => boolean;
  onboardingErrorKey: () => string | null;
  form: FormGroup<{
    workspaceType: FormControl<string>;
    organizationName: FormControl<string>;
    country: FormControl<string>;
    accountingFramework: FormControl<string>;
  }>;
};
describe('multi-product onboarding', () => {
  let fixture: ComponentFixture<OnboardingPage>,
    page: Harness,
    router: Router,
    queryClient: QueryClient;
  let onboardingApi: { createInitialWorkspace: ReturnType<typeof vi.fn> };
  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    onboardingApi = { createInitialWorkspace: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [
        OnboardingPage,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en', 'fr'], defaultLang: 'en' }
        })
      ],
      providers: [
        provideRouter([]),
        { provide: QueryClient, useValue: queryClient },
        { provide: OnboardingApi, useValue: onboardingApi },
        { provide: WorkspacesApi, useValue: { listWorkspaces: vi.fn().mockResolvedValue([]) } },
        {
          provide: ProductAccessApi,
          useValue: {
            listProductAccess: vi
              .fn()
              .mockRejectedValue(new Error('No network expected for seeded access'))
          }
        }
      ]
    }).compileComponents();
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(OnboardingPage);
    page = fixture.componentInstance as unknown as Harness;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });
  afterEach(() => {
    fixture.destroy();
    queryClient.clear();
  });
  function organization(firm = false) {
    page.selectIntent(firm ? 'ACCOUNTING_FIRM' : 'COMPANY');
    page.continueFromIntent();
    page.form.controls.organizationName.setValue(firm ? 'Cabinet Demo' : 'Héritage Bistro');
    page.continueFromOrganization();
    fixture.detectChanges();
  }
  function review(products: ProductCode[] = ['ACCOUNTING']) {
    organization();
    products.forEach((product) => page.toggleProduct(product));
    page.continueFromProducts();
    if (products.includes('ACCOUNTING')) {
      page.form.controls.accountingFramework.setValue('SYSCOHADA_REVISED');
      page.continueFromConfiguration();
    }
    fixture.detectChanges();
  }

  it('offers Company and Accounting Firm with native keyboard buttons and no fiscal offer', () => {
    const buttons: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('button[aria-pressed]')
    );
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.type === 'button')).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Company');
    expect(fixture.nativeElement.textContent).toContain('Accounting firm');
    expect(fixture.nativeElement.textContent).not.toMatch(
      /COMPANY|ACCOUNTING_FIRM|e-MECeF|Liass-Facturation/
    );
    page.continueFromIntent();
    fixture.detectChanges();
    expect(page.currentStep()).toBe('intent');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
  });
  it('requires organization information before products and trims the name for creation', () => {
    page.selectIntent('COMPANY');
    page.continueFromIntent();
    page.form.controls.organizationName.setValue('   ');
    page.continueFromOrganization();
    expect(page.currentStep()).toBe('organization');
    page.form.controls.organizationName.setValue('  Héritage Bistro  ');
    page.continueFromOrganization();
    expect(page.currentStep()).toBe('products');
  });
  it('offers exactly three independent product cards and blocks empty selection with an associated error', () => {
    organization();
    expect(page.selectedProducts()).toEqual([]);
    const buttons = fixture.nativeElement.querySelectorAll('button[aria-pressed]');
    expect(buttons).toHaveLength(3);
    expect(fixture.nativeElement.textContent).toContain('Liass-Resto');
    expect(fixture.nativeElement.textContent).toContain('Invoicing');
    expect(fixture.nativeElement.textContent).not.toMatch(/RESTAURANTS|EMECEF|Fiscal Compliance/);
    page.continueFromProducts();
    fixture.detectChanges();
    expect(page.currentStep()).toBe('products');
    expect(fixture.nativeElement.querySelector('#products-error').textContent).toContain(
      'Select at least one'
    );
    expect(
      fixture.nativeElement.querySelectorAll('button[aria-describedby="products-error"]')
    ).toHaveLength(3);
  });
  it.each(combinations.map((products) => [products] as const))(
    'reviews and submits exactly %j with response-driven routing',
    async (products) => {
      onboardingApi.createInitialWorkspace.mockResolvedValue(response(products));
      review(products);
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Héritage Bistro');
      expect(text).toContain('Benin');
      for (const [product, label] of [
        ['ACCOUNTING', 'Accounting'],
        ['SALES', 'Invoicing'],
        ['RESTAURANTS', 'Liass-Resto']
      ] as const) {
        const summary = fixture.nativeElement.querySelector('dl').textContent;
        expect(summary.includes(label)).toBe(products.includes(product));
      }
      await page.submitOnboarding();
      expect(onboardingApi.createInitialWorkspace).toHaveBeenCalledWith({
        workspaceType: 'COMPANY',
        organizationName: 'Héritage Bistro',
        country: 'BJ',
        products,
        ...(products.includes('ACCOUNTING') ? { accountingFramework: 'SYSCOHADA_REVISED' } : {})
      });
      const destination =
        products.length === 1 && products[0] === 'RESTAURANTS'
          ? '/restaurants'
          : products.length === 1 && products[0] === 'SALES'
            ? '/sales'
            : '/dashboard';
      expect(router.navigate).toHaveBeenCalledWith([destination], { replaceUrl: true });
      expect(TestBed.inject(AuthStore).effectiveOrgId()).toBe('org-created');
      expect(queryClient.getQueryData(productAccessQueryKeys.list('org-created'))).toEqual(
        response(products).productAccess
      );
    }
  );
  it('requires a framework only for Accounting, preserves normal back navigation, and removes deselected configuration', async () => {
    organization();
    page.toggleProduct('ACCOUNTING');
    page.continueFromProducts();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('mat-select[formControlName="accountingFramework"]')
    ).toBeTruthy();
    page.continueFromConfiguration();
    fixture.detectChanges();
    expect(page.currentStep()).toBe('configuration');
    expect(fixture.nativeElement.textContent).toContain('Choose an accounting framework.');
    page.form.controls.accountingFramework.setValue('SYSCOHADA_REVISED');
    page.continueFromConfiguration();
    page.back();
    expect(page.form.controls.accountingFramework.value).toBe('SYSCOHADA_REVISED');
    page.back();
    page.toggleProduct('ACCOUNTING');
    page.toggleProduct('RESTAURANTS');
    expect(page.form.controls.accountingFramework.value).toBe('');
    page.continueFromProducts();
    fixture.detectChanges();
    expect(page.currentStep()).toBe('review');
    expect(fixture.nativeElement.textContent).not.toContain('Accounting framework');
    expect(fixture.nativeElement.querySelector('mat-select')).toBeNull();
    onboardingApi.createInitialWorkspace.mockResolvedValue(response(['RESTAURANTS']));
    await page.submitOnboarding();
    expect(onboardingApi.createInitialWorkspace.mock.calls[0][0]).not.toHaveProperty(
      'accountingFramework'
    );
  });
  it('toggles products without duplicates or implicit dependencies and restores required framework validation', () => {
    organization();
    page.toggleProduct('ACCOUNTING');
    page.form.controls.accountingFramework.setValue('SYSCOHADA_REVISED');
    page.toggleProduct('ACCOUNTING');
    page.toggleProduct('ACCOUNTING');
    expect(page.selectedProducts()).toEqual(['ACCOUNTING']);
    expect(page.form.controls.accountingFramework.value).toBe('');
    expect(page.form.controls.accountingFramework.invalid).toBe(true);
    page.toggleProduct('ACCOUNTING');
    page.toggleProduct('SALES');
    expect(page.selectedProducts()).toEqual(['SALES']);
    expect(page.form.valid).toBe(true);
  });
  it('preserves the complete firm request and cabinet destination without product selection', async () => {
    organization(true);
    expect(page.currentStep()).toBe('configuration');
    expect(fixture.nativeElement.textContent).toContain('Default suggested framework');
    page.continueFromConfiguration();
    expect(page.currentStep()).toBe('configuration');
    page.form.controls.accountingFramework.setValue('SYCEBNL');
    page.continueFromConfiguration();
    fixture.detectChanges();
    onboardingApi.createInitialWorkspace.mockResolvedValue(response(['ACCOUNTING'], true));
    await page.submitOnboarding();
    expect(onboardingApi.createInitialWorkspace).toHaveBeenCalledWith({
      workspaceType: 'ACCOUNTING_FIRM',
      organizationName: 'Cabinet Demo',
      country: 'BJ',
      accountingFramework: 'SYCEBNL'
    });
    expect(router.navigate).toHaveBeenCalledWith(['/cabinet/dashboard'], { replaceUrl: true });
    expect(TestBed.inject(AuthStore).activeWorkspace()?.cabinetId).toBe('cab-created');
  });
  it('clears product configuration when changing workspace type but preserves organization fields', () => {
    review(['ACCOUNTING', 'RESTAURANTS']);
    page.back();
    page.back();
    page.back();
    page.back();
    expect(page.currentStep()).toBe('intent');
    page.selectIntent('ACCOUNTING_FIRM');
    expect(page.selectedProducts()).toEqual([]);
    expect(page.form.controls.accountingFramework.value).toBe('');
    expect(page.form.controls.organizationName.value).toBe('Héritage Bistro');
  });
  it('makes seeded RESTAURANTS available to the actual guard without a reload or previous-organization data', async () => {
    const old = response(['ACCOUNTING']).productAccess!;
    queryClient.setQueryData(productAccessQueryKeys.list('org-previous'), old);
    queryClient.setQueryData(productAccessQueryKeys.list('org-created'), []);
    onboardingApi.createInitialWorkspace.mockResolvedValue(response(['RESTAURANTS']));
    review(['RESTAURANTS']);
    await page.submitOnboarding();
    const queries = TestBed.inject(ProductAccessQueries);
    const access = await queryClient.fetchQuery(queries.list());
    expect(resolveProductAvailability(access, 'RESTAURANTS', true)).toBe('AVAILABLE');
    expect(resolveProductAvailability(access, 'ACCOUNTING', true)).not.toBe('AVAILABLE');
    expect(resolveProductAvailability(access, 'SALES', true)).not.toBe('AVAILABLE');
    expect(
      await TestBed.runInInjectionContext(() =>
        productAccessGuard({ data: { productCode: 'RESTAURANTS' } } as never, {} as never)
      )
    ).toBe(true);
    expect(
      restaurantsPermissionsForRole(
        TestBed.inject(AuthStore).activeWorkspace()?.productRoles?.RESTAURANTS
      )
    ).toEqual(expect.arrayContaining(['RESTAURANTS_SETUP_MANAGE', 'RESTAURANTS_MENU_MANAGE']));
    expect(TestBed.inject(ProductAccessApi).listProductAccess).not.toHaveBeenCalled();
  });
  it.each([
    [
      new HttpErrorResponse({
        status: 409,
        error: { message: { code: 'WORKSPACE_ALREADY_EXISTS' } }
      }),
      'DUPLICATE_WORKSPACE'
    ],
    [new HttpErrorResponse({ status: 0 }), 'NETWORK'],
    [new HttpErrorResponse({ status: 400 }), 'VALIDATION'],
    [new HttpErrorResponse({ status: 500 }), 'SERVER'],
    [Object.assign(new Error('Invalid response'), { name: 'ZodError' }), 'VALIDATION'],
    [new Error('Failure'), 'CREATE_FAILED']
  ] as const)('keeps failed creation contextual and retains state (%s)', async (error, code) => {
    onboardingApi.createInitialWorkspace.mockRejectedValue(error);
    review(['RESTAURANTS']);
    await page.submitOnboarding();
    fixture.detectChanges();
    expect(page.onboardingErrorKey()).toBe(`IDENTITY.ONBOARDING.ERRORS.${code}`);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(page.selectedProducts()).toEqual(['RESTAURANTS']);
  });
  it('prevents double submissions and announces busy state', async () => {
    let resolve!: (value: CreateInitialWorkspaceResponse) => void;
    onboardingApi.createInitialWorkspace.mockReturnValue(
      new Promise<CreateInitialWorkspaceResponse>((done) => (resolve = done))
    );
    review(['RESTAURANTS']);
    const pending = page.submitOnboarding();
    fixture.detectChanges();
    expect(page.submitting()).toBe(true);
    expect(fixture.nativeElement.querySelector('form').getAttribute('aria-busy')).toBe('true');
    await page.submitOnboarding();
    page.back();
    expect(page.currentStep()).toBe('review');
    expect(onboardingApi.createInitialWorkspace).toHaveBeenCalledTimes(1);
    resolve(response(['RESTAURANTS']));
    await pending;
  });
  it('uses translated French product names and focusable step headings', () => {
    TestBed.inject(TranslocoService).setActiveLang('fr');
    organization();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Comptabilité');
    expect(fixture.nativeElement.textContent).toContain('Facturation');
    expect(fixture.nativeElement.textContent).toContain('Liass-Resto');
    expect(fixture.nativeElement.querySelector('h2').getAttribute('tabindex')).toBe('-1');
    expect(fixture.nativeElement.querySelector('[aria-current="step"]')).toBeTruthy();
  });
});
