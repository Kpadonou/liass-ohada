import * as C from '@liass-ohada/shared/restaurants';
import { z } from 'zod';
import type { InventoryContext } from '../data-access/restaurant-inventory.api';

export type TrackingFailureReason =
  | 'TRACKING_CONTRACT_UNAVAILABLE'
  | 'MISSING_MENU_ITEM_ID'
  | 'MISSING_CATEGORY_ID'
  | 'MISSING_OUTLET_ID'
  | 'MISSING_TRACKING_VERSION'
  | 'MISSING_CLIENT_REQUEST_ID'
  | 'INVALID_CREATE_UNIT'
  | 'INVALID_LINK_TARGET'
  | 'TRACKING_STATE_RESET'
  | 'TRACKING_CONTEXT_MISMATCH'
  | 'UNEXPECTED_PRE_DISPATCH_ERROR';

/** Internal diagnostics only. User-facing copy must remain translated and safe. */
export class TrackingPreDispatchError extends Error {
  constructor(
    readonly reason: TrackingFailureReason,
    cause?: unknown,
  ) {
    super(reason, { cause });
    this.name = 'TrackingPreDispatchError';
  }
}

type Contracts = Pick<
  typeof C,
  | 'SaveInventoryTrackingRequestSchema'
  | 'RemoveInventoryTrackingRequestSchema'
  | 'InventoryTrackingResponseSchema'
>;
export function assertTrackingContracts(
  contracts: Partial<Contracts> = C,
): asserts contracts is Contracts {
  for (const name of [
    'SaveInventoryTrackingRequestSchema',
    'RemoveInventoryTrackingRequestSchema',
    'InventoryTrackingResponseSchema',
  ] as const) {
    try {
      if (typeof contracts[name]?.parse !== 'function')
        throw new TypeError(`${name} is unavailable`);
    } catch (cause) {
      throw new TrackingPreDispatchError('TRACKING_CONTRACT_UNAVAILABLE', cause);
    }
  }
}

/** A submitted proposal, not a second cache of canonical server data. */
export interface TrackingDraft {
  readonly context: Readonly<InventoryContext>;
  readonly categoryId: string;
  readonly expectedVersion: number;
  readonly clientRequestId: string;
  readonly mode: 'CREATE' | 'LINK' | 'REMOVE' | 'UNCHANGED';
  readonly unit: string;
  readonly stockItemId: string | null;
}

export function captureTrackingDraft(draft: TrackingDraft): TrackingDraft {
  return Object.freeze({ ...draft, context: Object.freeze({ ...draft.context }) });
}

/** Pure construction from the saved identity and an immutable submitted proposal. */
export function buildTrackingCommand(
  draft: TrackingDraft,
  menuItemId: string,
  contracts: Partial<Contracts> = C,
) {
  const uuid = z.string().uuid();
  const check = (schema: z.ZodType, value: unknown, reason: TrackingFailureReason) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new TrackingPreDispatchError(reason, parsed.error);
  };
  check(uuid, menuItemId, 'MISSING_MENU_ITEM_ID');
  check(uuid, draft.context.outlet, 'MISSING_OUTLET_ID');
  check(uuid, draft.categoryId, 'MISSING_CATEGORY_ID');
  check(z.number().int().nonnegative(), draft.expectedVersion, 'MISSING_TRACKING_VERSION');
  check(uuid, draft.clientRequestId, 'MISSING_CLIENT_REQUEST_ID');
  if (draft.mode === 'UNCHANGED') return null;
  assertTrackingContracts(contracts);
  if (draft.mode === 'CREATE')
    check(z.enum(['UNIT', 'BOTTLE', 'CAN', 'PACK']), draft.unit, 'INVALID_CREATE_UNIT');
  if (draft.mode === 'LINK') check(uuid, draft.stockItemId, 'INVALID_LINK_TARGET');
  const common = {
    categoryId: draft.categoryId,
    expectedVersion: draft.expectedVersion,
    clientRequestId: draft.clientRequestId,
  };
  const command =
    draft.mode === 'REMOVE'
      ? contracts.RemoveInventoryTrackingRequestSchema.parse(common)
      : contracts.SaveInventoryTrackingRequestSchema.parse({
          ...common,
          mode: draft.mode,
          ...(draft.mode === 'CREATE' ? { unit: draft.unit } : { stockItemId: draft.stockItemId }),
        });
  return Object.freeze({
    menuItemId,
    context: Object.freeze({ ...draft.context }),
    categoryId: draft.categoryId,
    command: Object.freeze(command),
  });
}
