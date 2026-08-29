import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { SalesCatalogItem } from '@liass-ohada/shared/sales';

import { environment } from '../../../../environments/environment';
import { SalesItemsApi } from './sales-items.api';

describe('SalesItemsApi', () => {
  let api: SalesItemsApi;
  let http: HttpTestingController;
  const baseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(SalesItemsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists one cursor page and passes the opaque cursor through unchanged', async () => {
    const promise = api.list({ limit: 50, cursor: 'opaque+/=cursor' });
    const request = http.expectOne((candidate) => candidate.url === `${baseUrl}/sales/items`);
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('limit')).toBe('50');
    expect(request.request.params.get('cursor')).toBe('opaque+/=cursor');
    request.flush({ data: { items: [item()], nextCursor: 'next-opaque' } });
    await expect(promise).resolves.toEqual({ items: [item()], nextCursor: 'next-opaque' });
  });

  it('creates only the shared Catalog fields without tenant or deferred fields', async () => {
    const promise = api.create({ itemType: 'SERVICE', name: 'Conseil', description: 'Appui', unit: 'Heure' });
    const request = http.expectOne(`${baseUrl}/sales/items`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ itemType: 'SERVICE', name: 'Conseil', description: 'Appui', unit: 'Heure' });
    for (const excluded of ['orgId', 'userId', 'id', 'isActive', 'version', 'price', 'currency', 'taxRate', 'stock', 'sku', 'barcode', 'customerId']) {
      expect(request.request.body).not.toHaveProperty(excluded);
    }
    request.flush({ data: item(), message: 'Created.' });
    await expect(promise).resolves.toEqual({ data: item(), message: 'Created.' });
  });

  it('uses PATCH with the authoritative expectedVersion', async () => {
    const promise = api.update('SI/1', { expectedVersion: 7, itemType: 'PRODUCT', name: 'Portable' });
    const request = http.expectOne(`${baseUrl}/sales/items/SI%2F1`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ expectedVersion: 7, itemType: 'PRODUCT', name: 'Portable' });
    request.flush({ data: item({ id: 'SI/1', version: 8 }) });
    await promise;
  });

  it.each(['activate', 'deactivate'] as const)(
    'uses the exact %s route with only expectedVersion in the body',
    async (action) => {
      const promise = api[action]('SI-1', 7);
      const request = http.expectOne(`${baseUrl}/sales/items/SI-1/${action}`);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ expectedVersion: 7 });
      expect(request.request.body).not.toHaveProperty('itemId');
      expect(request.request.body).not.toHaveProperty('orgId');
      request.flush({ data: item({ isActive: action === 'activate', version: 8 }) });
      await promise;
    }
  );

  it('gets an item from the canonical SALES detail route and validates its DTO', async () => {
    const promise = api.get('SI-1');
    const request = http.expectOne(`${baseUrl}/sales/items/SI-1`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: item() });
    await expect(promise).resolves.toEqual(item());
  });
});

function item(overrides: Partial<SalesCatalogItem> = {}): SalesCatalogItem {
  return {
    id: 'SI-1', itemType: 'SERVICE', name: 'Conseil', description: 'Appui', unit: 'Heure',
    isActive: true, version: 7, createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides
  };
}
