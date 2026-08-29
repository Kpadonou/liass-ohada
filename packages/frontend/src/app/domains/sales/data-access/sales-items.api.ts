import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  CreateSalesCatalogItemRequestSchema,
  ListSalesCatalogItemsRequestSchema,
  SalesCatalogItemLifecycleRequestSchema,
  SalesCatalogItemListResponseSchema,
  SalesCatalogItemSchema,
  UpdateSalesCatalogItemRequestSchema,
  type CreateSalesCatalogItemRequest,
  type ListSalesCatalogItemsRequest,
  type SalesCatalogItem,
  type SalesCatalogItemListResponse,
  type UpdateSalesCatalogItemRequest
} from '@liass-ohada/shared/sales';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';

import { environment } from '../../../../environments/environment';
import { userMessageFromResponse, type ApiMutationResult } from '../../../core/notifications/notification-message';

const ItemResponseSchema = z.object({ data: SalesCatalogItemSchema, message: z.unknown().optional() });
const ItemListEnvelopeSchema = z.object({ data: SalesCatalogItemListResponseSchema, message: z.unknown().optional() });

@Injectable({ providedIn: 'root' })
export class SalesItemsApi {
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');
  private readonly http = inject(HttpClient);

  async list(options: ListSalesCatalogItemsRequest = { limit: 50 }): Promise<SalesCatalogItemListResponse> {
    const request = ListSalesCatalogItemsRequestSchema.parse(options);
    let params = new HttpParams().set('limit', request.limit ?? 50);
    if (request.cursor) params = params.set('cursor', request.cursor);
    const response = await firstValueFrom(this.http.get<unknown>(this.itemsUrl(), { params }));
    return ItemListEnvelopeSchema.parse(response).data;
  }

  async get(itemId: string): Promise<SalesCatalogItem> {
    const response = await firstValueFrom(this.http.get<unknown>(this.itemUrl(itemId)));
    return ItemResponseSchema.parse(response).data;
  }

  async create(payload: CreateSalesCatalogItemRequest): Promise<ApiMutationResult<SalesCatalogItem>> {
    const request = CreateSalesCatalogItemRequestSchema.parse(payload);
    const response = await firstValueFrom(this.http.post<unknown>(this.itemsUrl(), request));
    return this.mutationResult(response);
  }

  async update(itemId: string, payload: UpdateSalesCatalogItemRequest): Promise<ApiMutationResult<SalesCatalogItem>> {
    const request = UpdateSalesCatalogItemRequestSchema.parse(payload);
    const response = await firstValueFrom(this.http.patch<unknown>(this.itemUrl(itemId), request));
    return this.mutationResult(response);
  }

  async activate(itemId: string, expectedVersion: number): Promise<ApiMutationResult<SalesCatalogItem>> {
    return this.changeStatus(itemId, expectedVersion, 'activate');
  }

  async deactivate(itemId: string, expectedVersion: number): Promise<ApiMutationResult<SalesCatalogItem>> {
    return this.changeStatus(itemId, expectedVersion, 'deactivate');
  }

  private async changeStatus(itemId: string, expectedVersion: number, action: 'activate' | 'deactivate'): Promise<ApiMutationResult<SalesCatalogItem>> {
    const request = SalesCatalogItemLifecycleRequestSchema.parse({ itemId, expectedVersion });
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.itemUrl(request.itemId)}/${action}`, { expectedVersion: request.expectedVersion })
    );
    return this.mutationResult(response);
  }

  private mutationResult(response: unknown): ApiMutationResult<SalesCatalogItem> {
    const parsed = ItemResponseSchema.parse(response);
    return { data: parsed.data, message: userMessageFromResponse(response) };
  }

  private itemsUrl(): string { return `${this.apiBaseUrl}/sales/items`; }
  private itemUrl(itemId: string): string { return `${this.itemsUrl()}/${encodeURIComponent(itemId)}`; }
}
