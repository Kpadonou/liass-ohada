import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  AddSalesCreditNoteLineRequestSchema,
  CreateSalesCreditNoteRequestSchema,
  IssueSalesCreditNoteRequestSchema,
  IssueSalesCreditNoteResponseSchema,
  ListSalesCreditNotesRequestSchema,
  RemoveSalesCreditNoteLineRequestSchema,
  SalesCreditNoteListResponseSchema,
  SalesCreditNoteDocumentResponseSchema,
  SalesCreditNoteDownloadUrlResponseSchema,
  SalesCreditNoteSchema,
  UpdateSalesCreditNoteLineRequestSchema,
  UpdateSalesCreditNoteRequestSchema,
  type AddSalesCreditNoteLineRequest,
  type CreateSalesCreditNoteRequest,
  type IssueSalesCreditNoteRequest,
  type IssueSalesCreditNoteResponse,
  type SalesCreditNote,
  type SalesCreditNoteDocument,
  type SalesCreditNoteDownloadUrl,
  type SalesCreditNoteListResponse,
  type UpdateSalesCreditNoteLineRequest,
  type UpdateSalesCreditNoteRequest
} from '@liass-ohada/shared/sales';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';

import { environment } from '../../../../environments/environment';
import { userMessageFromResponse, type ApiMutationResult } from '../../../core/notifications/notification-message';

const CreditNoteEnvelopeSchema = z.object({ data: SalesCreditNoteSchema, message: z.unknown().optional() });
const CreditNoteListEnvelopeSchema = z.object({ data: SalesCreditNoteListResponseSchema, message: z.unknown().optional() });
const IssueEnvelopeSchema = z.object({ data: IssueSalesCreditNoteResponseSchema, message: z.unknown().optional() });
type ListSalesCreditNotesRequest = z.input<typeof ListSalesCreditNotesRequestSchema>;

@Injectable({ providedIn: 'root' })
export class SalesCreditNotesApi {
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');
  private readonly http = inject(HttpClient);

  async list(invoiceId: string, options: ListSalesCreditNotesRequest = { limit: 50 }): Promise<SalesCreditNoteListResponse> {
    const request = ListSalesCreditNotesRequestSchema.parse(options);
    let params = new HttpParams().set('limit', request.limit ?? 50);
    if (request.cursor) params = params.set('cursor', request.cursor);
    const response = await firstValueFrom(this.http.get<unknown>(this.collectionUrl(invoiceId), { params }));
    return CreditNoteListEnvelopeSchema.parse(response).data;
  }

  async get(invoiceId: string, creditNoteId: string): Promise<SalesCreditNote> {
    const response = await firstValueFrom(this.http.get<unknown>(this.detailUrl(invoiceId, creditNoteId)));
    return CreditNoteEnvelopeSchema.parse(response).data;
  }

  async create(invoiceId: string, payload: CreateSalesCreditNoteRequest = {}): Promise<ApiMutationResult<SalesCreditNote>> {
    const response = await firstValueFrom(
      this.http.post<unknown>(this.collectionUrl(invoiceId), CreateSalesCreditNoteRequestSchema.parse(payload))
    );
    return this.noteResult(response);
  }

  async update(invoiceId: string, creditNoteId: string, payload: UpdateSalesCreditNoteRequest): Promise<ApiMutationResult<SalesCreditNote>> {
    const response = await firstValueFrom(
      this.http.patch<unknown>(this.detailUrl(invoiceId, creditNoteId), UpdateSalesCreditNoteRequestSchema.parse(payload))
    );
    return this.noteResult(response);
  }

  async addLine(invoiceId: string, creditNoteId: string, payload: AddSalesCreditNoteLineRequest): Promise<ApiMutationResult<SalesCreditNote>> {
    const response = await firstValueFrom(
      this.http.post<unknown>(this.linesUrl(invoiceId, creditNoteId), AddSalesCreditNoteLineRequestSchema.parse(payload))
    );
    return this.noteResult(response);
  }

  async updateLine(invoiceId: string, creditNoteId: string, lineId: string, payload: UpdateSalesCreditNoteLineRequest): Promise<ApiMutationResult<SalesCreditNote>> {
    const response = await firstValueFrom(
      this.http.patch<unknown>(this.lineUrl(invoiceId, creditNoteId, lineId), UpdateSalesCreditNoteLineRequestSchema.parse(payload))
    );
    return this.noteResult(response);
  }

  async removeLine(invoiceId: string, creditNoteId: string, lineId: string, expectedVersion: number): Promise<ApiMutationResult<SalesCreditNote>> {
    const request = RemoveSalesCreditNoteLineRequestSchema.parse({ expectedVersion });
    const params = new HttpParams().set('expectedVersion', request.expectedVersion);
    const response = await firstValueFrom(
      this.http.delete<unknown>(this.lineUrl(invoiceId, creditNoteId, lineId), { params })
    );
    return this.noteResult(response);
  }

  async issue(invoiceId: string, creditNoteId: string, payload: IssueSalesCreditNoteRequest): Promise<ApiMutationResult<IssueSalesCreditNoteResponse>> {
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.detailUrl(invoiceId, creditNoteId)}/issue`, IssueSalesCreditNoteRequestSchema.parse(payload))
    );
    const parsed = IssueEnvelopeSchema.parse(response);
    return { data: parsed.data, message: userMessageFromResponse(response) };
  }

  async getDocument(invoiceId: string, creditNoteId: string): Promise<SalesCreditNoteDocument> {
    const response = await firstValueFrom(this.http.get<unknown>(this.documentUrl(invoiceId, creditNoteId)));
    return SalesCreditNoteDocumentResponseSchema.parse(response).data;
  }

  async generateDocument(invoiceId: string, creditNoteId: string): Promise<ApiMutationResult<SalesCreditNoteDocument>> {
    const response = await firstValueFrom(
      this.http.post<unknown>(this.documentUrl(invoiceId, creditNoteId), {})
    );
    const parsed = SalesCreditNoteDocumentResponseSchema.parse(response);
    return { data: parsed.data, message: userMessageFromResponse(response) };
  }

  async createDocumentDownloadUrl(invoiceId: string, creditNoteId: string): Promise<SalesCreditNoteDownloadUrl> {
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.documentUrl(invoiceId, creditNoteId)}/download-url`, {})
    );
    return SalesCreditNoteDownloadUrlResponseSchema.parse(response).data;
  }

  private noteResult(response: unknown): ApiMutationResult<SalesCreditNote> {
    const parsed = CreditNoteEnvelopeSchema.parse(response);
    return { data: parsed.data, message: userMessageFromResponse(response) };
  }

  private collectionUrl(invoiceId: string): string {
    return `${this.apiBaseUrl}/sales/invoices/${encodeURIComponent(invoiceId)}/credit-notes`;
  }
  private detailUrl(invoiceId: string, creditNoteId: string): string {
    return `${this.collectionUrl(invoiceId)}/${encodeURIComponent(creditNoteId)}`;
  }
  private linesUrl(invoiceId: string, creditNoteId: string): string {
    return `${this.detailUrl(invoiceId, creditNoteId)}/lines`;
  }
  private lineUrl(invoiceId: string, creditNoteId: string, lineId: string): string {
    return `${this.linesUrl(invoiceId, creditNoteId)}/${encodeURIComponent(lineId)}`;
  }
  private documentUrl(invoiceId: string, creditNoteId: string): string {
    return `${this.detailUrl(invoiceId, creditNoteId)}/documents/pdf`;
  }
}
