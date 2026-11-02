import { Injectable, inject } from '@angular/core';
import { infiniteQueryOptions } from '@tanstack/angular-query-experimental';
import * as c from '@liass-ohada/shared/restaurants';
import { CashContext, RestaurantCashQueries } from './restaurant-cash.queries';
export const documentCollectionKey = (s: CashContext, kind: 'invoices' | 'credit-notes') =>
  [
    'restaurants',
    s.org,
    'outlet',
    s.outlet,
    'documents',
    kind,
    { user: s.user, revision: s.revision, identity: s.identity },
  ] as const;
export interface DocumentFilters {
  from: string;
  to: string;
  businessDayId?: string;
  q?: string;
}
@Injectable({ providedIn: 'root' })
export class RestaurantDocumentCollectionsQueries {
  readonly transport = inject(RestaurantCashQueries);
  invoices(s: CashContext, filters: DocumentFilters, enabled = true) {
    return this.pages(s, 'invoices', filters, c.RestaurantInvoiceCollectionResponseSchema, enabled);
  }
  credits(s: CashContext, filters: DocumentFilters, enabled = true) {
    return this.pages(
      s,
      'credit-notes',
      filters,
      c.RestaurantCreditNoteCollectionResponseSchema,
      enabled,
    );
  }
  private pages<T extends { nextCursor?: string }>(
    s: CashContext,
    kind: 'invoices' | 'credit-notes',
    filters: DocumentFilters,
    schema: import('zod').z.ZodType<T>,
    enabled: boolean,
  ) {
    return infiniteQueryOptions({
      queryKey: [...documentCollectionKey(s, kind), filters],
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) => {
        const request = c.RestaurantDocumentCollectionRequestSchema.parse({
          ...filters,
          limit: 50,
          ...(pageParam ? { cursor: pageParam } : {}),
        });
        const params = new URLSearchParams(
          Object.entries(request)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        );
        return this.transport.request(s, `${kind}?${params}`, schema);
      },
      getNextPageParam: (page) => page.nextCursor,
      staleTime: 30_000,
      retry: false,
      enabled: enabled && !!s.org && !!s.outlet,
    });
  }
}
