import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  AddSalesInvoiceLineRequestSchema,
  CreateSalesInvoiceRequestSchema,
  IssueSalesInvoiceRequestSchema,
  ListSalesInvoicesRequestSchema,
  RemoveSalesInvoiceLineRequestSchema,
  SalesInvoiceListResponseSchema,
  SalesInvoiceSchema,
  UpdateSalesInvoiceLineRequestSchema,
  UpdateSalesInvoiceRequestSchema,
  type AddSalesInvoiceLineRequest,
  type CreateSalesInvoiceRequest,
  type IssueSalesInvoiceRequest,
  type ListSalesInvoicesRequest,
  type SalesInvoice,
  type SalesInvoiceListResponse,
  type UpdateSalesInvoiceLineRequest,
  type UpdateSalesInvoiceRequest
} from '@liass-ohada/shared/sales';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';

import { environment } from '../../../../environments/environment';
import { userMessageFromResponse, type ApiMutationResult } from '../../../core/notifications/notification-message';

const InvoiceEnvelopeSchema = z.object({ data: SalesInvoiceSchema, message: z.unknown().optional() });
const InvoiceListEnvelopeSchema = z.object({ data: SalesInvoiceListResponseSchema, message: z.unknown().optional() });

@Injectable({ providedIn: 'root' })
export class SalesInvoicesApi {
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');
  private readonly http = inject(HttpClient);

  async list(options: ListSalesInvoicesRequest = { limit: 50 }): Promise<SalesInvoiceListResponse> {
    const request = ListSalesInvoicesRequestSchema.parse(options);
    let params = new HttpParams().set('limit', request.limit ?? 50);
    if (request.cursor) params = params.set('cursor', request.cursor);
    const response = await firstValueFrom(this.http.get<unknown>(this.invoicesUrl(), { params }));
    return InvoiceListEnvelopeSchema.parse(response).data;
  }

  async get(invoiceId: string): Promise<SalesInvoice> {
    const response = await firstValueFrom(this.http.get<unknown>(this.invoiceUrl(invoiceId)));
    return InvoiceEnvelopeSchema.parse(response).data;
  }

  async create(payload: CreateSalesInvoiceRequest = {}): Promise<ApiMutationResult<SalesInvoice>> {
    const response = await firstValueFrom(
      this.http.post<unknown>(this.invoicesUrl(), CreateSalesInvoiceRequestSchema.parse(payload))
    );
    return this.mutationResult(response);
  }

  async update(invoiceId: string, payload: UpdateSalesInvoiceRequest): Promise<ApiMutationResult<SalesInvoice>> {
    const response = await firstValueFrom(
      this.http.patch<unknown>(this.invoiceUrl(invoiceId), UpdateSalesInvoiceRequestSchema.parse(payload))
    );
    return this.mutationResult(response);
  }

  async addLine(invoiceId: string, payload: AddSalesInvoiceLineRequest): Promise<ApiMutationResult<SalesInvoice>> {
    const response = await firstValueFrom(
      this.http.post<unknown>(this.linesUrl(invoiceId), AddSalesInvoiceLineRequestSchema.parse(payload))
    );
    return this.mutationResult(response);
  }

  async updateLine(invoiceId: string, lineId: string, payload: UpdateSalesInvoiceLineRequest): Promise<ApiMutationResult<SalesInvoice>> {
    const response = await firstValueFrom(
      this.http.patch<unknown>(this.lineUrl(invoiceId, lineId), UpdateSalesInvoiceLineRequestSchema.parse(payload))
    );
    return this.mutationResult(response);
  }

  async removeLine(invoiceId: string, lineId: string, expectedVersion: number): Promise<ApiMutationResult<SalesInvoice>> {
    const request = RemoveSalesInvoiceLineRequestSchema.parse({ expectedVersion });
    const params = new HttpParams().set('expectedVersion', request.expectedVersion);
    const response = await firstValueFrom(
      this.http.delete<unknown>(this.lineUrl(invoiceId, lineId), { params })
    );
    return this.mutationResult(response);
  }

  async issueInvoice(invoiceId: string, payload: IssueSalesInvoiceRequest): Promise<ApiMutationResult<SalesInvoice>> {
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.invoiceUrl(invoiceId)}/issue`, IssueSalesInvoiceRequestSchema.parse(payload))
    );
    return this.mutationResult(response);
  }

  private mutationResult(response: unknown): ApiMutationResult<SalesInvoice> {
    const parsed = InvoiceEnvelopeSchema.parse(response);
    return { data: parsed.data, message: userMessageFromResponse(response) };
  }

  private invoicesUrl(): string { return `${this.apiBaseUrl}/sales/invoices`; }
  private invoiceUrl(invoiceId: string): string { return `${this.invoicesUrl()}/${encodeURIComponent(invoiceId)}`; }
  private linesUrl(invoiceId: string): string { return `${this.invoiceUrl(invoiceId)}/lines`; }
  private lineUrl(invoiceId: string, lineId: string): string { return `${this.linesUrl(invoiceId)}/${encodeURIComponent(lineId)}`; }
}
