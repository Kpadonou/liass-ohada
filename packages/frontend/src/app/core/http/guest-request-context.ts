import { HttpContextToken, HttpRequest } from '@angular/common/http';
/** Only the Restaurants Guest client sets this; exact URLs are checked independently. */
export const GUEST_CAPABILITY_REQUEST = new HttpContextToken<boolean>(() => false);
export function isGuestRequest(request: HttpRequest<unknown>, base: string) {
  return (
    (request.method === 'POST' &&
      ['resolve', 'renew', 'waiter-call', 'submissions'].some(
        (op) => request.url === base + '/public/restaurants/guest/' + op,
      )) ||
    (request.method === 'GET' &&
      ['carte', 'state'].some((op) => request.url === base + '/public/restaurants/guest/' + op))
  );
}
export function isolateGuestRequest(request: HttpRequest<unknown>) {
  let headers = request.headers.delete('x-org-id').delete('x-workspace-org-id');
  if (
    !request.context.get(GUEST_CAPABILITY_REQUEST) ||
    request.url.endsWith('/resolve') ||
    !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
      headers.get('Authorization') ?? '',
    )
  )
    headers = headers.delete('Authorization');
  return request.clone({ headers, withCredentials: false });
}
