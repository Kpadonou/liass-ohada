import { computed, Injectable, signal } from '@angular/core';
import { GuestCarte, GuestContextResponse } from '@liass-ohada/shared/restaurants';
import { z } from 'zod';

type GuestContext = Extract<GuestContextResponse, { state: 'FREE' | 'OCCUPIED' }>;
type GuestCarteItem = GuestCarte['categories'][number]['items'][number];
export type GuestCartLineStatus = 'READY' | 'PRICE_CHANGED' | 'UNAVAILABLE' | 'MISSING';
export type GuestCartContextStatus =
  | 'FREE'
  | 'ACTIVE_VISIT'
  | 'VISIT_ENDED'
  | 'DIFFERENT_VISIT'
  | 'CONTEXT_UNAVAILABLE';
export type GuestCartResult =
  | 'OK'
  | 'LINE_LIMIT'
  | 'LINE_QUANTITY_LIMIT'
  | 'TOTAL_QUANTITY_LIMIT'
  | 'REVIEW_REQUIRED'
  | 'CONTEXT_BLOCKED'
  | 'INVALID_QUANTITY'
  | 'NOTE_LIMIT';

const CartLineSchema = z
  .object({
    reference: z.string().min(8).max(4096),
    selectionRef: z.string().min(16).max(4096),
    selectionExpiresAt: z.string().datetime(),
    name: z.string().min(1).max(160),
    presentedAmountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    currency: z.string().regex(/^[A-Z]{3}$/),
    quantity: z.number().int().min(1).max(20),
    note: z.string().max(250),
    availability: z.enum(['AVAILABLE', 'UNAVAILABLE']),
    status: z.enum(['READY', 'PRICE_CHANGED', 'UNAVAILABLE', 'MISSING']),
    proposedAmountMinor: z.number().int().nonnegative().optional(),
    proposedSelectionRef: z.string().min(16).max(4096).optional(),
    proposedSelectionExpiresAt: z.string().datetime().optional(),
  })
  .strict();
const CartEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    qrScope: z.string().regex(/^liass-restaurants\.guest\.[a-f0-9]{64}$/),
    originGuestHandle: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
    scope: z.enum(['FREE', 'VISIT']),
    visitRef: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .nullable(),
    visitEnded: z.boolean(),
    lines: z.array(CartLineSchema).max(12),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((cart, ctx) => {
    if ((cart.scope === 'FREE') !== (cart.visitRef === null))
      ctx.addIssue({ code: 'custom', message: 'Invalid cart scope' });
    if (cart.lines.reduce((total, line) => total + line.quantity, 0) > 100)
      ctx.addIssue({ code: 'custom', message: 'Invalid cart quantity' });
  });

export type GuestCartLine = z.infer<typeof CartLineSchema>;
export type GuestCartEnvelope = z.infer<typeof CartEnvelopeSchema>;
const cartKey = (scope: string) => scope + '.cart.v1';

@Injectable({ providedIn: 'root' })
export class RestaurantGuestCartStore {
  private readonly activeScope = signal('');
  private readonly activeContext = signal<GuestContext | null>(null);
  private readonly value = signal<GuestCartEnvelope | null>(null);

  readonly cart = this.value.asReadonly();
  readonly lines = computed(() => this.value()?.lines ?? []);
  readonly distinctLines = computed(() => this.lines().length);
  readonly totalUnits = computed(() =>
    this.lines().reduce((total, line) => total + line.quantity, 0),
  );
  readonly totalAmountMinor = computed(() =>
    this.lines().reduce((total, line) => total + line.presentedAmountMinor * line.quantity, 0),
  );
  readonly currency = computed(() => this.lines()[0]?.currency ?? 'XOF');
  readonly contextStatus = computed<GuestCartContextStatus>(() => {
    const cart = this.value();
    const context = this.activeContext();
    if (!cart) return context?.state === 'OCCUPIED' ? 'ACTIVE_VISIT' : 'FREE';
    if (cart.scope === 'FREE') return context ? 'FREE' : 'CONTEXT_UNAVAILABLE';
    if (cart.visitEnded) return 'VISIT_ENDED';
    if (!context) return 'CONTEXT_UNAVAILABLE';
    if (context.state === 'FREE') return 'VISIT_ENDED';
    return context.visitRef === cart.visitRef ? 'ACTIVE_VISIT' : 'DIFFERENT_VISIT';
  });
  readonly canEdit = computed(
    () => !['VISIT_ENDED', 'DIFFERENT_VISIT'].includes(this.contextStatus()),
  );

  activate(scope: string, context: GuestContext | null) {
    if (this.activeScope() !== scope) {
      this.activeScope.set(scope);
      this.value.set(this.read(scope));
    }
    this.activeContext.set(context);
    const cart = this.value();
    if (cart?.scope === 'FREE' && context?.state === 'OCCUPIED' && context.visitRef) {
      this.commit({
        ...cart,
        scope: 'VISIT',
        visitRef: context.visitRef,
        visitEnded: false,
      });
    }
  }

  markVisitEnded() {
    const cart = this.value();
    if (cart?.scope === 'VISIT') this.commit({ ...cart, visitEnded: true });
    this.activeContext.set(null);
  }

  add(item: GuestCarteItem, currency: string, selectionExpiresAt: string): GuestCartResult {
    if (!this.canEdit()) return 'CONTEXT_BLOCKED';
    if (item.availability !== 'AVAILABLE') return 'REVIEW_REQUIRED';
    const cart = this.ensureCart();
    if (!cart) return 'CONTEXT_BLOCKED';
    const index = cart.lines.findIndex((line) => line.reference === item.reference);
    if (index >= 0) {
      if (cart.lines[index].status !== 'READY') return 'REVIEW_REQUIRED';
      return this.setQuantity(item.reference, cart.lines[index].quantity + 1);
    }
    if (cart.lines.length >= 12) return 'LINE_LIMIT';
    if (this.totalUnits() >= 100) return 'TOTAL_QUANTITY_LIMIT';
    this.commit({
      ...cart,
      lines: [
        ...cart.lines,
        {
          reference: item.reference,
          selectionRef: item.selectionRef,
          selectionExpiresAt,
          name: item.name,
          presentedAmountMinor: item.amountMinor,
          currency,
          quantity: 1,
          note: '',
          availability: item.availability,
          status: 'READY',
        },
      ],
    });
    return 'OK';
  }

  remove(reference: string) {
    const cart = this.value();
    if (!cart) return;
    const lines = cart.lines.filter((line) => line.reference !== reference);
    if (lines.length) this.commit({ ...cart, lines });
    else this.clear();
  }

  setQuantity(reference: string, quantity: number): GuestCartResult {
    if (!this.canEdit()) return 'CONTEXT_BLOCKED';
    if (!Number.isInteger(quantity) || quantity < 1) return 'INVALID_QUANTITY';
    if (quantity > 20) return 'LINE_QUANTITY_LIMIT';
    const cart = this.value();
    const line = cart?.lines.find((candidate) => candidate.reference === reference);
    if (!cart || !line) return 'INVALID_QUANTITY';
    const nextTotal = this.totalUnits() - line.quantity + quantity;
    if (nextTotal > 100) return 'TOTAL_QUANTITY_LIMIT';
    this.commit({
      ...cart,
      lines: cart.lines.map((candidate) =>
        candidate.reference === reference ? { ...candidate, quantity } : candidate,
      ),
    });
    return 'OK';
  }

  setNote(reference: string, note: string): GuestCartResult {
    if (!this.canEdit()) return 'CONTEXT_BLOCKED';
    if (note.length > 250) return 'NOTE_LIMIT';
    const cart = this.value();
    if (!cart?.lines.some((line) => line.reference === reference)) return 'REVIEW_REQUIRED';
    this.commit({
      ...cart,
      lines: cart.lines.map((line) => (line.reference === reference ? { ...line, note } : line)),
    });
    return 'OK';
  }

  reconcile(items: GuestCarteItem[], currency: string, selectionExpiresAt: string) {
    const cart = this.value();
    if (!cart || ['VISIT_ENDED', 'DIFFERENT_VISIT'].includes(this.contextStatus())) return;
    const current = new Map(items.map((item) => [item.reference, item]));
    const lines = cart.lines.map((line): GuestCartLine => {
      const item = current.get(line.reference);
      if (!item) return { ...line, status: 'MISSING' };
      if (item.availability === 'UNAVAILABLE')
        return {
          ...line,
          availability: 'UNAVAILABLE',
          status: 'UNAVAILABLE',
          proposedAmountMinor:
            item.amountMinor === line.presentedAmountMinor ? undefined : item.amountMinor,
          proposedSelectionRef: item.selectionRef,
          proposedSelectionExpiresAt: selectionExpiresAt,
        };
      if (item.amountMinor !== line.presentedAmountMinor)
        return {
          ...line,
          availability: 'AVAILABLE',
          status: 'PRICE_CHANGED',
          proposedAmountMinor: item.amountMinor,
          proposedSelectionRef: item.selectionRef,
          proposedSelectionExpiresAt: selectionExpiresAt,
        };
      return {
        ...line,
        name: item.name,
        currency,
        availability: 'AVAILABLE',
        status: 'READY',
        selectionRef: item.selectionRef,
        selectionExpiresAt,
        proposedAmountMinor: undefined,
        proposedSelectionRef: undefined,
        proposedSelectionExpiresAt: undefined,
      };
    });
    if (JSON.stringify(lines) !== JSON.stringify(cart.lines)) this.commit({ ...cart, lines });
  }

  acceptPrice(reference: string) {
    if (!this.canEdit()) return;
    const cart = this.value();
    if (!cart) return;
    this.commit({
      ...cart,
      lines: cart.lines.map((line) => {
        if (
          line.reference !== reference ||
          line.proposedAmountMinor === undefined ||
          !line.proposedSelectionRef ||
          !line.proposedSelectionExpiresAt
        )
          return line;
        return {
          ...line,
          presentedAmountMinor: line.proposedAmountMinor,
          selectionRef: line.proposedSelectionRef,
          selectionExpiresAt: line.proposedSelectionExpiresAt,
          status: line.availability === 'AVAILABLE' ? ('READY' as const) : ('UNAVAILABLE' as const),
          proposedAmountMinor: undefined,
          proposedSelectionRef: undefined,
          proposedSelectionExpiresAt: undefined,
        };
      }),
    });
  }

  discard() {
    this.clear();
  }

  private ensureCart() {
    const existing = this.value();
    if (existing) return existing;
    const scope = this.activeScope();
    const context = this.activeContext();
    if (!scope || !context) return null;
    const now = new Date().toISOString();
    const created: GuestCartEnvelope = {
      schemaVersion: 1,
      qrScope: scope,
      originGuestHandle: context.guestHandle,
      scope: context.state === 'OCCUPIED' ? 'VISIT' : 'FREE',
      visitRef: context.visitRef,
      visitEnded: false,
      lines: [],
      createdAt: now,
      updatedAt: now,
    };
    this.value.set(created);
    return created;
  }

  private commit(cart: GuestCartEnvelope) {
    const value = CartEnvelopeSchema.parse({
      ...cart,
      updatedAt: new Date().toISOString(),
    });
    this.value.set(value);
    try {
      sessionStorage.setItem(cartKey(value.qrScope), JSON.stringify(value));
    } catch {
      /* The cart remains usable in memory when tab storage is unavailable. */
    }
  }

  private clear() {
    const scope = this.activeScope();
    this.value.set(null);
    try {
      if (scope) sessionStorage.removeItem(cartKey(scope));
    } catch {
      /* Nothing else to clear. */
    }
  }

  private read(scope: string) {
    try {
      const parsed = CartEnvelopeSchema.safeParse(
        JSON.parse(sessionStorage.getItem(cartKey(scope)) ?? 'null'),
      );
      return parsed.success && parsed.data.qrScope === scope ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
