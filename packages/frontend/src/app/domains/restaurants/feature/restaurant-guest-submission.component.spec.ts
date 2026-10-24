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
      isError: () => false,
      refetch: vi.fn(),
      data: () => ({
        state: 'READY',
        requests: [
          GuestOrderRequestSchema.parse({
            requestId: '00000000-0000-4000-8000-000000000001',
            state: 'PENDING_APPROVAL',
            submittedAt: new Date().toISOString(),
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
});
