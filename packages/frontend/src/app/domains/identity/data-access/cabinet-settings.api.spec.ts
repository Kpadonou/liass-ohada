import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../../environments/environment';
import { TENANT_REQUEST_SCOPE } from '../../../core/http/tenant-request-context';
import { CabinetSettingsApi } from './cabinet-settings.api';

const baseUrl = environment.apiBaseUrl.replace(/\/$/, '');
const response = {
  cabinetOrgId: 'org-cabinet',
  organizationName: 'Cabinet Kora',
  country: 'BJ',
  contact: { email: 'contact@kora.test' },
  address: { city: 'Cotonou' },
  preferredLanguage: 'fr',
  defaults: { country: 'SN', accountingFramework: 'SYSCOHADA_REVISED' },
  version: 3
};

describe('CabinetSettingsApi', () => {
  let api: CabinetSettingsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [CabinetSettingsApi, provideHttpClient(), provideHttpClientTesting()]
    });
    api = TestBed.inject(CabinetSettingsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads and validates Settings in Cabinet scope', async () => {
    const promise = api.getCabinetSettings();
    const request = http.expectOne(`${baseUrl}/cabinet/settings`);

    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(TENANT_REQUEST_SCOPE)).toBe('CABINET');
    request.flush(response);

    await expect(promise).resolves.toMatchObject({ cabinetOrgId: 'org-cabinet', version: 3 });
  });

  it('patches only the validated public contract with expectedVersion', async () => {
    const promise = api.updateCabinetSettings({
      expectedVersion: 3,
      contact: { phone: '+229 01 23 45 67 89' }
    });
    const request = http.expectOne(`${baseUrl}/cabinet/settings`);

    expect(request.request.method).toBe('PATCH');
    expect(request.request.context.get(TENANT_REQUEST_SCOPE)).toBe('CABINET');
    expect(request.request.body).toEqual({
      expectedVersion: 3,
      contact: { phone: '+229 01 23 45 67 89' }
    });
    expect(request.request.body).not.toHaveProperty('cabinetOrgId');
    request.flush({ ...response, contact: { ...response.contact, phone: '+229 01 23 45 67 89' }, version: 4 });

    await expect(promise).resolves.toMatchObject({ version: 4 });
  });

  it('rejects invalid payloads and preserves backend envelopes', async () => {
    const invalidPromise = api.getCabinetSettings();
    http.expectOne(`${baseUrl}/cabinet/settings`).flush({ ...response, version: -1 });
    await expect(invalidPromise).rejects.toBeTruthy();

    const errorPromise = api.updateCabinetSettings({ expectedVersion: 3, country: 'SN' });
    http.expectOne(`${baseUrl}/cabinet/settings`).flush(
      { message: { code: 'CABINET_SETTINGS_UPDATE_CONFLICT', message: 'Conflict' } },
      { status: 409, statusText: 'Conflict' }
    );
    await expect(errorPromise).rejects.toMatchObject({
      error: { message: { code: 'CABINET_SETTINGS_UPDATE_CONFLICT' } }
    } satisfies Partial<HttpErrorResponse>);
  });
});
