import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import * as c from '@liass-ohada/shared/restaurants';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AuthStore } from '../../identity/data-access/auth.store';
import {
  userMessageFromResponse,
  ApiMutationResult,
} from '../../../core/notifications/notification-message';
import {
  createRequests,
  updateRequests,
  entityResponses,
  listResponses,
  restaurantPath,
  RestaurantKind,
  RestaurantListKind,
  RestaurantEntities,
  RestaurantContext,
} from './restaurants-model';

@Injectable({ providedIn: 'root' })
export class RestaurantsApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthStore);
  private readonly base = environment.apiBaseUrl.replace(/\/$/, '');
  private assertScope(scope: string) {
    if (!scope || this.auth.effectiveOrgId() !== scope)
      throw new HttpErrorResponse({ status: 409, error: { error: { code: 'WORKSPACE_CHANGED' } } });
  }
  async get<K extends RestaurantKind>(
    scope: string,
    kind: K,
    context: RestaurantContext = {},
    id?: string,
  ): Promise<RestaurantEntities[K] | null> {
    this.assertScope(scope);
    try {
      const response = await firstValueFrom(
        this.http.get<unknown>(this.base + restaurantPath(kind, context, id)),
      );
      return entityResponses[kind].parse(response).data as RestaurantEntities[K];
    } catch (error) {
      if (
        (kind === 'restaurant' || kind === 'menu') &&
        error instanceof HttpErrorResponse &&
        error.status === 404 &&
        error.error?.error?.code === 'RESTAURANTS_NOT_FOUND'
      )
        return null;
      throw error;
    }
  }
  async list<K extends RestaurantListKind>(
    scope: string,
    kind: K,
    context: RestaurantContext,
    cursor?: string,
  ): Promise<{ items: RestaurantEntities[K][]; nextCursor?: string }> {
    this.assertScope(scope);
    const input = c.RestaurantsListRequestSchema.parse({ limit: 50, cursor });
    let params = new HttpParams().set('limit', input.limit);
    if (input.cursor) params = params.set('cursor', input.cursor);
    const response = await firstValueFrom(
      this.http.get<unknown>(this.base + restaurantPath(kind, context), { params }),
    );
    return listResponses[kind].parse(response) as {
      items: RestaurantEntities[K][];
      nextCursor?: string;
    };
  }
  async save<K extends RestaurantKind>(
    scope: string,
    kind: K,
    context: RestaurantContext,
    input: unknown,
    id?: string,
  ): Promise<ApiMutationResult<RestaurantEntities[K]>> {
    this.assertScope(scope);
    const update = id !== undefined;
    const request = (update ? updateRequests[kind] : createRequests[kind]).parse(input);
    const url =
      this.base +
      restaurantPath(
        kind,
        context,
        update && !['restaurant', 'menu'].includes(kind) ? id : undefined,
      );
    const response = await firstValueFrom(
      update ? this.http.patch<unknown>(url, request) : this.http.post<unknown>(url, request),
    );
    return {
      data: entityResponses[kind].parse(response).data as RestaurantEntities[K],
      message: userMessageFromResponse(response),
    };
  }
  async deactivate<K extends RestaurantListKind>(
    scope: string,
    kind: K,
    context: RestaurantContext,
    id: string,
    version: number,
  ) {
    this.assertScope(scope);
    const request = c.RestaurantsLifecycleRequestSchema.parse({ expectedVersion: version });
    const response = await firstValueFrom(
      this.http.post<unknown>(
        this.base + restaurantPath(kind, context, id) + '/deactivate',
        request,
      ),
    );
    return {
      data: entityResponses[kind].parse(response).data as RestaurantEntities[K],
      message: userMessageFromResponse(response),
    };
  }
  async availability(
    scope: string,
    context: RestaurantContext,
    id: string,
    version: number,
    availability: c.MenuItemAvailability,
  ) {
    this.assertScope(scope);
    const request = c.ChangeMenuItemAvailabilityRequestSchema.parse({
      expectedVersion: version,
      availability,
    });
    const response = await firstValueFrom(
      this.http.post<unknown>(
        this.base + restaurantPath('item', context, id) + '/availability',
        request,
      ),
    );
    return {
      data: c.MenuItemResponseSchema.parse(response).data,
      message: userMessageFromResponse(response),
    };
  }
  async qr(scope: string, context: RestaurantContext, id: string) {
    this.assertScope(scope);
    return c.RestaurantTableQrResponseSchema.parse(
      await firstValueFrom(
        this.http.get<unknown>(this.base + restaurantPath('table', context, id) + '/qr'),
      ),
    );
  }
}
