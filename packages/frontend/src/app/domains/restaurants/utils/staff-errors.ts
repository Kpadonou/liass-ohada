import { HttpErrorResponse } from '@angular/common/http';
import { ZodError } from 'zod';
import { safeMessageFromError } from '../../../core/notifications/notification-message';
export function staffError(error: unknown, translate: (key: string) => string): string {
  if (error instanceof ZodError) return translate('RESTAURANTS.UI.ERRORS.RESPONSE');
  if (error instanceof HttpErrorResponse && error.status === 409)
    return translate('RESTAURANTS.TEAM.ERROR_CONFLICT');
  const fallback =
    error instanceof HttpErrorResponse
      ? [401, 403].includes(error.status)
        ? 'RESTAURANTS.TEAM.ACCESS_DENIED'
        : error.status === 404
          ? 'RESTAURANTS.TEAM.ERROR_MISSING'
          : error.status === 400
            ? 'RESTAURANTS.TEAM.ERROR_INPUT'
            : 'RESTAURANTS.UI.ERRORS.NETWORK'
      : 'RESTAURANTS.UI.ERRORS.NETWORK';
  return (
    (error instanceof HttpErrorResponse ? safeMessageFromError(error) : null) ?? translate(fallback)
  );
}
