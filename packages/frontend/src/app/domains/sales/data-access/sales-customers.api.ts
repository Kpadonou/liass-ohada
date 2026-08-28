import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  CreateSalesCustomerRequestSchema,
  ListSalesCustomersRequestSchema,
  SalesCustomerListResponseSchema,
  SalesCustomerLifecycleRequestSchema,
  SalesCustomerSchema,
  UpdateSalesCustomerRequestSchema,
  type CreateSalesCustomerRequest,
  type ListSalesCustomersRequest,
  type SalesCustomer,
  type SalesCustomerListResponse,
  type UpdateSalesCustomerRequest
} from '@liass-ohada/shared/sales';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';

import { environment } from '../../../../environments/environment';
import { userMessageFromResponse, type ApiMutationResult } from '../../../core/notifications/notification-message';

const CustomerResponseSchema = z.object({ data: SalesCustomerSchema, message: z.unknown().optional() });
const CustomerListEnvelopeSchema = z.object({ data: SalesCustomerListResponseSchema, message: z.unknown().optional() });

@Injectable({ providedIn: 'root' })
export class SalesCustomersApi {
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');
  private readonly http = inject(HttpClient);

  async list(options: ListSalesCustomersRequest = { limit: 50 }): Promise<SalesCustomerListResponse> {
    const request = ListSalesCustomersRequestSchema.parse(options);
    let params = new HttpParams().set('limit', request.limit ?? 50);
    if (request.cursor) params = params.set('cursor', request.cursor);
    const response = await firstValueFrom(this.http.get<unknown>(this.customersUrl(), { params }));
    return CustomerListEnvelopeSchema.parse(response).data;
  }

  async get(customerId: string): Promise<SalesCustomer> {
    const response = await firstValueFrom(this.http.get<unknown>(this.customerUrl(customerId)));
    return CustomerResponseSchema.parse(response).data;
  }

  async create(payload: CreateSalesCustomerRequest): Promise<ApiMutationResult<SalesCustomer>> {
    const request = CreateSalesCustomerRequestSchema.parse(payload);
    const response = await firstValueFrom(this.http.post<unknown>(this.customersUrl(), request));
    return this.mutationResult(response);
  }

  async update(customerId: string, payload: UpdateSalesCustomerRequest): Promise<ApiMutationResult<SalesCustomer>> {
    const request = UpdateSalesCustomerRequestSchema.parse(payload);
    const response = await firstValueFrom(this.http.patch<unknown>(this.customerUrl(customerId), request));
    return this.mutationResult(response);
  }

  async activate(customerId: string, expectedVersion: number): Promise<ApiMutationResult<SalesCustomer>> {
    return this.changeStatus(customerId, expectedVersion, 'activate');
  }

  async deactivate(customerId: string, expectedVersion: number): Promise<ApiMutationResult<SalesCustomer>> {
    return this.changeStatus(customerId, expectedVersion, 'deactivate');
  }

  private async changeStatus(customerId: string, expectedVersion: number, action: 'activate' | 'deactivate'): Promise<ApiMutationResult<SalesCustomer>> {
    const request = SalesCustomerLifecycleRequestSchema.parse({ customerId, expectedVersion });
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.customerUrl(request.customerId)}/${action}`, { expectedVersion: request.expectedVersion })
    );
    return this.mutationResult(response);
  }

  private mutationResult(response: unknown): ApiMutationResult<SalesCustomer> {
    const parsed = CustomerResponseSchema.parse(response);
    return { data: parsed.data, message: userMessageFromResponse(response) };
  }

  private customersUrl(): string { return `${this.apiBaseUrl}/sales/customers`; }
  private customerUrl(customerId: string): string { return `${this.customersUrl()}/${encodeURIComponent(customerId)}`; }
}
