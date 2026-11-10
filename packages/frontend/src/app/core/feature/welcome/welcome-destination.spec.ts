import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ProductAccess, ProductCode } from '@liass-ohada/shared/shared';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { RestaurantsCapabilities } from '../../../domains/restaurants/data-access/restaurants-capabilities';
import { SalesCapabilities } from '../../../domains/sales/data-access/sales-capabilities';
import { ProductAccessApi } from '../../product-access/product-access.api';
import { WelcomeDestination } from './welcome-destination';

const access = (orgId: string, productCode: ProductCode): ProductAccess => ({
  orgId, productCode, status: 'ACTIVE', createdAt: '2026-11-10', updatedAt: '2026-11-10',
});

describe('post-login application destination', () => {
  it('opens one permitted application and shows the selector for multiple, per tenant', async () => {
    const orgId = signal('org-a');
    const canReadSales = signal(false);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    TestBed.configureTestingModule({ providers: [
      { provide: QueryClient, useValue: client },
      { provide: AuthStore, useValue: {
        activeWorkspace: () => ({ orgId: orgId(), status: 'ACTIVE', workspaceType: 'COMPANY' }),
        activeWorkspaceType: () => 'COMPANY', effectiveOrgId: orgId,
        isAuthenticated: () => true, workspacesLoaded: () => true,
        canReadAccounting: () => true, workspaceDestination: () => '/dashboard',
      } },
      { provide: SalesCapabilities, useValue: { canRead: canReadSales } },
      { provide: RestaurantsCapabilities, useValue: { canRead: () => false } },
      { provide: ProductAccessApi, useValue: { listProductAccess: (id: string) =>
        Promise.resolve([access(id, 'ACCOUNTING'), access(id, 'SALES')]) } },
    ] });
    const destination = TestBed.inject(WelcomeDestination);
    expect(await destination.resolve()).toBe('/dashboard');
    canReadSales.set(true);
    expect(await destination.resolve()).toBe('/welcome');
    orgId.set('org-b');
    canReadSales.set(false);
    expect(await destination.resolve()).toBe('/dashboard');
    client.clear();
  });
});
