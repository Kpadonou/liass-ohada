import { Injectable, inject, effect, untracked, Injector, EffectRef } from '@angular/core';
import { QueryClient, QueryFilters, QueryKey } from '@tanstack/angular-query-experimental';

const marker = '__liassOptimisticName';
type Named = { id: string; name: string; version: number };
type Overlay = Named & { [marker]?: { name: string; owner: string } };
/** Strip presentation intent before comparing/accepting canonical versions. Never send this marker. */
export function canonicalName<T>(value: T): T {
  if (!value || typeof value !== 'object' || !(marker in value)) return value;
  const copy = { ...value, name: (value[marker] as { name: string }).name };
  delete (copy as Partial<Overlay>)[marker];
  return copy as T;
}
interface Layer {
  sequence: number;
  name: string;
}
interface Session {
  id: string;
  owner: string;
  filters: QueryFilters[];
  current: () => boolean;
  layers: Layer[];
  confirmed?: Named;
  watch?: EffectRef;
  invalid?: boolean;
}
export interface NameInteraction {
  success(entity: Named): void;
  failure(): void;
}

/** Only reversible display names. Snapshots/layers exist for the lifetime of in-flight edits.
 * Canonical collections and speculative representations both stay in QueryClient.
 */
@Injectable({ providedIn: 'root' })
export class OptimisticNames {
  private readonly client = inject(QueryClient);
  private readonly injector = inject(Injector);
  private readonly sessions = new Map<string, Session>();
  private sequence = 0;
  private rendering = false;
  private unsubscribe?: () => void;

  begin(
    scope: QueryKey,
    filters: QueryFilters[],
    id: string,
    name: string,
    current: () => boolean,
  ): NameInteraction {
    const key = JSON.stringify([scope, id]);
    let session = this.sessions.get(key);
    if (session && (session.invalid || !session.current())) {
      session.invalid = true;
      this.render();
      session.watch?.destroy();
      this.sessions.delete(key);
      session = undefined;
    }
    if (!session) {
      session = { id, owner: key, filters, current, layers: [] };
      this.sessions.set(key, session);
      const captured = session;
      captured.watch = effect(
        () => {
          if (!current()) captured.invalid = true;
          untracked(() => this.render());
        },
        { injector: this.injector },
      );
    }
    const layer = { sequence: ++this.sequence, name };
    session.layers.push(layer);
    this.unsubscribe ??= this.client.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success') this.render();
    });
    // Cancellation fences obsolete reads synchronously; rendering does not wait for the network.
    for (const filter of filters) void this.client.cancelQueries(filter);
    this.render();
    const captured = session;
    let settled = false;
    const finish = (entity?: Named) => {
      if (settled) return;
      settled = true;
      if (entity && !captured.invalid && current()) {
        const canonical = canonicalName(entity);
        if (!captured.confirmed || canonical.version >= captured.confirmed.version)
          captured.confirmed = canonical;
        // An earlier pending edit must not cover a later confirmed edit.
        captured.layers = captured.layers.filter((x) => x.sequence > layer.sequence);
      } else captured.layers = captured.layers.filter((x) => x !== layer);
      this.render();
      if (!captured.layers.length) {
        captured.watch?.destroy();
        if (this.sessions.get(key) === captured) this.sessions.delete(key);
      }
      if (!this.sessions.size) {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
      }
    };
    return { success: (entity) => finish(entity), failure: () => finish() };
  }
  private render() {
    if (this.rendering) return;
    this.rendering = true;
    try {
      for (const session of this.sessions.values()) {
        const rewrite = (value: unknown): unknown => {
          if (!value || typeof value !== 'object') return value;
          if (Array.isArray(value)) {
            const next = value.map(rewrite);
            return next.some((child, index) => child !== value[index]) ? next : value;
          }
          const row = value as Overlay;
          if (
            row.id === session.id &&
            typeof row.name === 'string' &&
            typeof row.version === 'number'
          ) {
            const active = !session.invalid && session.current();
            if (!active) return row[marker]?.owner === session.owner ? canonicalName(row) : row;
            let base = canonicalName(row);
            if (!session.confirmed || base.version >= session.confirmed.version)
              session.confirmed = base;
            else base = session.confirmed;
            const latest =
              !session.invalid && session.current() ? session.layers.at(-1) : undefined;
            if (
              latest &&
              row.version === base.version &&
              row.name === latest.name &&
              row[marker]?.name === base.name &&
              row[marker]?.owner === session.owner
            )
              return row;
            return latest
              ? { ...base, name: latest.name, [marker]: { name: base.name, owner: session.owner } }
              : base;
          }
          const entries = Object.entries(value);
          const next = entries.map(([key, child]) => [key, rewrite(child)] as const);
          return next.some((entry, index) => entry[1] !== entries[index][1])
            ? Object.fromEntries(next)
            : value;
        };
        for (const filter of session.filters)
          for (const [key, value] of this.client.getQueriesData(filter))
            if (value !== undefined) {
              const next = rewrite(value);
              if (next !== value) this.client.setQueryData(key, next);
            }
      }
    } finally {
      this.rendering = false;
    }
  }
}

export interface PendingCreation {
  mutationId: string;
  name: string;
  status: 'pending';
}
export function beginPendingCreation(client: QueryClient, key: QueryKey, name: string) {
  const intent: PendingCreation = { mutationId: crypto.randomUUID(), name, status: 'pending' };
  client.setQueryData<PendingCreation[]>(key, (old) => [...(old ?? []), intent]);
  return () =>
    client.setQueryData<PendingCreation[]>(key, (old) =>
      old?.filter((row) => row.mutationId !== intent.mutationId),
    );
}
