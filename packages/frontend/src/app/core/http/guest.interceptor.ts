import { HttpInterceptorFn } from '@angular/common/http';
import { throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { isGuestRequest, isolateGuestRequest } from './guest-request-context';
const base = environment.apiBaseUrl.replace(/\/$/, '');
/** Public bootstrap cannot fall through to staff credentials or services. */
export const guestInterceptor: HttpInterceptorFn = (request, next) => {
  if (isGuestRequest(request, base)) return next(isolateGuestRequest(request));
  if (request.url.startsWith(base)) return throwError(() => new Error('Guest request unavailable'));
  return next(request.clone({ withCredentials: false }));
};
