import { Injectable, computed, inject } from '@angular/core';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { GuestSubmissionRequestSchema } from '@liass-ohada/shared/restaurants';
import { RestaurantGuestApi } from './restaurant-guest.api';
import { RestaurantGuestCartStore } from './restaurant-guest-cart.store';
/** Only uncertain local command intent is persisted; canonical statuses stay in Query. */
@Injectable({ providedIn: 'root' })
export class RestaurantGuestSubmissions {
  private inFlight = false;
  readonly cart = inject(RestaurantGuestCartStore);
  private readonly api = inject(RestaurantGuestApi);
  private readonly client = inject(QueryClient);
  readonly identity = computed(() =>
    [
      this.cart.storageScope(),
      this.cart.context()?.visitRef,
      this.cart.context()?.guestHandle,
    ].join(':'),
  );
  readonly key = computed(() => ['restaurants-guest', 'submissions', this.identity()] as const);
  private storageKey() {
    return this.cart.storageScope() + '.submission.v1';
  }
  private restored() {
    try {
      const value = JSON.parse(sessionStorage.getItem(this.storageKey()) ?? 'null');
      return value?.identity === this.identity()
        ? GuestSubmissionRequestSchema.parse(value.body)
        : null;
    } catch {
      return null;
    }
  }
  readonly state = injectQuery(() => ({
    queryKey: this.key(),
    queryFn: () => this.api.submissionState(this.cart.context()!.capability),
    enabled: this.cart.context()?.state === 'OCCUPIED',
    staleTime: 15_000,
    retry: false,
    gcTime: 0,
  }));
  readonly canSend = computed(
    () =>
      this.cart.context()?.state === 'OCCUPIED' &&
      this.cart.context()?.policy === 'STAFF_APPROVAL' &&
      this.cart.contextStatus() === 'ACTIVE_VISIT' &&
      this.cart.lines().length > 0 &&
      this.cart
        .lines()
        .every((l) => l.status === 'READY' && Date.parse(l.selectionExpiresAt) > Date.now()),
  );
  readonly send = injectMutation(() => ({
    mutationKey: this.key(),
    retry: false,
    gcTime: 0,
    onSettled: () => {
      this.inFlight = false;
    },
    mutationFn: async (command: {
      identity: string;
      capability: string;
      storageKey: string;
      body: unknown;
    }) => {
      const { identity, capability } = command;
      const body = GuestSubmissionRequestSchema.parse(command.body);
      // Fail before sending if durable local uncertainty recovery is unavailable.
      sessionStorage.setItem(command.storageKey, JSON.stringify({ identity, body }));
      return { identity, body, result: await this.api.submissions(capability, body) };
    },
    onSuccess: ({ identity, body, result }) => {
      if (identity !== this.identity()) return;
      if (result.state === 'CONFIRMED') {
        const current = this.cart.lines().map((l) => ({
          reference: l.reference,
          selectionRef: l.selectionRef,
          quantity: l.quantity,
          note: l.note,
          presentedAmountMinor: l.presentedAmountMinor,
          currency: l.currency,
        }));
        const intent = (lines: typeof current) =>
          lines.map(({ selectionRef: _reference, ...line }) => line);
        if (JSON.stringify(intent(current)) === JSON.stringify(intent(body.lines)))
          this.cart.discard();
        sessionStorage.removeItem(this.storageKey());
        this.client.setQueryData(
          this.key(),
          (old: { state: string; requests?: unknown[] } | undefined) => ({
            state: 'READY',
            requests: [
              ...(old?.requests ?? []).filter(
                (r: unknown) => (r as { requestId: string }).requestId !== result.request.requestId,
              ),
              result.request,
            ],
          }),
        );
      } else if (['REVIEW_REQUIRED', 'NOT_ALLOWED', 'LIMIT_REACHED'].includes(result.state))
        sessionStorage.removeItem(this.storageKey());
      void this.client.invalidateQueries({ queryKey: this.key() });
    },
  }));
  submit() {
    if (
      !this.inFlight &&
      !this.send.isPending() &&
      this.cart.context()?.state === 'OCCUPIED' &&
      this.cart.context()?.policy === 'STAFF_APPROVAL' &&
      (this.canSend() || this.restored())
    ) {
      this.inFlight = true;
      this.send.mutate({
        identity: this.identity(),
        capability: this.cart.context()!.capability,
        storageKey: this.storageKey(),
        body: this.restored() ?? {
          clientRequestId: crypto.randomUUID(),
          lines: this.cart.lines().map((l) => ({
            reference: l.reference,
            selectionRef: l.selectionRef,
            quantity: l.quantity,
            note: l.note,
            presentedAmountMinor: l.presentedAmountMinor,
            currency: l.currency,
          })),
        },
      });
    }
  }
}
