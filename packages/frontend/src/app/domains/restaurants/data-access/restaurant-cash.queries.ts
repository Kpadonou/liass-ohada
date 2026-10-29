import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { QueryClient, queryOptions } from '@tanstack/angular-query-experimental';
import { firstValueFrom, timeout } from 'rxjs';
import { z } from 'zod';
import * as c from '@liass-ohada/shared/restaurants';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantOutletContext } from './restaurant-outlet-context';
import { environment } from '../../../../environments/environment';
export interface CashContext {
  org: string;
  outlet: string;
  user: string;
  revision: number;
  identity: string;
}
export const cashKeys = {
  root: (s: CashContext) =>
    [
      'restaurants',
      s.org,
      'outlet',
      s.outlet,
      'cash',
      { user: s.user, revision: s.revision, identity: s.identity },
    ] as const,
  read: (s: CashContext, path: string) => [...cashKeys.root(s), path] as const,
};
export const cashReads = {
  day: c.RestaurantCurrentBusinessDayResponseSchema,
  current: c.RestaurantCurrentCashSessionResponseSchema,
};
@Injectable({ providedIn: 'root' })
export class RestaurantCashQueries {
  private readonly auth = inject(AuthStore);
  readonly outlet = inject(RestaurantOutletContext);
  private readonly http = inject(HttpClient);
  readonly client = inject(QueryClient);
  private readonly intents = new Map<string, { body: object; fingerprint: string }>();
  context(): CashContext {
    return {
      org: this.auth.effectiveOrgId() ?? '',
      user: this.auth.currentUserId() ?? '',
      revision: this.auth.contextRevision(),
      outlet: this.outlet.id(),
      identity: this.outlet.identity(),
    };
  }
  assert(s: CashContext) {
    if (JSON.stringify(s) !== JSON.stringify(this.context()))
      throw new Error('Cash context changed');
  }
  async request<T>(s: CashContext, path: string, schema: z.ZodType<T>, body?: object): Promise<T> {
    this.assert(s);
    c.RestaurantIdSchema.parse(s.outlet);
    const url =
      environment.apiBaseUrl.replace(/\/$/, '') + `/restaurants/outlets/${s.outlet}/${path}`;
    const raw = await firstValueFrom(
      (body ? this.http.post<unknown>(url, body) : this.http.get<unknown>(url)).pipe(
        timeout(35000),
      ),
    );
    this.assert(s);
    return schema.parse(raw);
  }
  options<T>(s: CashContext, path: string, schema: z.ZodType<T>, enabled = true) {
    return queryOptions({
      queryKey: cashKeys.read(s, path),
      enabled: enabled && !!s.org && !!s.outlet,
      staleTime: 30000,
      retry: false,
      queryFn: () => this.request(s, path, schema),
    });
  }
  day(s: CashContext) {
    return this.options(s, 'business-days/current', c.RestaurantCurrentBusinessDayResponseSchema);
  }
  current(s: CashContext) {
    return this.options(s, 'cash-sessions/current', c.RestaurantCurrentCashSessionResponseSchema);
  }
  detail(s: CashContext, id: string) {
    return this.options(s, `cash-sessions/${id}`, c.RestaurantCashSessionResponseSchema, !!id);
  }
  businessDay(s: CashContext, id: string) {
    return this.options(s, `business-days/${id}`, c.RestaurantBusinessDayResponseSchema, !!id);
  }
  summary(s: CashContext, id: string, allowed: boolean) {
    return this.options(
      s,
      `business-days/${id}/summary`,
      c.RestaurantBusinessDaySummaryResponseSchema,
      !!id && allowed,
    );
  }
  sessions(s: CashContext, id: string) {
    return this.options(
      s,
      `business-days/${id}/cash-sessions`,
      c.RestaurantCashSessionListResponseSchema,
      !!id,
    );
  }
  movements(s: CashContext, id: string, cursor?: string) {
    return this.options(
      s,
      `cash-sessions/${id}/movements${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`,
      c.RestaurantCashMovementListResponseSchema,
      !!id,
    );
  }
  async seed<T>(s: CashContext, path: string, value: T) {
    await this.client.cancelQueries({ queryKey: cashKeys.read(s, path), exact: true });
    this.assert(s);
    this.client.setQueryData(cashKeys.read(s, path), value);
  }
  async command<T>(s: CashContext, path: string, proposal: object, schema: z.ZodType<T>) {
    const key = JSON.stringify([s, path]),
      fingerprint = JSON.stringify(proposal);
    const prior = this.intents.get(key);
    if (prior && prior.fingerprint !== fingerprint) throw new Error('Unresolved cash command');
    const intent = prior ?? {
      fingerprint,
      body: { ...proposal, clientRequestId: crypto.randomUUID() },
    };
    this.intents.set(key, intent);
    try {
      const result = await this.request(s, path, schema, intent.body);
      this.intents.delete(key);
      return result;
    } catch (error) {
      if (
        error instanceof HttpErrorResponse &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408
      )
        this.intents.delete(key);
      this.assert(s);
      await this.client.invalidateQueries({ queryKey: cashKeys.root(s) });
      throw error;
    }
  }
  async confirmedSession(s: CashContext, value: c.RestaurantCashSession) {
    await this.seed(s, `cash-sessions/${value.cashSessionId}`, { data: value });
    const current = this.client.getQueryData<{ data: c.RestaurantCashSession | null }>(
      cashKeys.read(s, 'cash-sessions/current'),
    );
    if (
      value.cashierUserId === s.user &&
      (!current?.data || current.data.cashSessionId === value.cashSessionId)
    )
      await this.seed(s, 'cash-sessions/current', { data: value });
    const path = `business-days/${value.businessDayId}/cash-sessions`;
    const list = this.client.getQueryData<{
      items: c.RestaurantCashSession[];
      nextCursor?: string;
    }>(cashKeys.read(s, path));
    if (list)
      await this.seed(s, path, {
        ...list,
        items: list.items.map((row) => (row.cashSessionId === value.cashSessionId ? value : row)),
      });
    // Session close/open changes the day's version and counters, absent from the session DTO.
    await Promise.all(
      ['business-days/current', `business-days/${value.businessDayId}/summary`].map((path) =>
        this.client.invalidateQueries({ queryKey: cashKeys.read(s, path), exact: true }),
      ),
    );
  }
  async confirmedDay(s: CashContext, value: c.RestaurantBusinessDay) {
    await this.seed(s, `business-days/${value.businessDayId}`, { data: value });
    await this.seed(s, 'business-days/current', { data: value.status === 'OPEN' ? value : null });
    const path = `business-days/${value.businessDayId}/summary`;
    const summary = this.client.getQueryData<{ data: c.RestaurantBusinessDaySummary }>(
      cashKeys.read(s, path),
    );
    if (summary) await this.seed(s, path, { data: { ...summary.data, businessDay: value } });
  }
  async confirmedMovement(s: CashContext, value: c.RestaurantCashMovement) {
    const path = `cash-sessions/${value.cashSessionId}/movements`;
    const page = this.client.getQueryData<{
      items: c.RestaurantCashMovement[];
      nextCursor?: string;
    }>(cashKeys.read(s, path));
    if (page)
      await this.seed(s, path, {
        ...page,
        items: [value, ...page.items.filter((row) => row.movementId !== value.movementId)].sort(
          (a, b) =>
            b.occurredAt.localeCompare(a.occurredAt) || b.movementId.localeCompare(a.movementId),
        ),
      });
    // Movement response contains no authoritative session totals/version.
    await Promise.all(
      [
        `cash-sessions/${value.cashSessionId}`,
        'cash-sessions/current',
        `business-days/${value.businessDayId}/summary`,
      ].map((path) =>
        this.client.invalidateQueries({ queryKey: cashKeys.read(s, path), exact: true }),
      ),
    );
  }
  async requirePayment(s: CashContext) {
    const [day, session] = await Promise.all([
      this.client.fetchQuery(this.day(s)),
      this.client.fetchQuery(this.current(s)),
    ]);
    this.assert(s);
    return (
      !!day.data &&
      !!session.data &&
      session.data.status === 'OPEN' &&
      session.data.businessDayId === day.data.businessDayId
    );
  }
  async reconcile(s: CashContext) {
    this.assert(s);
    await this.client.invalidateQueries({ queryKey: cashKeys.root(s) });
  }
}
