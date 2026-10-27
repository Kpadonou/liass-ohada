import { HttpErrorResponse } from '@angular/common/http';
import { safeMessageFromError } from '../../../core/notifications/notification-message';
export function isInactiveInventoryError(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    error.status === 422 &&
    error.error?.error?.code === 'RESTAURANTS_INVENTORY_INACTIVE'
  );
}
export function inventoryError(error: unknown, translate: (key: string) => string): string {
  if (isInactiveInventoryError(error)) return translate('RESTAURANTS_INVENTORY.INACTIVE_HINT');
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  const key =
    status === 409
      ? 'CONFLICT'
      : status === 403 || status === 401
        ? 'FORBIDDEN'
        : status === 404
          ? 'MISSING'
          : status === 400
            ? 'INPUT'
            : 'NETWORK';
  return (
    (error instanceof HttpErrorResponse ? safeMessageFromError(error) : null) ??
    translate('RESTAURANTS_INVENTORY.ERRORS.' + key)
  );
}
