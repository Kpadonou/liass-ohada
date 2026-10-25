import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import {
  GuestSubmissionRequestSchema,
  GuestSubmissionResponseSchema,
  GuestRequestStateResponseSchema,
  GuestContextResponseSchema,
  GuestResolveRequestSchema,
  GuestWaiterCallResponseSchema,
} from '@liass-ohada/shared/restaurants';
import { writeGuest } from './restaurant-guest-storage';
import { environment } from '../../../../environments/environment';
import { GUEST_CAPABILITY_REQUEST } from '../../../core/http/guest-request-context';

@Injectable({ providedIn: 'root' })
export class RestaurantGuestApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl.replace(/\/$/, '') + '/public/restaurants/guest';
  private recoveryScope: { token: string; key: string } | undefined;
  private recovering: Promise<string | undefined> | undefined;
  readonly recovered = signal<{
    token: string;
    result: ReturnType<typeof GuestContextResponseSchema.parse>;
  } | null>(null);
  configureRecovery(token: string, key: string) {
    this.recoveryScope = { token, key };
    this.recovering = undefined;
    this.recovered.set(null);
  }
  /** Only an explicit expired response is retried. Never retry an uncertain transport write. */
  async withRecovery<T extends { state: string }>(
    capability: string,
    action: (capability: string) => Promise<T>,
  ): Promise<T> {
    const scope = this.recoveryScope;
    const result = await action(capability);
    if (scope !== this.recoveryScope) return result;
    if (result.state !== 'EXPIRED' || !scope) return result;
    this.recovering ??= (async () => {
      let context = await this.renew(capability);
      if (context.state === 'EXPIRED' || context.state === 'UNAVAILABLE')
        context = await this.resolve(scope.token, capability);
      if (this.recoveryScope !== scope) return undefined;
      this.recovered.set({ token: scope.token, result: context });
      if (context.state !== 'FREE' && context.state !== 'OCCUPIED') return undefined;
      writeGuest(scope.key, {
        guestHandle: context.guestHandle,
        capability: context.capability,
        expiresAt: context.expiresAt,
      });
      return context.capability;
    })();
    const pending = this.recovering;
    let next: string | undefined;
    try {
      next = await pending;
    } finally {
      if (this.recovering === pending) this.recovering = undefined;
    }
    return next && this.recoveryScope === scope ? action(next) : result;
  }
  submissions(capability: string, body: unknown) {
    return this.withRecovery(capability, (next) => this.rawSubmissions(next, body));
  }
  submissionState(capability: string) {
    return this.withRecovery(capability, (next) => this.rawSubmissionState(next));
  }
  waiterCall(capability: string) {
    return this.withRecovery(capability, (next) => this.rawWaiterCall(next));
  }
  private async rawSubmissions(capability: string, body: unknown) {
    return GuestSubmissionResponseSchema.parse(
      await firstValueFrom(
        this.http
          .post<unknown>(this.base + '/submissions', GuestSubmissionRequestSchema.parse(body), {
            context: new HttpContext().set(GUEST_CAPABILITY_REQUEST, true),
            headers: { Authorization: `Bearer ${capability}` },
          })
          .pipe(timeout(15_000)),
      ),
    );
  }
  private async rawSubmissionState(capability: string) {
    return GuestRequestStateResponseSchema.parse(
      await firstValueFrom(
        this.http
          .get<unknown>(this.base + '/state', {
            context: new HttpContext().set(GUEST_CAPABILITY_REQUEST, true),
            headers: { Authorization: `Bearer ${capability}` },
          })
          .pipe(timeout(15_000)),
      ),
    );
  }
  async resolve(token: string, previousCapability?: string) {
    return GuestContextResponseSchema.parse(
      await firstValueFrom(
        this.http
          .post<unknown>(
            this.base + '/resolve',
            GuestResolveRequestSchema.parse({
              token,
              ...(previousCapability ? { previousCapability } : {}),
            }),
            {
              context: new HttpContext().set(GUEST_CAPABILITY_REQUEST, true),
            },
          )
          .pipe(timeout(15_000)),
      ),
    );
  }
  private async rawWaiterCall(capability: string) {
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
