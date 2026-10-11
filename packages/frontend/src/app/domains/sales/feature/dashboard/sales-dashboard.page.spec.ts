import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import type { ProductAccess } from '@liass-ohada/shared/shared';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { ProductAccessApi } from '../../../../core/product-access/product-access.api';
import { productAccessGuard } from '../../../../core/product-access/product-access.guard';
import { salesDashboardReadGuard } from '../../data-access/sales-dashboard-read.guard';
import { SalesCapabilities } from '../../data-access/sales-capabilities';
import { SalesDashboardPage } from './sales-dashboard.page';

@Component({ template: '<p>Platform recovery</p>' })
class RecoveryPage {}
const salesAccess: ProductAccess = {
  orgId: 'sales-only',
  productCode: 'SALES',
  status: 'ACTIVE',
  createdAt: '2026-10-11',
  updatedAt: '2026-10-11',
};
describe('Sales dashboard direct routing', () => {
  let client: QueryClient;
  const canRead = signal(true);
  const products = signal<ProductAccess[]>([salesAccess]);
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    canRead.set(true);
    products.set([salesAccess]);
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: {
            en: {
              SALES: {
                DASHBOARD: {
                  TITLE: 'Dashboard',
                  DESCRIPTION: 'Customers, catalog, and invoices',
                  CUSTOMERS: 'Manage customers',
                  ITEMS: 'Organize items',
                  INVOICES: 'Prepare invoices',
                },
              },
              SHELL: {
                NAV: {
                  SALES: 'Sales',
                  SALES_CUSTOMERS: 'Customers',
                  SALES_ITEMS: 'Items & services',
                  SALES_INVOICES: 'Invoices',
                },
              },
            },
          },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
        }),
      ],
      providers: [
        provideRouter([
          {
            path: 'sales',
            component: SalesDashboardPage,
            canActivate: [productAccessGuard, salesDashboardReadGuard],
            data: { productCode: 'SALES' },
          },
          { path: 'dashboard', component: RecoveryPage },
        ]),
        { provide: QueryClient, useValue: client },
        {
          provide: AuthStore,
          useValue: {
            effectiveOrgId: () => 'sales-only',
            isAuthenticated: () => true,
            workspacesLoaded: () => true,
          },
        },
        {
          provide: ProductAccessApi,
          useValue: { listProductAccess: () => Promise.resolve(products()) },
        },
        { provide: SalesCapabilities, useValue: { canRead } },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    client.clear();
  });
  it('opens /sales directly in a Sales-only workspace and never renders the ERP dashboard', async () => {
    const harness = await RouterTestingHarness.create('/sales');
    expect(harness.routeNativeElement?.textContent).toContain('Customers');
    expect(harness.routeNativeElement?.querySelector('liass-page-header')?.textContent).toContain(
      'Dashboard',
    );
    expect(harness.routeNativeElement?.querySelector('liass-dashboard-page')).toBeNull();
    expect(
      [...harness.routeNativeElement!.querySelectorAll('a')].map((link) =>
        link.getAttribute('href'),
      ),
    ).toEqual(['/sales/customers', '/sales/items', '/sales/invoices']);
    // Re-entry resolves the same explicit component, independently of prior local state.
    await harness.navigateByUrl('/dashboard');
    await harness.navigateByUrl('/sales', SalesDashboardPage);
    expect(harness.routeNativeElement?.textContent).toContain('Items & services');
  });
  it('rejects missing Sales entitlement', async () => {
    products.set([]);
    const harness = await RouterTestingHarness.create('/sales');
    expect(harness.routeNativeElement?.textContent).toContain('Platform recovery');
  });
  it('rejects missing Sales read permission even with the entitlement', async () => {
    canRead.set(false);
    const harness = await RouterTestingHarness.create('/sales');
    expect(harness.routeNativeElement?.textContent).toContain('Platform recovery');
  });
});
