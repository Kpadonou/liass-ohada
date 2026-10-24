import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import {
  GuestContextResponseSchema,
  GuestResolveRequestSchema,
  GuestWaiterCallResponseSchema,
} from '@liass-ohada/shared/restaurants';
import { environment } from '../../../../environments/environment';
import { GUEST_CAPABILITY_REQUEST } from '../../../core/http/guest-request-context';

@Injectable({ providedIn: 'root' })
export class RestaurantGuestApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl.replace(/\/$/, '') + '/public/restaurants/guest';
  async resolve(token: string) {
    return GuestContextResponseSchema.parse(
      await firstValueFrom(
        this.http
          .post<unknown>(this.base + '/resolve', GuestResolveRequestSchema.parse({ token }), {
            context: new HttpContext().set(GUEST_CAPABILITY_REQUEST, true),
          })
          .pipe(timeout(15_000)),
      ),
    );
  }
  async waiterCall(capability: string) {
    return GuestWaiterCallResponseSchema.parse(
      await firstValueFrom(
        this.http
          .post<unknown>(
            this.base + '/waiter-call',
            {},
            {
              context: new HttpContext().set(GUEST_CAPABILITY_REQUEST, true),
              headers: { Authorization: `Bearer ${capability}` },
            },
          )
          .pipe(timeout(15_000)),
      ),
    );
  }
  async renew(capability: string) {
    return GuestContextResponseSchema.parse(
      await firstValueFrom(
        this.http
          .post<unknown>(
            this.base + '/renew',
            {},
            {
              context: new HttpContext().set(GUEST_CAPABILITY_REQUEST, true),
              headers: { Authorization: `Bearer ${capability}` },
            },
          )
          .pipe(timeout(15_000)),
      ),
    );
  }
}
