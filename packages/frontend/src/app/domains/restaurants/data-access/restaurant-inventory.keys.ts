import type { InventoryContext } from './restaurant-inventory.api';

const outlet = (ctx: InventoryContext) =>
  ['restaurants', ctx.org, 'outlet', ctx.outlet, 'inventory'] as const;
const actor = (ctx: InventoryContext) => ({ user: ctx.user, revision: ctx.revision });
const family = (ctx: InventoryContext) => [...outlet(ctx), actor(ctx)] as const;
const root = (ctx: InventoryContext) =>
  [...outlet(ctx), { ...actor(ctx), identity: ctx.identity }] as const;
/** Partial object scopes deliberately match equivalent configuration/operational representations. */
export const inventoryKeys = {
  root,
  itemsFamily: (ctx: InventoryContext) => [...family(ctx), 'items', 'list'] as const,
  itemFamily: (ctx: InventoryContext, id: string) =>
    [...family(ctx), 'items', 'detail', id] as const,
  historyFamily: (ctx: InventoryContext, id: string) =>
    [...family(ctx), 'movements', 'list', id] as const,
  trackingFamily: (ctx: InventoryContext) => [...family(ctx), 'tracking', 'detail'] as const,
  items: (ctx: InventoryContext) => [...root(ctx), 'items', 'list'] as const,
  item: (ctx: InventoryContext, id: string) => [...root(ctx), 'items', 'detail', id] as const,
  history: (ctx: InventoryContext, id: string) => [...root(ctx), 'movements', 'list', id] as const,
  tracking: (ctx: InventoryContext, category: string, menuItem: string) =>
    [...root(ctx), 'tracking', 'detail', category, menuItem] as const,
};
