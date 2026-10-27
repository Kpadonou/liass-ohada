import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient, queryOptions } from '@tanstack/angular-query-experimental';
import fr from '../../../../../public/assets/i18n/fr.json';
import en from '../../../../../public/assets/i18n/en.json';
import { RestaurantGuestReviewComponent } from './restaurant-guest-review.component';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { NotificationService } from '../../../core/notifications/notification.service';
describe('Guest review in Table Workspace', () => {
  let client: QueryClient;
  let allow: boolean;
  const review = vi.fn();
  beforeEach(() => {
    client = new QueryClient();
    review.mockReset().mockResolvedValue({ state: 'ACCEPTED' });
    allow = true;
    TestBed.configureTestingModule({
      imports: [
        RestaurantGuestReviewComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr, en },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['fr', 'en'], defaultLang: 'fr' },
        }),
      ],
      providers: [
        { provide: QueryClient, useValue: client },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
        { provide: RestaurantsCapabilities, useValue: { canReadService: () => allow } },
        {
          provide: RestaurantsQueries,
          useValue: {
            reviewGuestRequest: review,
            guestRequests: (_o: string, _s: string, enabled: boolean) =>
              queryOptions({
                queryKey: ['review'],
                enabled,
                queryFn: async () => ({
                  requests: [
                    {
                      requestId: 'request',
                      state: 'PENDING_APPROVAL',
                      submittedAt: new Date().toISOString(),
                      lines: [
                        {
                          name: 'Poulet braisé',
                          quantity: 2,
                          note: 'Sans piment',
                          amountMinor: 2500,
                          currency: 'XOF',
                        },
                      ],
                    },
                  ],
                }),
              }),
          },
        },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    client.clear();
  });
  async function mount() {
    const f = TestBed.createComponent(RestaurantGuestReviewComponent);
    f.componentRef.setInput('outlet', 'outlet');
    f.componentRef.setInput('session', 'session');
    f.detectChanges();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.query.isSuccess()).toBe(allow);
    });
    return f;
  }
  it('authorized service staff sees original intent and accepts without line editing', async () => {
    const f = await mount();
    expect(f.nativeElement.textContent).toContain('Sans piment');
    expect(f.nativeElement.textContent).toContain('Accepter');
    expect(f.nativeElement.querySelector('input')).toBeNull();
    f.componentInstance.review('request', 'approve');
    await vi.waitFor(() =>
      expect(review).toHaveBeenCalledWith('outlet', 'session', 'request', 'approve', ''),
    );
  });
  it('staff without operational permission cannot review', async () => {
    allow = false;
    const f = await mount();
    expect(f.nativeElement.textContent).not.toContain('Accepter');
    f.componentInstance.review('request', 'approve');
    expect(review).not.toHaveBeenCalled();
  });
  it('accepted DIRECT and completed requests are not presented as pending staff decisions', async () => {
    client.setQueryData(['review'], {
      requests: [
        {
          requestId: 'direct',
          state: 'ACCEPTED',
          mode: 'DIRECT',
          lines: [{ name: 'Already ordered' }],
        },
        { requestId: 'rejected', state: 'REJECTED', lines: [{ name: 'Rejected item' }] },
      ],
    });
    const f = await mount();
    // Install the canonical response after the initial mount refetch.
    client.setQueryData(['review'], {
      requests: [
        {
          requestId: 'direct',
          state: 'ACCEPTED',
          mode: 'DIRECT',
          lines: [{ name: 'Already ordered' }],
        },
        { requestId: 'rejected', state: 'REJECTED', lines: [{ name: 'Rejected item' }] },
      ],
    });
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.querySelector('section')).toBeNull();
      expect(f.nativeElement.classList.contains('hidden')).toBe(true);
    });
    expect(f.nativeElement.textContent).not.toContain('Already ordered');
    expect(f.nativeElement.textContent).not.toContain('Rejected item');
    expect(f.nativeElement.textContent).not.toContain('Accepter');
  });
  it('keeps a failed DIRECT reconciliation diagnosable without offering approval', async () => {
    const f = await mount();
    client.setQueryData(['review'], {
      requests: [
        {
          requestId: 'expired-direct',
          state: 'EXPIRED',
          mode: 'DIRECT',
          submittedAt: '2026-10-18T10:00:00.000Z',
          lines: [{ name: 'Commande à vérifier', quantity: 1, amountMinor: 1000, currency: 'XOF' }],
        },
      ],
    });
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.textContent).toContain('Commande à vérifier');
    });
    expect(f.nativeElement.textContent).not.toContain('Accepter');
  });
  it('reject requires bounded reason and submits unchanged intent', async () => {
    const f = await mount();
    f.componentInstance.reason.setValue('Cuisine fermée');
    f.componentInstance.review('request', 'reject');
    await vi.waitFor(() =>
      expect(review).toHaveBeenCalledWith(
        'outlet',
        'session',
        'request',
        'reject',
        'Cuisine fermée',
      ),
    );
  });
  it.each(['fr', 'en'])(
    'renders actionable Customer requests and no empty section in %s',
    async (lang) => {
      TestBed.inject(TranslocoService).setActiveLang(lang);
      const f = await mount();
      expect(f.nativeElement.textContent).toContain(
        lang === 'fr' ? 'Demandes des clients' : 'Customer requests',
      );
      client.setQueryData(['review'], { requests: [] });
      await vi.waitFor(() => {
        f.detectChanges();
        expect(f.nativeElement.querySelector('section')).toBeNull();
      });
      expect(f.nativeElement.textContent).not.toContain(
        lang === 'fr' ? 'Aucune demande' : 'No requests',
      );
    },
  );
});
