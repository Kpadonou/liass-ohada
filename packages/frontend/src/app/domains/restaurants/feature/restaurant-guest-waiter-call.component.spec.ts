import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule, TranslocoService } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import fr from '../../../../../public/assets/i18n/fr.json';
import en from '../../../../../public/assets/i18n/en.json';
import { RestaurantGuestApi } from '../data-access/restaurant-guest.api';
import { RestaurantGuestWaiterCallComponent } from './restaurant-guest-waiter-call.component';
const context = {
  state: 'FREE',
  visitRef: null,
  restaurantName: 'Bistro',
  outletName: 'Centre',
  tableName: 'Jardin',
  guestHandle: 'a'.repeat(22),
  capability: 'c'.repeat(100),
  expiresAt: new Date(Date.now() + 600000).toISOString(),
  policy: 'DISABLED',
  orderingPermitted: false,
  waiterCallAvailable: true,
};
describe('Guest waiter call', () => {
  let client: QueryClient;
  const api = { waiterCall: vi.fn(), submissionState: vi.fn() };
  beforeEach(() => {
    client = new QueryClient();
    api.submissionState.mockResolvedValue({ state: 'READY', requests: [] });
    api.waiterCall
      .mockReset()
      .mockResolvedValue({ state: 'REQUESTED', requestedAt: new Date().toISOString() });
    TestBed.configureTestingModule({
      imports: [
        RestaurantGuestWaiterCallComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr, en },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['fr', 'en'], defaultLang: 'fr' },
        }),
      ],
      providers: [
        { provide: QueryClient, useValue: client },
        { provide: RestaurantGuestApi, useValue: api },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    client.clear();
  });
  function mount(state = 'FREE', lang = 'fr') {
    TestBed.inject(TranslocoService).setActiveLang(lang);
    const f = TestBed.createComponent(RestaurantGuestWaiterCallComponent);
    f.componentRef.setInput('context', {
      ...context,
      state,
      visitRef: state === 'OCCUPIED' ? 'v'.repeat(43) : null,
    });
    f.componentRef.setInput('scope', 'table-a');
    f.detectChanges();
    return f;
  }
  it.each(['FREE', 'OCCUPIED'])('available in %s even when ordering disabled', (state) => {
    const f = mount(state);
    expect(f.nativeElement.textContent).toContain('Appeler un serveur');
    expect(f.nativeElement.querySelector('button').disabled).toBe(false);
  });
  it('shows confirmed REQUESTED and suppresses repeated local calls', async () => {
    const f = mount();
    f.componentInstance.call();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.textContent).toContain('Serveur appelé');
    });
    f.componentInstance.call();
    expect(api.waiterCall).toHaveBeenCalledTimes(1);
    expect(f.nativeElement.querySelector('button').disabled).toBe(true);
  });
  it('coalesces two synchronous clicks before mutation signals update', async () => {
    const f = mount();
    f.componentInstance.call();
    f.componentInstance.call();
    await vi.waitFor(() => expect(api.waiterCall).toHaveBeenCalledTimes(1));
  });
  it('pending prevents accidental double click without claiming success', async () => {
    let resolve!: (r: unknown) => void;
    api.waiterCall.mockImplementation(() => new Promise((r) => (resolve = r)));
    const f = mount();
    f.componentInstance.call();
    await vi.waitFor(() => expect(api.waiterCall).toHaveBeenCalledTimes(1));
    f.detectChanges();
    f.componentInstance.call();
    expect(api.waiterCall).toHaveBeenCalledTimes(1);
    expect(f.nativeElement.querySelector('button').disabled).toBe(true);
    expect(f.nativeElement.textContent).not.toContain('Serveur appelé');
    resolve({ state: 'REQUESTED', requestedAt: new Date().toISOString() });
  });
  it('ACKNOWLEDGED never means physical arrival', async () => {
    api.waiterCall.mockResolvedValue({
      state: 'ACKNOWLEDGED',
      requestedAt: new Date().toISOString(),
      acknowledgedAt: new Date().toISOString(),
    });
    const f = mount('OCCUPIED', 'en');
    f.componentInstance.call();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.textContent).toContain('Request acknowledged');
    });
    expect(f.nativeElement.textContent).not.toMatch(/arrived/i);
  });
  it('COOLDOWN displays bounded server retry time', async () => {
    api.waiterCall.mockResolvedValue({ state: 'COOLDOWN', retryAfterSeconds: 60 });
    const f = mount();
    f.componentInstance.call();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.textContent).toContain('60 s');
    });
    expect(f.nativeElement.querySelector('button').disabled).toBe(true);
  });
  it('network error remains retryable and does not claim success', async () => {
    api.waiterCall.mockRejectedValue(new Error('offline'));
    const f = mount();
    f.componentInstance.call();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.textContent).toContain('Réessayez');
    });
    expect(f.nativeElement.querySelector('button').disabled).toBe(false);
    expect(f.nativeElement.textContent).not.toContain('Serveur appelé');
  });
  it('English action and live state have accessible semantics', () => {
    const f = mount('FREE', 'en');
    expect(f.nativeElement.querySelector('button').textContent).toContain('Call waiter');
    expect(f.nativeElement.querySelector('[role=status]')).toBeTruthy();
  });
  it('canonical expiration emits terminal state and never authorizes another context', async () => {
    api.waiterCall.mockResolvedValue({ state: 'VISIT_ENDED' });
    const f = mount('OCCUPIED');
    const ended = vi.fn();
    f.componentInstance.ended.subscribe(ended);
    f.componentInstance.call();
    await vi.waitFor(() => expect(ended).toHaveBeenCalledWith('VISIT_ENDED'));
  });
  it('late response for another table cannot replace current state', async () => {
    let resolve!: (r: unknown) => void;
    api.waiterCall.mockImplementation(() => new Promise((r) => (resolve = r)));
    const f = mount();
    f.componentInstance.call();
    await vi.waitFor(() => expect(api.waiterCall).toHaveBeenCalled());
    f.componentRef.setInput('scope', 'table-b');
    f.detectChanges();
    resolve({ state: 'REQUESTED', requestedAt: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 10));
    f.detectChanges();
    expect(f.nativeElement.textContent).not.toContain('Serveur appelé');
  });
  it('manual own-state refresh replaces a previous REQUESTED result with acknowledgement', async () => {
    const f = mount();
    f.componentInstance.call();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.result()?.state).toBe('REQUESTED');
    });
    api.submissionState.mockResolvedValue({
      state: 'READY',
      requests: [],
      waiterCall: {
        state: 'ACKNOWLEDGED',
        requestedAt: new Date().toISOString(),
        acknowledgedAt: new Date().toISOString(),
      },
    });
    await f.componentInstance.status.refetch();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.result()?.state).toBe('ACKNOWLEDGED');
    });
    expect(api.waiterCall).toHaveBeenCalledTimes(1);
    f.destroy();
  });
});
