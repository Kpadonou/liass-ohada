import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { GuestCarteResponse, GuestCarteResponseSchema } from '@liass-ohada/shared/restaurants';
import { environment } from '../../../../environments/environment';
import { GUEST_CAPABILITY_REQUEST } from '../../../core/http/guest-request-context';

export interface GuestCartePage {
  body: GuestCarteResponse;
  etag?: string;
}
export const guestCarteKey = (scope: string, handle: string) =>
  ['restaurants-guest', 'carte', scope, handle] as const;
@Injectable({ providedIn: 'root' })
export class RestaurantGuestCarteApi {
  private readonly http = inject(HttpClient);
  async read(
    capability: string,
    cursor?: string,
    previous?: GuestCartePage,
  ): Promise<GuestCartePage> {
    const headers: Record<string, string> = { Authorization: `Bearer ${capability}` };
    if (previous?.etag) headers['If-None-Match'] = previous.etag;
    try {
      const response = await firstValueFrom(
        this.http
          .get<unknown>(
            environment.apiBaseUrl.replace(/\/$/, '') + '/public/restaurants/guest/carte',
            {
              headers,
              params: cursor ? new HttpParams().set('cursor', cursor) : undefined,
              context: new HttpContext().set(GUEST_CAPABILITY_REQUEST, true),
              observe: 'response',
            },
          )
          .pipe(timeout(15_000)),
      );
      return {
        body: GuestCarteResponseSchema.parse(response.body),
        etag: response.headers.get('ETag') ?? undefined,
      };
    } catch (error) {
      // Angular represents 304 as HttpErrorResponse. Only a validator-backed canonical
      // cached page can satisfy it; never manufacture an empty successful response.
      if (error instanceof HttpErrorResponse && error.status === 304 && previous?.etag)
        return previous;
      throw error;
    }
  }
}
