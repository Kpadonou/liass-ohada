import * as C from '@liass-ohada/shared/restaurants';
import config from '../../../../../angular.json';
import { inventoryContext } from '../data-access/inventory.test-fixture';
import { rid } from '../data-access/restaurants.test-fixture';
import {
  buildTrackingCommand,
  captureTrackingDraft,
  TrackingDraft,
  TrackingPreDispatchError,
} from './inventory-tracking-command';

const draft = (): TrackingDraft =>
  captureTrackingDraft({
    context: inventoryContext,
    categoryId: rid(6),
    expectedVersion: 0,
    clientRequestId: rid(90),
    mode: 'CREATE',
    unit: 'BOTTLE',
    stockItemId: null,
  });

it('keeps the changing workspace Restaurants contracts out of the persistent dev-server dependency prebundle', () => {
  expect(
    config.projects.frontend.architect.serve.configurations.development.prebundle.exclude,
  ).toContain('@liass-ohada/shared/restaurants');
});
it('reproduces the stale namespace missing tracking exports and diagnoses it before HTTP construction', () => {
  // The inspected Vite module exported Inventory item schemas but none of the tracking schemas.
  const stale = {
    ...C,
    SaveInventoryTrackingRequestSchema: undefined,
    RemoveInventoryTrackingRequestSchema: undefined,
    InventoryTrackingResponseSchema: undefined,
  };
  expect(stale.StockItemsResponseSchema).toBeDefined();
  try {
    buildTrackingCommand(draft(), rid(8), stale);
    expect.fail('An obsolete runtime contract must not be used');
  } catch (error) {
    expect(error).toBeInstanceOf(TrackingPreDispatchError);
    expect(error).toMatchObject({
      reason: 'TRACKING_CONTRACT_UNAVAILABLE',
      cause: expect.any(TypeError),
    });
  }
});
it('constructs a frozen CREATE command from explicit identifiers with BOTTLE and no initial balance', () => {
  const original = { ...draft(), context: { ...inventoryContext } };
  const captured = captureTrackingDraft(original);
  original.context.outlet = '';
  original.categoryId = '';
  original.unit = 'KG';
  const result = buildTrackingCommand(captured, rid(8))!;
  expect(result.context.outlet).toBe(inventoryContext.outlet);
  expect(result.command).toEqual({
    categoryId: rid(6),
    expectedVersion: 0,
    clientRequestId: rid(90),
    mode: 'CREATE',
    unit: 'BOTTLE',
  });
  expect(Object.isFrozen(result.command)).toBe(true);
  expect(Object.isFrozen(captured.context)).toBe(true);
});
it('uses the same pure path for LINK and REMOVE', () => {
  expect(
    buildTrackingCommand({ ...draft(), mode: 'LINK', stockItemId: rid(80) }, rid(8))!.command,
  ).toEqual({
    categoryId: rid(6),
    expectedVersion: 0,
    clientRequestId: rid(90),
    mode: 'LINK',
    stockItemId: rid(80),
  });
  expect(
    buildTrackingCommand({ ...draft(), mode: 'REMOVE', expectedVersion: 2 }, rid(8))!.command,
  ).toEqual({ categoryId: rid(6), expectedVersion: 2, clientRequestId: rid(90) });
});
it.each([
  ['categoryId', '', 'MISSING_CATEGORY_ID'],
  ['expectedVersion', undefined, 'MISSING_TRACKING_VERSION'],
  ['clientRequestId', '', 'MISSING_CLIENT_REQUEST_ID'],
  ['unit', 'KG', 'INVALID_CREATE_UNIT'],
] as const)(
  'classifies invalid %s without leaking details into UI copy',
  (field, value, reason) => {
    expect(() =>
      buildTrackingCommand({ ...draft(), [field]: value } as TrackingDraft, rid(8)),
    ).toThrow(expect.objectContaining({ reason }));
  },
);
it('classifies missing MenuItem/outlet IDs and invalid LINK targets', () => {
  expect(() => buildTrackingCommand(draft(), '')).toThrow(
    expect.objectContaining({ reason: 'MISSING_MENU_ITEM_ID' }),
  );
  expect(() =>
    buildTrackingCommand({ ...draft(), context: { ...inventoryContext, outlet: '' } }, rid(8)),
  ).toThrow(expect.objectContaining({ reason: 'MISSING_OUTLET_ID' }));
  expect(() =>
    buildTrackingCommand({ ...draft(), mode: 'LINK', stockItemId: null }, rid(8)),
  ).toThrow(expect.objectContaining({ reason: 'INVALID_LINK_TARGET' }));
});
