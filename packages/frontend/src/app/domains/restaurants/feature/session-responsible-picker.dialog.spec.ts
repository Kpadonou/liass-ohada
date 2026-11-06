import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { SessionResponsiblePickerDialog } from './session-responsible-picker.dialog';
import fr from '../../../../../public/assets/i18n/fr.json';

it('only selects active outlet employees with an eligible role and current context', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const close = vi.fn();
  let current = true;
  const person = (id: string, role: string, outletId = 'outlet') => ({
    staff: {
      userId: id,
      displayName: id,
      status: 'ACTIVE',
      organizationMembershipActive: true,
      restaurantRole: role,
    },
    assignment: { userId: id, outletId, status: 'ACTIVE' },
  });
  TestBed.configureTestingModule({
    imports: [
      SessionResponsiblePickerDialog,
      TranslocoTestingModule.forRoot({
        langs: { fr },
        translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
      }),
    ],
    providers: [
      { provide: QueryClient, useValue: client },
      { provide: MatDialogRef, useValue: { close } },
      { provide: MAT_DIALOG_DATA, useValue: { outletId: 'outlet', isCurrent: () => current } },
      {
        provide: RestaurantsQueries,
        useValue: {
          outletStaff: () => ({
            queryKey: ['synthetic-picker'],
            queryFn: async () => ({
              items: [
                person('waiter', 'WAITER'),
                person('cashier', 'CASHIER'),
                person('foreign', 'WAITER', 'other'),
              ],
            }),
            initialPageParam: undefined,
            getNextPageParam: () => undefined,
          }),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(SessionResponsiblePickerDialog);
  fixture.detectChanges();
  const picker = fixture.componentInstance;
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(picker.options()).toEqual([{ value: 'waiter', label: 'waiter' }]);
  });
  picker.choose();
  expect(close).not.toHaveBeenCalled();
  picker.selection.setValue('foreign');
  picker.choose();
  expect(close).not.toHaveBeenCalled();
  picker.selection.setValue('waiter');
  current = false;
  picker.choose();
  expect(close).not.toHaveBeenCalled();
  current = true;
  picker.choose();
  expect(close).toHaveBeenCalledWith('waiter');
  fixture.destroy();
  client.clear();
  TestBed.resetTestingModule();
});
