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
          {
            requestId: 'request',
            state: 'PENDING_APPROVAL',
            lines: [{ name: 'Poulet braisé', quantity: 2, note: 'Sans piment' }],
          },
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
});
