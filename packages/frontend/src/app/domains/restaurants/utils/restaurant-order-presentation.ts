import type { RestaurantOrder } from '@liass-ohada/shared/restaurants';

/** Presentation only. Raw pages/counts remain the physical completeness authority. */
export const businessOrderVisible = (order: RestaurantOrder) =>
  order.resolutionKind !== 'TECHNICAL_EMPTY_DRAFT';
