import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { RestaurantCashPage } from './restaurant-cash.page';
import { provideRouter } from '@angular/router';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { RestaurantDocumentCollectionComponent } from './restaurant-document-collection.component';
import { RestaurantCashQueries } from '../data-access/restaurant-cash.queries';
import { RestaurantReceiptApi } from '../data-access/restaurant-receipt.api';
import { AuthStore } from '../../identity/data-access/auth.store';
import fr from '../../../../../public/assets/i18n/fr.json';
import en from '../../../../../public/assets/i18n/en.json';
const id = '00000000-0000-4000-8000-000000000001';
const scope = { org: 'org', outlet: id, user: 'user', revision: 1, identity: 'outlet' };
async function setup(kind: 'invoices' | 'credit-notes', role = 'OWNER', active = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const common = {
    orgId: 'org',
    outletId: id,
    invoiceId: id,
    guestSessionId: id,
    businessDayId: id,
    tableDisplayName: 'ALTAB',
    currency: 'XOF',
  };
  const row =
    kind === 'invoices'
      ? { ...common, issuedAt: '2026-11-02T11:00:00.000Z', totalMinor: 900, status: 'FINAL' }
      : {
          ...common,
          creditNoteId: id,
          creditNoteReference: 'AV-20261102-DFE96600',
          validatedAt: '2026-11-02T11:00:00.000Z',
          reason: 'Retour',
          amountMinor: 900,
          refundedMinor: 200,
          remainingRefundableMinor: 700,
          status: 'VALIDATED',
        };
  const request = vi.fn().mockResolvedValue({ items: [row] });
  const page = vi.fn();
  TestBed.configureTestingModule({
    imports: [
      RestaurantDocumentCollectionComponent,
      TranslocoTestingModule.forRoot({
        langs: { fr, en },
        translocoConfig: { availableLangs: ['fr', 'en'], defaultLang: 'fr' },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([]),
      provideTanStackQuery(client),
      {
        provide: AuthStore,
        useValue: { activeWorkspace: () => ({ productRoles: { RESTAURANTS: role } }) },
      },
      { provide: RestaurantReceiptApi, useValue: { page } },
      {
        provide: RestaurantCashQueries,
        useValue: {
          client,
          context: () => scope,
          request,
          current: () => ({ queryKey: ['current'], queryFn: async () => ({ data: null }) }),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(RestaurantDocumentCollectionComponent);
  fixture.componentRef.setInput('kind', kind);
  fixture.componentRef.setInput('active', active);
  fixture.componentRef.setInput('day', {
    businessDayId: id,
    status: 'OPEN',
    openedAt: '2026-10-30T00:00:00.000Z',
    operationalTimezone: 'Africa/Porto-Novo',
  });
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, request, page, client };
}
afterEach(() => TestBed.resetTestingModule());
it('closes Invoice detail, emits canonical identity and activates the CreditNotes tab', async () => {
  const { component } = await setup('invoices', 'OWNER', false);
  const row = { invoiceId: id, guestSessionId: id } as never;
  component.open(row, 'invoice');
  const emitted = vi.fn();
  component.viewCredits.subscribe(emitted);
  component.showCredits(id);
  expect(component.selected()).toBeNull();
  expect(emitted).toHaveBeenCalledWith(id);
  const workspace = {
    creditContext: signal<{ invoiceId: string; revision: number } | null>(null),
    activityTab: signal(1),
  };
  RestaurantCashPage.prototype.viewInvoiceCredits.call(workspace as RestaurantCashPage, id);
  expect(workspace.activityTab()).toBe(2);
  expect(workspace.creditContext()?.invoiceId).toBe(id);
  RestaurantCashPage.prototype.viewInvoiceCredits.call(workspace as RestaurantCashPage, id);
  expect(workspace.creditContext()?.revision).toBe(2);
});
it('applies and clears contextual Invoice search through the server, preserving BusinessDay scope', async () => {
  const { fixture, component, request } = await setup('credit-notes', 'OWNER', false);
  fixture.componentRef.setInput('contextualInvoice', { invoiceId: id, revision: 1 });
  fixture.componentRef.setInput('active', true);
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(
      request.mock.calls.some((call) => new URLSearchParams(call[1].split('?')[1]).get('q') === id),
    ).toBe(true);
  });
  expect(component.searchInput()).toBe(id);
  expect(component.filters().businessDayId).toBe(id);
  const clear = fixture.nativeElement.querySelector(
    '[aria-label="Effacer la recherche"]',
  ) as HTMLButtonElement;
  const cleared = vi.fn();
  component.contextCleared.subscribe(cleared);
  clear.click();
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(component.search()).toBe('');
  });
  expect(component.filters().businessDayId).toBe(id);
  expect(cleared).toHaveBeenCalledOnce();
  fixture.componentRef.setInput('contextualInvoice', { invoiceId: id, revision: 2 });
  fixture.detectChanges();
  expect(component.searchInput()).toBe(id);
});
it('uses operational BusinessDay by default and bounds intentional history in its timezone', async () => {
  const { component, fixture } = await setup('invoices', 'OWNER', false);
  expect(component.filters().businessDayId).toBe(id);
  component.history.set(true);
  component.from.set('2026-11-01');
  component.to.set('2026-12-01');
  fixture.detectChanges();
  expect(component.filters().businessDayId).toBeUndefined();
  expect(component.filters().from).toBe('2026-10-31T23:00:00.000Z');
  expect(component.validRange()).toBe(true);
  component.to.set('2026-12-02');
  expect(component.validRange()).toBe(false);
});
it('keeps CreditNote row actions read-only without an own open CashSession', async () => {
  const { fixture } = await setup('credit-notes');
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('ALTAB');
  });
  fixture.nativeElement.querySelector('tbody button').click();
  fixture.detectChanges();
  await fixture.whenStable();
  expect(document.body.textContent).toContain('Consulter l’avoir');
  expect(document.body.textContent).toContain('Consulter la facture');
  expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
});
it.each(['invoices', 'credit-notes'] as const)(
  '%s lazy loads only on activation and renders desktop/mobile records without detail hydration',
  async (kind) => {
    const { fixture, request, page } = await setup(kind, 'OWNER', false);
    expect(request).not.toHaveBeenCalled();
    fixture.componentRef.setInput('active', true);
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('ALTAB');
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(page).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('article')).toHaveLength(1);
    if (kind === 'invoices') {
      expect(fixture.nativeElement.querySelector('article').textContent).toContain(
        'Réf. technique',
      );
    }
    if (kind === 'credit-notes') {
      expect(fixture.nativeElement.textContent).toContain('900');
      expect(fixture.nativeElement.textContent).toContain('200');
      expect(fixture.nativeElement.textContent).toContain('700');
    }
  },
);
it.each([
  ['OWNER', true],
  ['MANAGER', true],
  ['CASHIER', false],
] as const)('%s preserves mutation gating and requires own CashSession', async (role, allowed) => {
  const { component } = await setup('credit-notes', role);
  expect(component.canManage()).toBe(allowed);
  expect(component.canRefund()).toBe(false);
});
