import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import type { SalesCustomer } from '@liass-ohada/shared/sales';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { NotificationService } from '../../../../core/notifications/notification.service';
import { SalesCustomersApi } from '../../data-access/sales-customers.api';
import { SalesCustomersQueries } from '../../data-access/sales-customers.queries';
import { SalesCustomerDialogComponent } from './sales-customer-dialog.component';

describe('SalesCustomerDialogComponent', () => {
  const existing = customer();
  const api = {
    create: vi.fn(),
    update: vi.fn()
  };
  const dialogRef = { close: vi.fn() };
  const notification = { error: vi.fn(), success: vi.fn() };
  const queryClient = {
    fetchQuery: vi.fn(),
    invalidateQueries: vi.fn().mockResolvedValue(undefined)
  };
  const queries = {
    detail: vi.fn((customerId: string) => ({ queryKey: ['sales', 'org-sales', 'customers', customerId] })),
    detailKey: vi.fn((customerId: string) => ['sales', 'org-sales', 'customers', customerId]),
    rootKey: vi.fn(() => ['sales', 'org-sales', 'customers'])
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    queryClient.invalidateQueries.mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [
        SalesCustomerDialogComponent,
        TranslocoTestingModule.forRoot({
          langs: {
            en: {
              COMMON: {
                ACTIONS: { CANCEL: 'Cancel', CREATE: 'Create', SAVE: 'Save' },
                VALIDATION: { EMAIL: 'Enter a valid email.', REQUIRED: 'Required.' }
              },
              SALES: {
                CUSTOMERS: {
                  DIALOG: { CREATE_TITLE: 'New customer', EDIT_TITLE: 'Edit customer', SUBTITLE: 'Customer details' },
                  ERRORS: { CONFLICT: 'Customer changed. Latest data reloaded.', CREATE_FAILED: 'Create failed.', UPDATE_FAILED: 'Update failed.' },
                  FORM: {
                    ADDRESS_LINE_1: 'Address', ADDRESS_LINE_2: 'Address line 2', BILLING_ADDRESS: 'Billing address',
                    CITY: 'City', COUNTRY: 'Country', EMAIL: 'Email', NAME: 'Name', NO_COUNTRY: 'None',
                    PHONE: 'Phone', POSTAL_CODE: 'Postal code', TAX_IDENTIFIER: 'Tax identifier', TYPE: 'Type'
                  },
                  TYPES: { BUSINESS: 'Business / organization', INDIVIDUAL: 'Individual' }
                }
              }
            }
          },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }
        })
      ],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { mode: 'edit', customer: existing } },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: NotificationService, useValue: notification },
        { provide: QueryClient, useValue: queryClient },
        { provide: SalesCustomersApi, useValue: api },
        { provide: SalesCustomersQueries, useValue: queries }
      ]
    }).compileComponents();
  });

  it('submits only mutable customer fields with the authoritative expectedVersion', async () => {
    api.update.mockResolvedValue({ data: customer({ name: 'Alpha Updated', version: 8 }), message: null });
    const fixture = TestBed.createComponent(SalesCustomerDialogComponent);
    fixture.componentInstance['form'].patchValue({ name: 'Alpha Updated' });

    await fixture.componentInstance['submit']();

    expect(api.update).toHaveBeenCalledWith(
      'SC-1',
      expect.objectContaining({
        customerType: 'BUSINESS',
        expectedVersion: 7,
        name: 'Alpha Updated'
      })
    );
    const payload = api.update.mock.calls[0][1];
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('isActive');
    expect(payload).not.toHaveProperty('createdAt');
    expect(payload).not.toHaveProperty('updatedAt');
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ version: 8 }));
  });

  it('keeps invalid input in the accessible dialog and does not submit', async () => {
    const fixture = TestBed.createComponent(SalesCustomerDialogComponent);
    fixture.componentInstance['form'].patchValue({ name: '', email: 'not-an-email' });
    fixture.detectChanges();

    await fixture.componentInstance['submit']();
    fixture.detectChanges();

    expect(api.update).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Required.');
    expect(fixture.nativeElement.textContent).toContain('Enter a valid email.');
  });

  it('reloads authoritative data after 409 and uses the new version on a safe retry', async () => {
    const refreshed = customer({ name: 'Alpha Concurrent', version: 8 });
    api.update
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 409, statusText: 'Conflict' }))
      .mockResolvedValueOnce({ data: customer({ name: 'Alpha Reviewed', version: 9 }), message: null });
    queryClient.fetchQuery.mockResolvedValue(refreshed);
    const fixture = TestBed.createComponent(SalesCustomerDialogComponent);

    await fixture.componentInstance['submit']();

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(notification.error).toHaveBeenCalledWith('Customer changed. Latest data reloaded.');
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['sales', 'org-sales', 'customers']
    });
    expect(queryClient.fetchQuery).toHaveBeenCalled();
    expect(fixture.componentInstance['form'].controls.name.value).toBe('Alpha Concurrent');

    fixture.componentInstance['form'].patchValue({ name: 'Alpha Reviewed' });
    await fixture.componentInstance['submit']();

    expect(api.update).toHaveBeenLastCalledWith(
      'SC-1',
      expect.objectContaining({ expectedVersion: 8, name: 'Alpha Reviewed' })
    );
  });
});

function customer(overrides: Partial<SalesCustomer> = {}): SalesCustomer {
  return {
    id: 'SC-1',
    customerType: 'BUSINESS',
    name: 'Alpha SARL',
    email: 'contact@alpha.example',
    phone: '+2290100000000',
    taxIdentifier: 'IFU-123',
    billingAddress: { line1: '1 rue du Port', city: 'Cotonou', country: 'BJ' },
    isActive: true,
    version: 7,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides
  };
}
