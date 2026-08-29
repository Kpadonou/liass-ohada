import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import type { SalesCatalogItem } from '@liass-ohada/shared/sales';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { NotificationService } from '../../../../core/notifications/notification.service';
import { SalesItemsApi } from '../../data-access/sales-items.api';
import { SalesItemsQueries } from '../../data-access/sales-items.queries';
import { SalesItemDialogComponent } from './sales-item-dialog.component';

describe('SalesItemDialogComponent', () => {
  const api = { create: vi.fn(), update: vi.fn() };
  const dialogRef = { close: vi.fn() };
  const notification = { error: vi.fn(), success: vi.fn() };
  const queryClient = {
    fetchQuery: vi.fn(),
    invalidateQueries: vi.fn().mockResolvedValue(undefined)
  };
  const queries = {
    detail: vi.fn((id: string) => ({ queryKey: ['sales', 'org-sales', 'items', id] })),
    detailKey: vi.fn((id: string) => ['sales', 'org-sales', 'items', id]),
    rootKey: vi.fn(() => ['sales', 'org-sales', 'items'])
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    queryClient.invalidateQueries.mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [
        SalesItemDialogComponent,
        TranslocoTestingModule.forRoot({
          langs: { en: translations },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }
        })
      ],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { mode: 'edit', item: item() } },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: NotificationService, useValue: notification },
        { provide: QueryClient, useValue: queryClient },
        { provide: SalesItemsApi, useValue: api },
        { provide: SalesItemsQueries, useValue: queries }
      ]
    }).compileComponents();
  });

  it('submits only catalog mutable fields with the authoritative expectedVersion', async () => {
    api.update.mockResolvedValue({ data: item({ name: 'Conseil premium', version: 8 }), message: null });
    const fixture = TestBed.createComponent(SalesItemDialogComponent);
    fixture.componentInstance['form'].patchValue({ name: '  Conseil premium  ', description: '', unit: ' Heure ' });

    await fixture.componentInstance['submit']();

    expect(api.update).toHaveBeenCalledWith('SI-1', {
      expectedVersion: 7,
      itemType: 'SERVICE',
      name: 'Conseil premium',
      unit: 'Heure'
    });
    const payload = api.update.mock.calls[0][1];
    for (const excluded of ['id', 'isActive', 'createdAt', 'updatedAt', 'price', 'currency', 'taxRate', 'stock', 'sku', 'barcode']) {
      expect(payload).not.toHaveProperty(excluded);
    }
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ version: 8 }));
  });

  it('keeps invalid required or overlong input in the dialog', async () => {
    const fixture = TestBed.createComponent(SalesItemDialogComponent);
    fixture.componentInstance['form'].patchValue({ name: '', unit: 'x'.repeat(81) });
    fixture.detectChanges();

    await fixture.componentInstance['submit']();
    fixture.detectChanges();

    expect(api.update).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Required.');
    expect(fixture.nativeElement.textContent).toContain('Maximum length exceeded.');
  });

  it('reloads authoritative data after 409 and retries with its latest version', async () => {
    api.update
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 409, statusText: 'Conflict' }))
      .mockResolvedValueOnce({ data: item({ version: 9 }), message: null });
    queryClient.fetchQuery.mockResolvedValue(item({ name: 'Concurrent service', version: 8 }));
    const fixture = TestBed.createComponent(SalesItemDialogComponent);

    await fixture.componentInstance['submit']();

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(notification.error).toHaveBeenCalledWith('Item changed. Latest data reloaded.');
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sales', 'org-sales', 'items'] });
    expect(fixture.componentInstance['form'].controls.name.value).toBe('Concurrent service');

    await fixture.componentInstance['submit']();
    expect(api.update).toHaveBeenLastCalledWith('SI-1', expect.objectContaining({ expectedVersion: 8 }));
  });
});

function item(overrides: Partial<SalesCatalogItem> = {}): SalesCatalogItem {
  return {
    id: 'SI-1', itemType: 'SERVICE', name: 'Conseil', description: 'Appui', unit: 'Heure',
    isActive: true, version: 7, createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides
  };
}

const translations = {
  COMMON: { ACTIONS: { CANCEL: 'Cancel', CREATE: 'Create', SAVE: 'Save' }, VALIDATION: { REQUIRED: 'Required.' } },
  SALES: { ITEMS: {
    DIALOG: { CREATE_TITLE: 'New item', EDIT_TITLE: 'Edit item', SUBTITLE: 'Catalog details' },
    ERRORS: { CONFLICT: 'Item changed. Latest data reloaded.', CREATE_FAILED: 'Create failed.', UPDATE_FAILED: 'Update failed.' },
    FORM: {
      DESCRIPTION: 'Description', TYPE: 'Type', MAX_LENGTH: 'Maximum length exceeded.', NAME: 'Name',
      UNIT: 'Unit', UNIT_HINT: 'Free-text business unit.', UNIT_PLACEHOLDER: 'Hour'
    },
    NOTIFICATIONS: { CREATED: 'Item created.', UPDATED: 'Item updated.' },
    TYPES: { PRODUCT: 'Article', SERVICE: 'Service' }
  } }
};
