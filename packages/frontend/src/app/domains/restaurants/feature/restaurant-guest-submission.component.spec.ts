import { GuestOrderRequestSchema } from '@liass-ohada/shared/restaurants';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule, TranslocoService } from '@ngneat/transloco';
import fr from '../../../../../public/assets/i18n/fr.json';
import en from '../../../../../public/assets/i18n/en.json';
import { RestaurantGuestSubmissionComponent } from './restaurant-guest-submission.component';
import { RestaurantGuestSubmissions } from '../data-access/restaurant-guest-submissions';
describe('Guest request presentation', () => {
  const workflow = {
    cart: { context: () => ({ state: 'OCCUPIED' }) },
    canSend: () => true,
    hasUncertain: () => false,
    submit: vi.fn(),
    identity: () => 'visit',
    send: { isPending: () => false, isError: () => false, data: () => undefined },
    state: {
      isFetching: () => false,
      isPending: () => false,
      isError: () => false,
      refetch: vi.fn(),
      data: () => ({
        state: 'READY',
        requests: [
          GuestOrderRequestSchema.parse({
            requestId: '00000000-0000-4000-8000-000000000001',
            state: 'PENDING_APPROVAL',
            submittedAt: '2026-10-18T10:00:00.000Z',
            expiresAt: new Date(Date.now() + 900000).toISOString(),
            lines: [
              {
                name: 'Poulet braisé',
                quantity: 2,
                note: 'Sans piment',
                amountMinor: 2500,
                currency: 'XOF',
              },
            ],
          }),
        ],
      }),
    },
  };
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [
        RestaurantGuestSubmissionComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr, en },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['fr', 'en'], defaultLang: 'fr' },
        }),
      ],
      providers: [{ provide: RestaurantGuestSubmissions, useValue: workflow }],
    }),
  );
  it.each([
    ['fr', 'Envoyer la commande', 'En attente de validation'],
    ['en', 'Send order', 'Awaiting approval'],
  ])('provides translated send and own-request state in %s', (lang, send, pending) => {
    TestBed.inject(TranslocoService).setActiveLang(lang);
    const f = TestBed.createComponent(RestaurantGuestSubmissionComponent);
    f.componentRef.setInput('action', true);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain(send);
    f.componentRef.setInput('action', false);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain(pending);
    expect(f.nativeElement.textContent).toContain('Sans piment');
  });
  afterEach(() => vi.restoreAllMocks());
  it.each(['fr', 'en'])(
    'groups own submissions by timestamp and preserves mixed line truth in %s',
    (lang) => {
      TestBed.inject(TranslocoService).setActiveLang(lang);
      const request = GuestOrderRequestSchema.parse({
        requestId: '00000000-0000-4000-8000-000000000002',
        state: 'ACCEPTED',
        mode: 'DIRECT',
        orderStatus: 'PREPARING',
        submittedAt: '2026-10-18T10:00:00.000Z',
        expiresAt: '2026-10-18T10:15:00.000Z',
        lines: [
          {
            name: 'Poulet',
            quantity: 2,
            note: '',
            fulfillment: 'PREPARING',
            amountMinor: 2500,
            currency: 'XOF',
          },
          {
            name: 'Eau FIFA',
            quantity: 1,
            note: '',
            fulfillment: 'CONFIRMED',
            amountMinor: 1000,
            currency: 'XOF',
          },
        ],
      });
      vi.spyOn(workflow.state, 'data').mockReturnValue({
        state: 'READY',
        requests: [
          request,
          {
            ...request,
            requestId: '00000000-0000-4000-8000-000000000003',
            submittedAt: '2026-10-18T10:05:00.000Z',
            orderStatus: 'CONFIRMED',
            lines: [{ ...request.lines[1], name: 'Jus de gingembre' }],
          },
        ],
      });
      const f = TestBed.createComponent(RestaurantGuestSubmissionComponent);
      f.detectChanges();
      const articles = f.nativeElement.querySelectorAll('article') as NodeListOf<HTMLElement>;
      expect(articles).toHaveLength(2);
      expect(articles[1].querySelector('time')?.getAttribute('datetime')).toBe(request.submittedAt);
      expect(articles[0].querySelector('time')?.getAttribute('datetime')).toBe(
        '2026-10-18T10:05:00.000Z',
      );
      const water = articles[1].querySelectorAll('li')[1].textContent!;
      expect(water).toContain(lang === 'fr' ? 'Confirmée' : 'Confirmed');
      expect(water).not.toContain(lang === 'fr' ? 'En préparation' : 'Preparing');
      expect(articles[1].textContent).not.toContain('Jus de gingembre');
      expect(f.nativeElement.textContent).not.toContain(request.requestId);
    },
  );
  it.each(['PENDING_SERVICE', 'PENDING_APPROVAL', 'REJECTED', 'EXPIRED'] as const)(
    'keeps %s distinct from canonical confirmation',
    (state) => {
      const request = GuestOrderRequestSchema.parse({
        requestId: '00000000-0000-4000-8000-000000000002',
        state,
        submittedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        lines: [{ name: 'Eau', quantity: 1, note: '', amountMinor: 1000, currency: 'XOF' }],
      });
      vi.spyOn(workflow.state, 'data').mockReturnValue({ state: 'READY', requests: [request] });
      const f = TestBed.createComponent(RestaurantGuestSubmissionComponent);
      f.detectChanges();
      expect(f.nativeElement.textContent).toContain(fr.RESTAURANTS.SUBMISSIONS[state]);
      expect(f.nativeElement.textContent).not.toContain('Commande confirmée');
    },
  );
  it.each([
    ['fr', 'CONFIRMED', 'Commande confirmée'],
    ['en', 'CONFIRMED', 'Order confirmed'],
    ['fr', 'PREPARING', 'En préparation'],
    ['en', 'PREPARING', 'Preparing'],
    ['fr', 'READY', 'Prête'],
    ['en', 'READY', 'Ready'],
    ['fr', 'SERVED', 'Servie'],
    ['en', 'SERVED', 'Served'],
    ['fr', 'CANCELLED', 'Annulée'],
    ['en', 'CANCELLED', 'Cancelled'],
  ])('renders canonical DIRECT %s %s progress', (lang, status, label) => {
    TestBed.inject(TranslocoService).setActiveLang(lang);
    vi.spyOn(workflow.state, 'data').mockReturnValue({
      state: 'READY',
      requests: [
        GuestOrderRequestSchema.parse({
          requestId: '00000000-0000-4000-8000-000000000002',
          state: 'ACCEPTED',
          mode: 'DIRECT',
          orderStatus: status,
          submittedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 900000).toISOString(),
          lines: [
            {
              name: 'Jus de gingembre',
              quantity: 1,
              note: 'Sans glace',
              fulfillment: status,
              amountMinor: 1200,
              currency: 'XOF',
            },
          ],
        }),
      ],
    });
    const f = TestBed.createComponent(RestaurantGuestSubmissionComponent);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain(label);
    expect(f.nativeElement.textContent).not.toContain('PENDING_APPROVAL');
    expect(f.nativeElement.textContent).not.toContain('RESTAURANTS.SUBMISSIONS.');
  });
  it.each(['fr', 'en'])('shows a consumer empty state in %s', (lang) => {
    TestBed.inject(TranslocoService).setActiveLang(lang);
    vi.spyOn(workflow.state, 'data').mockReturnValue({ state: 'READY', requests: [] });
    const fixture = TestBed.createComponent(RestaurantGuestSubmissionComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      lang === 'fr' ? 'Vos commandes apparaîtront ici.' : 'Your orders will appear here.',
    );
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });
  it('prioritizes active work over more recent historical submissions without merging them', () => {
    const base = workflow.state.data().requests[0];
    vi.spyOn(workflow.state, 'data').mockReturnValue({
      state: 'READY',
      requests: [
        {
          ...base,
          requestId: 'old',
          state: 'ACCEPTED',
          orderStatus: 'SERVED',
          submittedAt: '2026-10-18T12:00:00Z',
        },
        {
          ...base,
          requestId: 'active',
          state: 'PENDING_APPROVAL',
          submittedAt: '2026-10-18T10:00:00Z',
        },
      ],
    } as never);
    const fixture = TestBed.createComponent(RestaurantGuestSubmissionComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.orderedRequests().map((r) => r.requestId)).toEqual([
      'active',
      'old',
    ]);
    expect(fixture.nativeElement.querySelectorAll('article')).toHaveLength(2);
  });
});
