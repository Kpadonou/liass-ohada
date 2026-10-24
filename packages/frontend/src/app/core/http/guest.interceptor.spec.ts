import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { guestInterceptor } from './guest.interceptor';
import { GUEST_CAPABILITY_REQUEST } from './guest-request-context';
import { environment } from '../../../environments/environment';
describe('Minimal public bootstrap HTTP boundary', () => {
  const base = environment.apiBaseUrl.replace(/\/$/, '');
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([guestInterceptor])),
        provideHttpClientTesting(),
      ],
    }),
  );
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });
  it('needs no staff providers and strips accidental tenant/Cognito headers', async () => {
    const p = firstValueFrom(
      TestBed.inject(HttpClient).get(base + '/public/restaurants/guest/carte', {
        context: new HttpContext().set(GUEST_CAPABILITY_REQUEST, true),
        headers: {
          Authorization: 'Bearer staff.jwt.token',
          'x-org-id': 'org',
          'x-workspace-org-id': 'workspace',
        },
      }),
    );
    const r = TestBed.inject(HttpTestingController).expectOne(
      base + '/public/restaurants/guest/carte',
    );
    expect(r.request.headers.has('Authorization')).toBe(false);
    expect(r.request.headers.has('x-org-id')).toBe(false);
    expect(r.request.withCredentials).toBe(false);
    r.flush({ state: 'UNAVAILABLE' });
    await p;
  });
  it('blocks staff API requests instead of acquiring staff authentication', async () => {
    await expect(
      firstValueFrom(TestBed.inject(HttpClient).get(base + '/restaurants/staff')),
    ).rejects.toThrow('Guest request unavailable');
    TestBed.inject(HttpTestingController).expectNone(base + '/restaurants/staff');
  });
  it('allows waiter-call with explicit capability and strips all staff scope', async () => {
    const cap = 'header..iv.' + 'c'.repeat(150) + '.tag';
    const promise = firstValueFrom(
      TestBed.inject(HttpClient).post(
        base + '/public/restaurants/guest/waiter-call',
        {},
        {
          context: new HttpContext().set(GUEST_CAPABILITY_REQUEST, true),
          headers: {
            Authorization: 'Bearer ' + cap,
            'x-org-id': 'org',
            'x-workspace-org-id': 'staff',
          },
        },
      ),
    );
    const request = TestBed.inject(HttpTestingController).expectOne(
      base + '/public/restaurants/guest/waiter-call',
    );
    expect(request.request.headers.get('Authorization')).toBe('Bearer ' + cap);
    expect(request.request.headers.has('x-org-id')).toBe(false);
    expect(request.request.headers.has('x-workspace-org-id')).toBe(false);
    expect(request.request.withCredentials).toBe(false);
    request.flush({ state: 'REQUESTED', requestedAt: new Date().toISOString() });
    await promise;
  });
});
