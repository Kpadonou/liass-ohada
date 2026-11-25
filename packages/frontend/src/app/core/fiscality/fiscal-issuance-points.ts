import { Injectable, inject } from '@angular/core';
import { RestaurantsApi } from '../../domains/restaurants/data-access/restaurants.api';
/** Product adapters expose names and canonical IDs; policy contracts remain product-neutral. */
export interface FiscalIssuancePoint { id: string; name: string; }
@Injectable({ providedIn: 'root' })
export class FiscalIssuancePoints {
  private readonly restaurants = inject(RestaurantsApi);
  async list(org: string, cursor?: string): Promise<{ items: FiscalIssuancePoint[]; nextCursor?: string }> {
    const page = await this.restaurants.list(org, 'outlet', {}, cursor);
    return { items: page.items.map(point => ({ id: point.id, name: point.name })), nextCursor: page.nextCursor };
  }
}
