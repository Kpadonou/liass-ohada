import { HttpErrorResponse } from '@angular/common/http';
import { ZodError } from 'zod';
import { safeMessageFromError } from '../../../core/notifications/notification-message';
export function restaurantErrorKey(error: unknown): string {
  if (error instanceof ZodError) return 'RESTAURANTS.UI.ERRORS.RESPONSE';
  if (error instanceof HttpErrorResponse) {
    if (error.status === 403 || error.status === 401) return 'RESTAURANTS.UI.ERRORS.ACCESS';
    if (error.status === 409) return 'RESTAURANTS.UI.ERRORS.CONFLICT';
    if (error.status === 404) return 'RESTAURANTS.UI.ERRORS.PARENT';
    if (error.status === 400) return 'RESTAURANTS.UI.ERRORS.VALIDATION';
  }
  return 'RESTAURANTS.UI.ERRORS.NETWORK';
}
export function restaurantError(error: unknown, translate: (key: string) => string): string {
  // Conflict deliberately explains refresh/retry, as the shared server code also covers uniqueness/inactive parents.
  return restaurantErrorKey(error) === 'RESTAURANTS.UI.ERRORS.CONFLICT'
    ? translate(restaurantErrorKey(error))
    : (safeMessageFromError(error) ?? translate(restaurantErrorKey(error)));
}
