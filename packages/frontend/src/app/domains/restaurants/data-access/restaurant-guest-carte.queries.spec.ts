import { TestBed } from '@angular/core/testing';
import { provideHttpClient, HttpErrorResponse } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import {
  GuestCartePage,
  guestCarteKey,
  RestaurantGuestCarteApi,
} from './restaurant-guest-carte.queries';
import { GUEST_CAPABILITY_REQUEST } from '../../../core/http/guest-request-context';
describe('Guest Carte conditional reads', () => {
  let api: RestaurantGuestCarteApi, http: HttpTestingController;
  const previous: GuestCartePage = {
    body: {
      state: 'READY',
      currency: 'XOF',
      referencesExpireAt: new Date().toISOString(),
      categories: [],
    },
    etag: 'W/"same"',
  };
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(RestaurantGuestCarteApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });
  it('sends only explicit Guest authorization, opaque continuation and validator', async () => {
    const promise = api.read('guest-jwe', 'opaque-cursor', previous);
    const r = http.expectOne((x) => x.url.endsWith('/guest/carte'));
    expect(r.request.method).toBe('GET');
    expect(r.request.headers.get('Authorization')).toBe('Bearer guest-jwe');
    expect(r.request.headers.has('x-org-id')).toBe(false);
    expect(r.request.context.get(GUEST_CAPABILITY_REQUEST)).toBe(true);
    expect(r.request.params.get('cursor')).toBe('opaque-cursor');
    expect(r.request.headers.get('If-None-Match')).toBe(previous.etag);
    r.flush(null, { status: 304, statusText: 'Not Modified' });
    expect(await promise).toBe(previous);
  });
  it('does not accept 304 without a cached validator-backed page', async () => {
    const promise = api.read('guest-jwe');
    const expectation = expect(promise).rejects.toBeInstanceOf(HttpErrorResponse);
    http
      .expectOne((x) => x.url.endsWith('/guest/carte'))
      .flush(null, { status: 304, statusText: 'Not Modified' });
    await expectation;
  });
  it('validates the public body and retains ETag metadata', async () => {
    const promise = api.read('guest-jwe');
    http
      .expectOne((x) => x.url.endsWith('/guest/carte'))
      .flush(previous.body, { headers: { ETag: previous.etag! } });
    expect(await promise).toEqual(previous);
  });
  it('isolates table and guest contexts in canonical query ownership', () => {
    expect(guestCarteKey('table-a', 'handle')).not.toEqual(guestCarteKey('table-b', 'handle'));
    expect(guestCarteKey('table-a', 'handle')).not.toEqual(guestCarteKey('table-a', 'new-visit'));
  });
});
