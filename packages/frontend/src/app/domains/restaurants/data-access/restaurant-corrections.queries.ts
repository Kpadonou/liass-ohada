import { Injectable, inject } from '@angular/core';
import { infiniteQueryOptions } from '@tanstack/angular-query-experimental';
import * as c from '@liass-ohada/shared/restaurants';
import { CashContext, RestaurantCashQueries, cashKeys } from './restaurant-cash.queries';
import { documentCollectionKey } from './restaurant-document-collections.queries';

/** Context-isolated server state; commands submit intent and await canonical confirmation. */
@Injectable({ providedIn: 'root' })
export class RestaurantCorrectionsQueries {
  private readonly cash = inject(RestaurantCashQueries);

  async createCredit(s: CashContext, session: string, intent: unknown) {
    const body = c.CreateRestaurantCreditNoteRequestSchema.parse(intent);
    const result = await this.cash.request(
      s,
      `sessions/${session}/credit-notes`,
      c.RestaurantCreditNoteDetailResponseSchema,
      body,
    );
    this.cash.client.setQueryData(this.creditNote(s, result.data.creditNoteId).queryKey, result);
    await this.cash.client.invalidateQueries({ queryKey: this.creditNotes(s, session).queryKey });
    await this.cash.client.invalidateQueries({
      queryKey: documentCollectionKey(s, 'credit-notes'),
    });
    await this.cash.client.invalidateQueries({
      queryKey: cashKeys.read(s, 'business-days/current'),
    });
    return result;
  }

  async createRefund(s: CashContext, id: string, intent: unknown) {
    const body = c.CreateRestaurantRefundRequestSchema.parse(intent);
    const result = await this.cash.request(
      s,
      `credit-notes/${id}/refunds`,
      c.RestaurantRefundResponseSchema,
      body,
    );
    await Promise.all([
      this.cash.client.invalidateQueries({ queryKey: documentCollectionKey(s, 'credit-notes') }),
      this.cash.client.invalidateQueries({ queryKey: this.creditNote(s, id).queryKey }),
      this.cash.client.invalidateQueries({ queryKey: this.refunds(s, id).queryKey }),
      this.cash.client.invalidateQueries({ queryKey: this.cash.current(s).queryKey }),
      this.cash.client.invalidateQueries({
        queryKey: cashKeys.read(s, `cash-sessions/${result.data.cashSessionId}`),
      }),
      this.cash.client.invalidateQueries({
        queryKey: cashKeys.read(s, `business-days/${result.data.businessDayId}/cash-sessions`),
      }),
      this.cash.client.invalidateQueries({
        queryKey: cashKeys.read(s, `business-days/${result.data.businessDayId}/summary`),
      }),
    ]);
    return result;
  }

  creditNotes(s: CashContext, session: string) {
    c.RestaurantIdSchema.parse(session);
    return this.pages(
      s,
      `sessions/${session}/credit-notes`,
      c.RestaurantCreditNoteListResponseSchema,
    );
  }

  creditNote(s: CashContext, id: string) {
    c.RestaurantIdSchema.parse(id);
    return this.cash.options(s, `credit-notes/${id}`, c.RestaurantCreditNoteDetailResponseSchema);
  }

  refunds(s: CashContext, id: string) {
    c.RestaurantIdSchema.parse(id);
    return this.pages(s, `credit-notes/${id}/refunds`, c.RestaurantRefundListResponseSchema);
  }

  private pages<T extends { nextCursor?: string }>(
    s: CashContext,
    path: string,
    schema: import('zod').z.ZodType<T>,
  ) {
    return infiniteQueryOptions({
      queryKey: cashKeys.read(s, path),
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) =>
        this.cash.request(
          s,
          `${path}?limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
          schema,
        ),
      getNextPageParam: (page) => page.nextCursor,
      staleTime: 30_000,
      retry: false,
      enabled: !!s.org && !!s.outlet,
    });
  }
}
