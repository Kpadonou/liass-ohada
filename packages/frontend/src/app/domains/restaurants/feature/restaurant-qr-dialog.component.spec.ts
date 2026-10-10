import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { NotificationService } from '../../../core/notifications/notification.service';
import { RestaurantQrDialogComponent } from './restaurant-qr-dialog.component';
import { context, rid } from '../data-access/restaurants.test-fixture';
import { HttpErrorResponse } from '@angular/common/http';
describe('Protected administrative QR identity', () => {
  const org = signal('org'),
    manage = signal(true),
    api = { qr: vi.fn() },
    ref = { close: vi.fn() },
    notification = { success: vi.fn() },
    copy = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    org.set('org');
    manage.set(true);
    api.qr.mockResolvedValue({ token: 'x'.repeat(43) });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: copy.mockResolvedValue(undefined) },
    });
    TestBed.configureTestingModule({
      imports: [
        RestaurantQrDialogComponent,
        TranslocoTestingModule.forRoot({
          langs: {
            en: {
              RESTAURANTS: {
                UI: {
                  QR_TITLE: 'Table QR identity',
                  QR_HELP: 'Prepared for future use; scanning does not open a customer experience.',
                  ERRORS: { NETWORK: 'Check connection', ACCESS: 'Access changed' },
                },
              },
            },
          },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
        }),
      ],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { org: 'org', context, id: rid(4), name: 'T01' } },
        { provide: MatDialogRef, useValue: ref },
        { provide: RestaurantsApi, useValue: api },
        { provide: RestaurantsQueries, useValue: { scope: org } },
        { provide: RestaurantsCapabilities, useValue: { canManageSetup: manage } },
        { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
        { provide: NotificationService, useValue: notification },
      ],
    });
  });
  afterEach(() => TestBed.resetTestingModule());
  it('shows/copies only the opaque token for managers and explains future usage', async () => {
    const f = TestBed.createComponent(RestaurantQrDialogComponent);
    f.detectChanges();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.token()).toBe('x'.repeat(43));
    });
    expect(f.nativeElement.textContent).not.toContain(rid(4));
    expect(f.nativeElement.textContent).toContain('future use');
    await f.componentInstance.copy();
    expect(copy).toHaveBeenCalledWith('x'.repeat(43));
  });
  it('never fetches for read-only staff', () => {
    manage.set(false);
    const f = TestBed.createComponent(RestaurantQrDialogComponent);
    f.detectChanges();
    expect(api.qr).not.toHaveBeenCalled();
    expect(ref.close).toHaveBeenCalled();
  });
  it('discards delayed tokens and closes when workspace changes', async () => {
    let resolve!: (value: { token: string }) => void;
    api.qr.mockReturnValue(new Promise<{ token: string }>((done) => (resolve = done)));
    const f = TestBed.createComponent(RestaurantQrDialogComponent);
    f.detectChanges();
    org.set('other');
    f.detectChanges();
    resolve({ token: 'x'.repeat(43) });
    await vi.waitFor(() => expect(f.componentInstance.loading()).toBe(false));
    expect(f.componentInstance.token()).toBeNull();
    expect(ref.close).toHaveBeenCalled();
  });
  it('keeps permission errors contextual without exposing sensitive detail', async () => {
    api.qr.mockRejectedValue(
      new HttpErrorResponse({ status: 403, error: { message: 'DynamoDB PK secret' } }),
    );
    const f = TestBed.createComponent(RestaurantQrDialogComponent);
    f.detectChanges();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.loading()).toBe(false);
    });
    expect(f.nativeElement.textContent).toContain('Access changed');
    expect(f.nativeElement.textContent).not.toContain('PK');
    expect(f.componentInstance.token()).toBeNull();
  });
});
