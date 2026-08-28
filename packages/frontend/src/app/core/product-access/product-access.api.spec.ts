import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { ProductAccessApi } from './product-access.api';

const timestamp = '2026-08-07T10:00:00.000Z';

describe('ProductAccessApi', () => {
  let api: ProductAccessApi;
  let http: HttpTestingController;
  const url = `${environment.apiBaseUrl.replace(/\/$/, '')}/me/product-access`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ProductAccessApi, provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ProductAccessApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('validates the public ProductAccess response', async () => {
    const promise = api.listProductAccess('org-a');
    const request = http.expectOne(url);

    expect(request.request.method).toBe('GET');
    request.flush({
      productAccess: [
        {
          orgId: 'org-a',
          productCode: 'ACCOUNTING',
          status: 'ACTIVE',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });

    await expect(promise).resolves.toEqual([
      {
        orgId: 'org-a',
        productCode: 'ACCOUNTING',
        status: 'ACTIVE',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);
  });

  it('accepts SALES-only and ACCOUNTING plus SALES responses', async () => {
    const salesOnlyPromise = api.listProductAccess('org-a');
    http.expectOne(url).flush({
      productAccess: [
        {
          orgId: 'org-a',
          productCode: 'SALES',
          status: 'ACTIVE',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });
    await expect(salesOnlyPromise).resolves.toEqual([
      expect.objectContaining({ productCode: 'SALES', status: 'ACTIVE' }),
    ]);

    const combinedPromise = api.listProductAccess('org-a');
    http.expectOne(url).flush({
      productAccess: [
        {
          orgId: 'org-a',
          productCode: 'ACCOUNTING',
          status: 'ACTIVE',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          orgId: 'org-a',
          productCode: 'SALES',
          status: 'INACTIVE',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });
    await expect(combinedPromise).resolves.toHaveLength(2);
  });

  it('rejects persistence fields and invalid public responses', async () => {
    const promise = api.listProductAccess('org-a');
    http.expectOne(url).flush({
      productAccess: [
        {
          orgId: 'org-a',
          productCode: 'ACCOUNTING',
          status: 'ACTIVE',
          createdAt: timestamp,
          updatedAt: timestamp,
          PK: 'ORG#org-a',
          SK: 'PRODUCT_ACCESS#ACCOUNTING',
        },
      ],
    });

    await expect(promise).rejects.toBeTruthy();
  });

  it('rejects data belonging to a different organization', async () => {
    const promise = api.listProductAccess('org-b');
    http.expectOne(url).flush({
      productAccess: [
        {
          orgId: 'org-a',
          productCode: 'ACCOUNTING',
          status: 'ACTIVE',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });

    await expect(promise).rejects.toThrow(/active organization/i);
  });

  it.each(['PROJECTS', 'TREASURY'])(
    'rejects legacy %s rows from the public response',
    async (productCode) => {
      const promise = api.listProductAccess('org-a');
      http.expectOne(url).flush({
        productAccess: [
          {
            orgId: 'org-a',
            productCode,
            status: 'ACTIVE',
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      });

      await expect(promise).rejects.toBeTruthy();
    },
  );
});
