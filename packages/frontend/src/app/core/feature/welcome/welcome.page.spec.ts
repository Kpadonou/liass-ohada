import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { ProductAccess, ProductCode } from '@liass-ohada/shared/shared';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import fr from '../../../../../public/assets/i18n/fr.json';
import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { RestaurantsCapabilities } from '../../../domains/restaurants/data-access/restaurants-capabilities';
import { SalesCapabilities } from '../../../domains/sales/data-access/sales-capabilities';
import { shellProducts } from '../../navigation/shell-products';
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
  const canReadRestaurant = signal(true);
  const canReadSales = signal(true);
  let records: ProductAccess[];
  let client: QueryClient;
  let api: { listProductAccess: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    org.set('org-a');
    kind.set('COMPANY');
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
        { provide: SalesCapabilities, useValue: { canRead: canReadSales } },
        {
          provide: RestaurantsCapabilities,
          useValue: { canRead: canReadRestaurant },
        },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    client.clear();
  });

  it('shows authorized applications with canonical product identity and one primary action', async () => {
    const fixture = TestBed.createComponent(WelcomePage);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('liass-card h3')).toHaveLength(3);
    });
    const page: HTMLElement = fixture.nativeElement;
    expect(page.textContent).toContain('Choisissez votre application');
    expect(page.textContent).toContain("Sélectionnez l'application que vous souhaitez utiliser.");
    expect(page.textContent).toContain('Applications');
    expect(page.textContent).toContain('Facturation');
    expect(page.textContent).toContain('journaux et écritures');
    expect(page.textContent).toContain('clients, articles et factures');
    expect(page.textContent).toContain('menus, commandes, encaissements et stocks');
    expect(
      [...page.querySelectorAll('liass-card h3')].map((heading) => heading.textContent?.trim()),
    ).toEqual(['Comptabilité', 'Facturation', 'Liass-Resto']);
    expect(page.querySelector('header > span')?.classList.contains('bg-brand-gold')).toBe(true);
    expect(page.querySelector('liass-app-sidebar')).toBeNull();
    expect(page.querySelector('section > div.grid')?.className).toContain('sm:grid-cols-2');
    expect(page.querySelector('section > div.grid')?.className).toContain('lg:grid-cols-3');
    expect(page.querySelectorAll('liass-card h3')).toHaveLength(3);
    expect(page.querySelector('liass-logo')?.getAttribute('size')).toBe('xl');
    expect(page.querySelector('liass-logo span')?.className).toContain('h-24');
    expect(
      [...page.querySelectorAll('liass-card')].map((card) =>
        card.querySelector('mat-icon')?.textContent?.trim(),
      ),
    ).toEqual(['calculate', 'receipt_long', 'restaurant']);
    expect(shellProducts.map((product) => product.iconClass)).toEqual([
      'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300',
      'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300',
      'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300',
    ]);
    expect(
      [...page.querySelectorAll('[data-testid="welcome-product-icon"]')].map((icon) =>
        icon.classList.contains('bg-brand-50') && icon.classList.contains('text-brand-700'),
      ),
    ).toEqual([true, true, true]);
    const actions = [...page.querySelectorAll('liass-card liass-button')];
    const open = [...page.querySelectorAll('liass-card liass-button')].filter((button) =>
      button.textContent?.includes('Ouvrir'),
    );
    expect(actions).toHaveLength(3);
    expect(open).toHaveLength(3);
    expect(
      open.every((button) => button.querySelector('button')?.className.includes('bg-brand-700')),
    ).toBe(true);
    expect(page.textContent).not.toContain('Configurer');
    expect(open.every((button) => button.parentElement?.className.includes('justify-end'))).toBe(
      true,
    );
    const firstAction = open[0].querySelector('button')!;
    firstAction.focus();
    expect(document.activeElement).toBe(firstAction);
    expect(firstAction.className).toContain('liass-focus-ring');
  });

  it('opens each application at its existing landing destination', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(WelcomePage);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('liass-card h3')).toHaveLength(3);
    });
    const cards = fixture.nativeElement.querySelectorAll('liass-card');
    cards[0].querySelector('liass-button button')?.click();
    cards[1].querySelector('liass-button button')?.click();
    cards[2].querySelector('liass-button button')?.click();
    expect(navigate.mock.calls).toEqual([['/dashboard'], ['/sales'], ['/restaurants']]);
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
    expect(buttons).toHaveLength(1);
    buttons[0].click();
    expect(navigate).toHaveBeenCalledWith('/cabinet/dashboard');
  });

  it('hides unreadable applications without restricting a readable product to setup managers', async () => {
    canReadSales.set(false);
    const fixture = TestBed.createComponent(WelcomePage);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('liass-card')).toHaveLength(2);
    });
    expect(fixture.nativeElement.textContent).not.toContain('Facturation');
    const restaurantButton = fixture.nativeElement
      .querySelectorAll('liass-card')[1]
      .querySelector('liass-button button');
    expect(restaurantButton.disabled).toBe(false);
  });
});
