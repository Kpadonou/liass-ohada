import { HttpErrorResponse } from '@angular/common/http';
import { safeMessageFromError } from '../../../core/notifications/notification-message';
import { restaurantErrorKey } from './restaurant-errors';
/** Checkout conflicts must never use configuration/table-code conflict copy. */
export function checkoutError(error: unknown, translate: (key: string) => string): string {
  if (!(error instanceof HttpErrorResponse)) return translate('RESTAURANTS.CHECKOUT.READ_ERROR');
  return (
    safeMessageFromError(error) ??
    translate(error.status === 409 ? 'RESTAURANTS.CHECKOUT.CONFLICT' : restaurantErrorKey(error))
  );
}
