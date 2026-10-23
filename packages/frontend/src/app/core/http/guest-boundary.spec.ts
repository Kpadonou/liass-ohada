import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { GUEST_CAPABILITY_REQUEST } from './guest-request-context';
import { environment } from '../../../environments/environment';
import { RestaurantGuestApi } from '../../domains/restaurants/data-access/restaurant-guest.api';

describe('Guest HTTP boundary without any staff dependencies', () => {
  const base = environment.apiBaseUrl.replace(/\/$/, '') + '/public/restaurants/guest';
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    }),
  );
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });
  it('resolves without AuthStore/Cognito or tenant, strips accidental staff headers', async () => {
    const result = firstValueFrom(
      TestBed.inject(HttpClient).post(
        base + '/resolve',
        { token: 'a'.repeat(42) + 'A' },
        {
          headers: {
            Authorization: 'Bearer staff.jwt.token',
            'x-org-id': 'private-org',
            'x-workspace-org-id': 'private-workspace',
          },
        },
      ),
    );
    const req = TestBed.inject(HttpTestingController).expectOne(base + '/resolve');
    for (const name of ['Authorization', 'x-org-id', 'x-workspace-org-id'])
      expect(req.request.headers.has(name)).toBe(false);
    req.flush({ state: 'UNAVAILABLE' });
    await result;
  });
  it('only sends explicit encrypted Guest capability on renew', async () => {
    const capability = 'header..iv.ciphertext.tag';
    const result = firstValueFrom(
      TestBed.inject(HttpClient).post(
        base + '/renew',
        {},
        {
          context: new HttpContext().set(GUEST_CAPABILITY_REQUEST, true),
          headers: { Authorization: `Bearer ${capability}`, 'x-org-id': 'org' },
        },
      ),
    );
    const req = TestBed.inject(HttpTestingController).expectOne(base + '/renew');
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${capability}`);
    expect(req.request.headers.has('x-org-id')).toBe(false);
    req.flush({ state: 'EXPIRED' });
    await result;
  });
  it('validates Guest response DTO and sends no customer identity', async () => {
    const result = TestBed.inject(RestaurantGuestApi).resolve('a'.repeat(42) + 'A');
    const req = TestBed.inject(HttpTestingController).expectOne(base + '/resolve');
    expect(req.request.body).toEqual({ token: 'a'.repeat(42) + 'A' });
    req.flush({ state: 'UNAVAILABLE', orgId: 'private' });
    await expect(result).rejects.toThrow();
  });
  it.each(['Bearer header..iv.ciphertext.tag', 'Bearer staff.jwt.token'])(
    'isolates GET Carte with %s',
    async (authorization) => {
      const result = firstValueFrom(
        TestBed.inject(HttpClient).get(base + '/carte', {
          context: new HttpContext().set(GUEST_CAPABILITY_REQUEST, true),
          headers: {
            Authorization: authorization,
            'x-org-id': 'org',
            'x-workspace-org-id': 'workspace',
            'If-None-Match': 'W/"content"',
          },
        }),
      );
      const req = TestBed.inject(HttpTestingController).expectOne(base + '/carte');
      expect(req.request.headers.get('Authorization')).toBe(
        authorization.includes('staff') ? null : authorization,
      );
      expect(req.request.headers.has('x-org-id')).toBe(false);
      expect(req.request.headers.has('x-workspace-org-id')).toBe(false);
      expect(req.request.headers.get('If-None-Match')).toBe('W/"content"');
      req.flush({ state: 'NO_MENU' });
      await result;
    },
  );
});
