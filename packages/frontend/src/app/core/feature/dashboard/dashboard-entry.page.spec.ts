import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query-experimental';
import type { ProductAccess, ProductCode } from '@liass-ohada/shared/shared';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { SalesCapabilities } from '../../../domains/sales/data-access/sales-capabilities';
import { ProductAccessApi } from '../../product-access/product-access.api';
import { UiStore } from '../../state/ui.store';
import { DashboardEntryPage } from './dashboard-entry.page';

const entitlement = (orgId: string, productCode: ProductCode): ProductAccess => ({
  orgId,
  productCode,
  status: 'ACTIVE',
  createdAt: '2026-10-11',
  updatedAt: '2026-10-11',
});
describe('Platform dashboard recovery and Accounting ownership', () => {
  let client: QueryClient;
  const org = signal('a');
  let records: ProductAccess[];
  beforeEach(() => {
    org.set('a');
    records = [];
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    TestBed.configureTestingModule({
      imports: [
        DashboardEntryPage,
        TranslocoTestingModule.forRoot({
          langs: {
            en: {
              SHELL: {
                PAGES: { DASHBOARD: 'Dashboard' },
                TOPBAR: { NO_ACCESSIBLE_PRODUCT: 'No accessible products' },
              },
            },
          },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
        }),
      ],
      providers: [
        provideRouter([]),
        { provide: QueryClient, useValue: client },
        {
          provide: AuthStore,
          useValue: {
            effectiveOrgId: org,
            isAuthenticated: () => true,
            workspacesLoaded: () => true,
          },
        },
        { provide: UiStore, useValue: { currentPage: () => 'dashboard' } },
        { provide: SalesCapabilities, useValue: { canRead: () => true } },
        {
          provide: ProductAccessApi,
          useValue: {
            listProductAccess: (id: string) =>
              Promise.resolve(id === 'a' ? records : [entitlement(id, 'SALES')]),
          },
        },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    client.clear();
  });
  it('keeps the existing Accounting ERP dashboard at /dashboard when entitled', async () => {
    records = [entitlement('a', 'ACCOUNTING'), entitlement('a', 'SALES')];
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(DashboardEntryPage);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('liass-dashboard-page')).not.toBeNull();
    });
    expect(navigate).not.toHaveBeenCalled();
    org.set('b');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('liass-dashboard-page')).toBeNull();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(navigate).toHaveBeenCalledWith('/sales', { replaceUrl: true });
    });
  });
  it.each(['SALES', 'RESTAURANTS'] as const)(
    'redirects a %s-only workspace without rendering Accounting',
    async (product) => {
      records = [entitlement('a', product)];
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      const fixture = TestBed.createComponent(DashboardEntryPage);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(navigate).toHaveBeenCalledWith(product === 'SALES' ? '/sales' : '/restaurants', {
          replaceUrl: true,
        });
      });
      expect(fixture.nativeElement.querySelector('liass-dashboard-page')).toBeNull();
    },
  );
  it('remains a non-looping recovery surface with no accessible products', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(DashboardEntryPage);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('No accessible products');
    });
    expect(fixture.nativeElement.querySelector('liass-dashboard-page')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
