import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { SalesCustomer } from '@liass-ohada/shared/sales';

import { environment } from '../../../../environments/environment';
import { SalesCustomersApi } from './sales-customers.api';

describe('SalesCustomersApi', () => {
  let api: SalesCustomersApi;
  let http: HttpTestingController;
  const baseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    api = TestBed.inject(SalesCustomersApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists one cursor page and passes the opaque cursor through unchanged', async () => {
    const promise = api.list({ limit: 50, cursor: 'opaque+/=cursor' });
    const request = http.expectOne((candidate) => candidate.url === `${baseUrl}/sales/customers`);
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('limit')).toBe('50');
    expect(request.request.params.get('cursor')).toBe('opaque+/=cursor');
    request.flush({ data: { items: [customer()], nextCursor: 'next-opaque' } });

    await expect(promise).resolves.toEqual({ items: [customer()], nextCursor: 'next-opaque' });
  });

  it('uses the exact create route without tenant or server-owned fields', async () => {
    const promise = api.create({ customerType: 'BUSINESS', name: 'Alpha SARL' });
    const request = http.expectOne(`${baseUrl}/sales/customers`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ customerType: 'BUSINESS', name: 'Alpha SARL' });
    expect(request.request.body).not.toHaveProperty('orgId');
    expect(request.request.body).not.toHaveProperty('userId');
    expect(request.request.body).not.toHaveProperty('isActive');
    expect(request.request.body).not.toHaveProperty('version');
    request.flush({ data: customer(), message: 'Customer created.' });

    await expect(promise).resolves.toEqual({ data: customer(), message: 'Customer created.' });
  });

  it('uses PATCH with the authoritative expectedVersion', async () => {
    const promise = api.update('SC/1', {
      expectedVersion: 7,
      customerType: 'INDIVIDUAL',
      name: 'Ada Mensah'
    });
    const request = http.expectOne(`${baseUrl}/sales/customers/SC%2F1`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({
      expectedVersion: 7,
      customerType: 'INDIVIDUAL',
      name: 'Ada Mensah'
    });
    request.flush({ data: customer({ id: 'SC/1', version: 8 }) });
    await promise;
  });

  it.each(['activate', 'deactivate'] as const)(
    'uses the exact %s lifecycle route with only expectedVersion in the body',
    async (action) => {
      const promise = api[action]('SC-1', 7);
      const request = http.expectOne(`${baseUrl}/sales/customers/SC-1/${action}`);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ expectedVersion: 7 });
      expect(request.request.body).not.toHaveProperty('customerId');
      expect(request.request.body).not.toHaveProperty('orgId');
      expect(request.request.body).not.toHaveProperty('userId');
      request.flush({ data: customer({ isActive: action === 'activate', version: 8 }) });
      await promise;
    }
  );

  it('gets a customer from the SALES route and validates its DTO', async () => {
    const promise = api.get('SC-1');
    const request = http.expectOne(`${baseUrl}/sales/customers/SC-1`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: customer() });
    await expect(promise).resolves.toEqual(customer());
  });
});

function customer(overrides: Partial<SalesCustomer> = {}): SalesCustomer {
  return {
    id: 'SC-1',
    customerType: 'BUSINESS',
    name: 'Alpha SARL',
    email: 'contact@alpha.example',
    phone: '+2290100000000',
    taxIdentifier: 'IFU-123',
    billingAddress: { line1: '1 rue du Port', city: 'Cotonou', country: 'BJ' },
    isActive: true,
    version: 7,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides
  };
}
