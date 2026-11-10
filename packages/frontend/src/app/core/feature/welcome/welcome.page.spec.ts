import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { ProductAccess, ProductCode } from '@liass-ohada/shared/shared';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import fr from '../../../../../public/assets/i18n/fr.json';
import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { CabinetSettingsCapabilities } from '../../../domains/identity/data-access/cabinet-settings-capabilities';
import { RestaurantsCapabilities } from '../../../domains/restaurants/data-access/restaurants-capabilities';
import { SalesCapabilities } from '../../../domains/sales/data-access/sales-capabilities';
import { ProductAccessApi } from '../../product-access/product-access.api';
import { WelcomePage } from './welcome.page';

const access = (orgId: string, productCode: ProductCode): ProductAccess => ({
  orgId,
  productCode,
  status: 'ACTIVE',
  createdAt: '2026-11-10',
  updatedAt: '2026-11-10',
});

describe('post-onboarding welcome', () => {
  const org = signal('org-a');
  const kind = signal<'COMPANY' | 'ACCOUNTING_FIRM'>('COMPANY');
  const canManageRestaurant = signal(true);
  const canReadRestaurant = signal(true);
  const canReadSales = signal(true);
  let records: ProductAccess[];
  let client: QueryClient;
  let api: { listProductAccess: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    org.set('org-a');
    kind.set('COMPANY');
    canManageRestaurant.set(true);
    canReadRestaurant.set(true);
    canReadSales.set(true);
    records = [
      access('org-a', 'ACCOUNTING'),
      access('org-a', 'SALES'),
      access('org-a', 'RESTAURANTS'),
    ];
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api = {
      listProductAccess: vi.fn((id: string) =>
        Promise.resolve(id === 'org-a' ? records : [access(id, 'SALES')]),
      ),
    };
    TestBed.configureTestingModule({
      imports: [
        WelcomePage,
        TranslocoTestingModule.forRoot({
          langs: { fr },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
        }),
      ],
      providers: [
        provideRouter([]),
        { provide: QueryClient, useValue: client },
        { provide: ProductAccessApi, useValue: api },
        {
          provide: AuthStore,
          useValue: {
            activeWorkspaceOrgId: org,
            effectiveOrgId: () => (kind() === 'COMPANY' ? org() : null),
            activeWorkspace: () => ({
              orgId: org(),
              status: 'ACTIVE',
              workspaceType: kind(),
              role: 'OWNER',
            }),
            activeWorkspaceType: kind,
            activeWorkspaceDisplayName: () => (kind() === 'COMPANY' ? 'REM SI' : 'Cabinet REM'),
            isAuthenticated: () => true,
            workspacesLoaded: () => true,
            canWriteAccounting: () => true,
            canReadAccounting: () => true,
          },
        },
        {
          provide: CabinetSettingsCapabilities,
          useValue: { canManageCabinetSettings: () => true },
        },
        { provide: SalesCapabilities, useValue: { canRead: canReadSales, canWrite: canReadSales } },
        {
          provide: RestaurantsCapabilities,
          useValue: {
            canRead: canReadRestaurant,
            canManageSetup: canManageRestaurant,
          },
        },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    client.clear();
  });

  it('shows only authorized applications with inline icons and uniform action styles', async () => {
    const fixture = TestBed.createComponent(WelcomePage);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('liass-card h3')).toHaveLength(3);
    });
    const page: HTMLElement = fixture.nativeElement;
    expect(page.textContent).toContain('Choisissez votre application');
    expect(page.textContent).toContain("Sélectionnez l'application que vous souhaitez utiliser.");
    expect(page.textContent).toContain('Applications');
    expect(page.textContent).toContain('journaux et écritures');
    expect(page.textContent).toContain('clients, articles et factures');
    expect(page.textContent).toContain('menus, commandes, encaissements et stocks');
    expect(page.querySelector('liass-app-sidebar')).toBeNull();
    expect(page.querySelector('section > div.grid')?.className).toContain('sm:grid-cols-2');
    expect(page.querySelector('section > div.grid')?.className).toContain('lg:grid-cols-3');
    expect(page.querySelectorAll('liass-card h3')).toHaveLength(3);
    expect(
      page.querySelectorAll('liass-card h3')[0].parentElement?.querySelector('mat-icon')
        ?.textContent,
    ).toContain('calculate');
    const configure = [...page.querySelectorAll('liass-card liass-button')].filter((button) =>
      button.textContent?.includes('Configurer'),
    );
    const open = [...page.querySelectorAll('liass-card liass-button')].filter((button) =>
      button.textContent?.includes('Ouvrir'),
    );
    expect(configure).toHaveLength(3);
    expect(open).toHaveLength(3);
    expect(
      configure.every((button) =>
        button.querySelector('button')?.className.includes('bg-brand-700'),
      ),
    ).toBe(true);
    expect(
      open.every((button) =>
        button.querySelector('button')?.className.includes('border-slate-200'),
      ),
    ).toBe(true);
    expect(page.querySelectorAll('liass-card mat-icon')[0].parentElement?.className).toContain(
      'text-brand-700',
    );
    expect(page.querySelectorAll('liass-card mat-icon')[3].parentElement?.className).toContain(
      'text-success-600',
    );
    expect(page.querySelectorAll('liass-card mat-icon')[6].parentElement?.className).toContain(
      'text-warning-600',
    );
    const firstAction = configure[0].querySelector('button')!;
    firstAction.focus();
    expect(document.activeElement).toBe(firstAction);
    expect(firstAction.className).toContain('liass-focus-ring');
  });

  it('routes both actions to existing workflows without setup blocking', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(WelcomePage);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('liass-card h3')).toHaveLength(3);
    });
    const cards = fixture.nativeElement.querySelectorAll('liass-card');
    cards[0].querySelectorAll('liass-button button')[0].click();
    cards[0].querySelectorAll('liass-button button')[1].click();
    cards[1].querySelectorAll('liass-button button')[0].click();
    cards[2].querySelectorAll('liass-button button')[0].click();
    expect(navigate).toHaveBeenCalledWith('/accounting/fiscal-years');
    expect(navigate).toHaveBeenCalledWith('/dashboard');
    expect(navigate).toHaveBeenCalledWith('/sales/items');
    expect(navigate).toHaveBeenCalledWith('/restaurants/setup');
  });

  it('updates with organization and entitlement changes and preserves a one-card layout', async () => {
    records = [access('org-a', 'ACCOUNTING')];
    const fixture = TestBed.createComponent(WelcomePage);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('liass-card')).toHaveLength(1);
    });
    expect(fixture.nativeElement.textContent).toContain('Comptabilité');
    org.set('org-b');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Facturation');
    });
    expect(fixture.nativeElement.textContent).not.toContain('Comptabilité');
    expect(api.listProductAccess).toHaveBeenCalledWith('org-b');
  });

  it('uses cabinet destinations without presenting company-only applications', () => {
    kind.set('ACCOUNTING_FIRM');
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(WelcomePage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('liass-card')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).not.toContain('Liass-Resto');
    expect(fixture.nativeElement.textContent).toContain('dossiers clients, missions et échéances');
    const buttons = fixture.nativeElement.querySelectorAll('liass-card liass-button button');
    buttons[0].click();
    buttons[1].click();
    expect(navigate).toHaveBeenCalledWith('/cabinet/settings');
    expect(navigate).toHaveBeenCalledWith('/cabinet/dashboard');
  });

  it('removes inaccessible apps and disables unauthorized configuration', async () => {
    canReadSales.set(false);
    canManageRestaurant.set(false);
    const fixture = TestBed.createComponent(WelcomePage);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('liass-card')).toHaveLength(2);
    });
    expect(fixture.nativeElement.textContent).not.toContain('Facturation');
    const restaurantButtons = fixture.nativeElement
      .querySelectorAll('liass-card')[1]
      .querySelectorAll('liass-button button');
    expect(restaurantButtons[0].disabled).toBe(true);
    expect(restaurantButtons[1].disabled).toBe(false);
  });
});
