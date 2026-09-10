import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  ListSalesPaymentsRequestSchema,
  RecordSalesPaymentRequestSchema,
  RecordSalesPaymentResponseSchema,
  SalesInvoiceReceivableSchema,
  SalesPaymentListResponseSchema,
  type ListSalesPaymentsRequest,
  type RecordSalesPaymentRequest,
  type RecordSalesPaymentResponse,
  type SalesInvoiceReceivable,
  type SalesPaymentListResponse
} from '@liass-ohada/shared/sales';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';

import { environment } from '../../../../environments/environment';
import { userMessageFromResponse, type ApiMutationResult } from '../../../core/notifications/notification-message';

const ReceivableEnvelopeSchema = z.object({ data: SalesInvoiceReceivableSchema, message: z.unknown().optional() });
const PaymentListEnvelopeSchema = z.object({ data: SalesPaymentListResponseSchema, message: z.unknown().optional() });
const RecordPaymentEnvelopeSchema = z.object({ data: RecordSalesPaymentResponseSchema, message: z.unknown().optional() });

@Injectable({ providedIn: 'root' })
export class SalesPaymentsApi {
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');
  private readonly http = inject(HttpClient);

  async getReceivable(invoiceId: string): Promise<SalesInvoiceReceivable> {
    const response = await firstValueFrom(this.http.get<unknown>(this.receivableUrl(invoiceId)));
    return ReceivableEnvelopeSchema.parse(response).data;
  }

  async listPayments(
    invoiceId: string,
    options: ListSalesPaymentsRequest = { limit: 50 }
  ): Promise<SalesPaymentListResponse> {
    const request = ListSalesPaymentsRequestSchema.parse(options);
    let params = new HttpParams().set('limit', request.limit ?? 50);
    if (request.cursor) params = params.set('cursor', request.cursor);
    const response = await firstValueFrom(this.http.get<unknown>(this.paymentsUrl(invoiceId), { params }));
    return PaymentListEnvelopeSchema.parse(response).data;
  }

  async recordPayment(
    invoiceId: string,
    payload: RecordSalesPaymentRequest
  ): Promise<ApiMutationResult<RecordSalesPaymentResponse>> {
    const request = RecordSalesPaymentRequestSchema.parse(payload);
    const response = await firstValueFrom(this.http.post<unknown>(this.paymentsUrl(invoiceId), request));
    const parsed = RecordPaymentEnvelopeSchema.parse(response);
    return { data: parsed.data, message: userMessageFromResponse(response) };
  }

  private invoiceUrl(invoiceId: string): string {
    return `${this.apiBaseUrl}/sales/invoices/${encodeURIComponent(invoiceId)}`;
  }

  private receivableUrl(invoiceId: string): string { return `${this.invoiceUrl(invoiceId)}/receivable`; }
  private paymentsUrl(invoiceId: string): string { return `${this.invoiceUrl(invoiceId)}/payments`; }
}
