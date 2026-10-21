import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { RestaurantReceiptView } from './restaurant-receipt.page';
import { RestaurantReceiptApi } from '../data-access/restaurant-receipt.api';
import { RestaurantReceiptPrint } from '../data-access/restaurant-receipt-print';
import { AuthStore } from '../../identity/data-access/auth.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { receiptPageFixture, receiptSummary } from '../data-access/restaurant-receipt.test-fixture';
import { rid } from '../data-access/restaurants.test-fixture';
import fr from '../../../../../public/assets/i18n/fr.json';
const ctx = { org: 'org', user: 'cashier', revision: 1, outlet: rid(2), session: rid(9) };
describe('Receipt presentation and complete native print', () => {
  let client: QueryClient;
  const role = signal('CASHIER'),
    org = signal('org'),
    revision = signal(1);
  const api = { page: vi.fn(), publish: vi.fn(), assertContext: vi.fn() },
    printer = { print: vi.fn() };
  beforeEach(() => {
    vi.resetAllMocks();
    role.set('CASHIER');
    org.set('org');
    revision.set(1);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.page.mockResolvedValue(receiptPageFixture());
    api.publish.mockResolvedValue({ state: 'FINAL', receipt: receiptSummary() });
    TestBed.configureTestingModule({
      imports: [
        RestaurantReceiptView,
        TranslocoTestingModule.forRoot({
          langs: { fr },
          translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
          preloadLangs: true,
        }),
      ],
      providers: [
        { provide: QueryClient, useValue: client },
        { provide: RestaurantReceiptApi, useValue: api },
        { provide: RestaurantReceiptPrint, useValue: printer },
        { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
        {
          provide: AuthStore,
          useValue: {
            effectiveOrgId: org,
            currentUserId: () => 'cashier',
            contextRevision: revision,
            activeWorkspaceType: () => 'COMPANY',
            activeWorkspace: () => ({
              orgId: org(),
              status: 'ACTIVE',
              productRoles: { RESTAURANTS: role() },
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
  function create(closed = false) {
    const f = TestBed.createComponent(RestaurantReceiptView);
    f.componentRef.setInput('ctx', ctx);
    f.componentRef.setInput('closed', closed);
    f.detectChanges();
    return f;
  }
  async function loaded(f: ReturnType<typeof create>) {
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.loadedCount()).toBeGreaterThan(0);
    });
  }
  it('direct FINAL refresh reads one bounded page, canonical totals and no POST', async () => {
    const f = create();
    await loaded(f);
    expect(api.page).toHaveBeenCalledTimes(1);
    expect(api.publish).not.toHaveBeenCalled();
    expect(f.nativeElement.textContent).toContain('20\u00a0000');
    expect(f.nativeElement.textContent).toContain('Terrasse jardin');
    expect(f.nativeElement.textContent).not.toContain('tableCode');
  });
  it('post-close publication is separate, local and FINAL triggers canonical read', async () => {
    api.page
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }))
      .mockResolvedValue(receiptPageFixture());
    const f = create(true);
    await loaded(f);
    expect(api.publish).toHaveBeenCalledTimes(1);
    expect(api.page).toHaveBeenCalledTimes(2);
    expect(f.nativeElement.textContent).toContain('Table clôturée');
    expect(f.nativeElement.textContent).not.toContain('Enregistrement en cours');
  });
  it('publication failure preserves checkout success and same identity retry', async () => {
    api.page
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }))
      .mockResolvedValue(receiptPageFixture());
    api.publish.mockRejectedValueOnce(new Error('lost'));
    const f = create(true);
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.textContent).toContain('La table reste clôturée');
    });
    await f.componentInstance.resume();
    await loaded(f);
    expect(api.publish.mock.calls[0]).toEqual(api.publish.mock.calls[1]);
  });
  it('404 resumes BUILDING automatically and displays only canonical FINAL', async () => {
    api.page
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }))
      .mockResolvedValue(receiptPageFixture());
    api.publish
      .mockResolvedValueOnce({ state: 'BUILDING', version: 1, partCount: 1 })
      .mockResolvedValue({ state: 'FINAL', receipt: receiptSummary() });
    const f = create();
    await loaded(f);
    expect(api.publish).toHaveBeenCalledTimes(2);
    expect(api.publish.mock.calls[0]).toEqual(api.publish.mock.calls[1]);
  });
  it('post-close entry reuses existing FINAL without publication', async () => {
    const f = create(true);
    await loaded(f);
    expect(api.publish).not.toHaveBeenCalled();
    expect(f.nativeElement.textContent).toContain('XOF');
    expect(f.nativeElement.textContent).toContain(receiptSummary().receiptId);
  });
  it('renders distinct CASH applications, tender and change from frozen settlement parts', async () => {
    const page = receiptPageFixture(2, 1, 1);
    page.data = {
      ...page.data,
      dueMinor: 13500,
      paidMinor: 13500,
      paidByMethodMinor: { CASH: 13500, CARD: 0, MOBILE_MONEY: 0 },
    };
    api.page.mockResolvedValue({
      ...page,
      nextCursor: undefined,
      parts: [
        ...page.parts,
        {
          number: 2,
          previousDigest: 'a'.repeat(64),
          digest: 'b'.repeat(64),
          content: {
            kind: 'SETTLEMENT',
            payments: [
              {
                paymentId: rid(700),
                method: 'CASH',
                appliedAmountMinor: 8000,
                cashTenderedMinor: 10000,
                changeMinor: 2000,
                committedAt: '2026-10-20T12:00:00.000Z',
                allocations: [{ orderId: rid(100), amountMinor: 8000 }],
              },
              {
                paymentId: rid(701),
                method: 'CASH',
                appliedAmountMinor: 5500,
                committedAt: '2026-10-20T12:00:00.000Z',
                allocations: [{ orderId: rid(100), amountMinor: 5500 }],
              },
            ],
          },
        },
      ],
    });
    const f = create();
    await loaded(f);
    const text = f.nativeElement.textContent;
    for (const amount of [
      '13\u00a0500 XOF',
      '8\u00a0000 XOF',
      '5\u00a0500 XOF',
      '10\u00a0000 XOF',
      '2\u00a0000 XOF',
    ])
      expect(text).toContain(amount);
    expect(text).toContain('Monnaie rendue');
  });
  it('screen pagination loads only the requested next page and retains earlier DOM', async () => {
    api.page
      .mockResolvedValueOnce(receiptPageFixture(10, 1, 4))
      .mockResolvedValueOnce(receiptPageFixture(10, 5, 4));
    const f = create();
    await loaded(f);
    expect(f.componentInstance.loadedCount()).toBe(4);
    const row = f.nativeElement.querySelector('.receipt-line');
    await f.componentInstance.more();
    f.detectChanges();
    expect(api.page).toHaveBeenLastCalledWith(ctx, 'cursor-5', 4);
    expect(f.nativeElement.querySelector('.receipt-line')).toBe(row);
    expect(api.page).toHaveBeenCalledTimes(2);
    expect(f.componentInstance.moreVisible()).toBe(true);
  });
  it('print fetches remaining pages sequentially with limit8 and waits for completeness', async () => {
    let printedRows = 0;
    printer.print.mockImplementation((element: HTMLElement) => {
      printedRows = element.querySelectorAll('.receipt-line').length;
    });
    api.page
      .mockResolvedValueOnce(receiptPageFixture(14, 1, 4))
      .mockResolvedValueOnce(receiptPageFixture(14, 5, 8))
      .mockResolvedValueOnce(receiptPageFixture(14, 13, 2));
    const f = create();
    await loaded(f);
    const pending = f.componentInstance.print();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(printer.print).toHaveBeenCalledTimes(1);
    });
    await pending;
    expect(api.page.mock.calls).toEqual([[ctx], [ctx, 'cursor-5', 8], [ctx, 'cursor-13', 8]]);
    expect(printedRows).toBe(14);
    expect(f.componentInstance.visibleParts()).toHaveLength(4);
  });
  it('all cached parts invoke print without network pending state', async () => {
    const f = create();
    await loaded(f);
    const promise = f.componentInstance.print();
    expect(f.componentInstance.printBusy()).toBe(false);
    await vi.waitFor(() => {
      f.detectChanges();
      expect(printer.print).toHaveBeenCalled();
    });
    await promise;
    expect(api.page).toHaveBeenCalledTimes(1);
  });
  it('print page failure retains prior pages and retries only failed cursor', async () => {
    api.page
      .mockResolvedValueOnce(receiptPageFixture(12, 1, 4))
      .mockRejectedValueOnce(new Error('page failed'))
      .mockResolvedValueOnce(receiptPageFixture(12, 5, 8));
    const f = create();
    await loaded(f);
    await f.componentInstance.print();
    expect(printer.print).not.toHaveBeenCalled();
    expect(f.componentInstance.loadedCount()).toBe(4);
    const p = f.componentInstance.print();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(printer.print).toHaveBeenCalled();
    });
    await p;
    expect(api.page.mock.calls.map((c) => c[1])).toEqual([undefined, 'cursor-5', 'cursor-5']);
  });
  it('403 hides cached document and rejects further actions', async () => {
    const f = create();
    await loaded(f);
    api.page.mockRejectedValue(new HttpErrorResponse({ status: 403 }));
    await f.componentInstance.first.refetch();
    f.detectChanges();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.rejected()).toBe(true);
    });
    expect(f.nativeElement.querySelector('liass-receipt-document')).toBeNull();
    const calls = api.publish.mock.calls.length;
    await f.componentInstance.resume();
    expect(api.publish).toHaveBeenCalledTimes(calls);
  });
  it('account/org revision change rejects late publication and never prints', async () => {
    let resolve!: (v: unknown) => void;
    api.publish.mockImplementation(() => new Promise((r) => (resolve = r)));
    api.page.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
    const f = create(true);
    await vi.waitFor(() => expect(api.publish).toHaveBeenCalled());
    org.set('other');
    revision.set(2);
    resolve({ state: 'FINAL', receipt: receiptSummary() });
    await Promise.resolve();
    f.detectChanges();
    expect(api.page).toHaveBeenCalledTimes(1);
    expect(printer.print).not.toHaveBeenCalled();
  });
  it('receipt work leaves unrelated application/server caches untouched', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries'),
      clear = vi.spyOn(client, 'clear');
    const f = create(true);
    await loaded(f);
    expect(invalidate).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });
  it('cancelled client print preparation keeps loaded pages and sends no further cursor request', async () => {
    let resolve!: (v: unknown) => void;
    api.page
      .mockResolvedValueOnce(receiptPageFixture(14, 1, 4))
      .mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const f = create();
    await loaded(f);
    const printing = f.componentInstance.print();
    await vi.waitFor(() => expect(api.page).toHaveBeenCalledTimes(2));
    f.componentInstance.cancelPrint();
    resolve(receiptPageFixture(14, 5, 8));
    await printing;
    expect(printer.print).not.toHaveBeenCalled();
    expect(api.page).toHaveBeenCalledTimes(2);
    expect(f.componentInstance.printBusy()).toBe(false);
  });
  it('rejects non-advancing pages without claiming the document is complete', async () => {
    api.page
      .mockResolvedValueOnce(receiptPageFixture(8, 1, 4))
      .mockResolvedValueOnce(receiptPageFixture(8, 1, 4));
    const f = create();
    await loaded(f);
    await f.componentInstance.more();
    f.detectChanges();
    expect(f.componentInstance.loadedCount()).toBe(4);
    expect(printer.print).not.toHaveBeenCalled();
    expect(f.componentInstance.error()).toBe('READ_ERROR');
  });
});
