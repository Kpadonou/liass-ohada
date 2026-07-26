import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  CreateAccountingWorkRequestSchema,
  CreateCabinetDeadlineRequestSchema,
  GetAccountingWorkResponseSchema,
  GetCabinetDeadlineResponseSchema,
  ListAccountingWorksRequestSchema,
  ListAccountingWorksResponseSchema,
  ListCabinetDeadlinesRequestSchema,
  ListCabinetDeadlinesResponseSchema,
  UpdateAccountingWorkRequestSchema,
  UpdateAccountingWorkStatusRequestSchema,
  UpdateCabinetDeadlineRequestSchema,
  UpdateCabinetDeadlineStatusRequestSchema,
  type AccountingWork,
  type CabinetDeadline,
  type CreateAccountingWorkRequest,
  type CreateCabinetDeadlineRequest,
  type ListAccountingWorksRequest,
  type ListAccountingWorksResponse,
  type ListCabinetDeadlinesRequest,
  type ListCabinetDeadlinesResponse,
  type UpdateAccountingWorkRequest,
  type UpdateAccountingWorkStatusRequest,
  type UpdateCabinetDeadlineRequest,
  type UpdateCabinetDeadlineStatusRequest
} from '@liass-ohada/shared/shared';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { TENANT_REQUEST_SCOPE } from '../../../core/http/tenant-request-context';

const cabinetContext = () => new HttpContext().set(TENANT_REQUEST_SCOPE, 'CABINET');

function requestParams(input: Record<string, unknown>): HttpParams {
  let params = new HttpParams();

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== '') {
      params = params.set(key, String(value));
    }
  }

  return params;
}

@Injectable({ providedIn: 'root' })
export class CabinetOperationsApi {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  async listWorks(input: ListAccountingWorksRequest): Promise<ListAccountingWorksResponse> {
    const request = ListAccountingWorksRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/cabinet/works`, {
        context: cabinetContext(),
        params: requestParams(request)
      })
    );
    return ListAccountingWorksResponseSchema.parse(response);
  }

  async getWork(workId: string): Promise<AccountingWork> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/cabinet/works/${encodeURIComponent(workId)}`, {
        context: cabinetContext()
      })
    );
    return GetAccountingWorkResponseSchema.parse(response).work;
  }

  async createWork(input: CreateAccountingWorkRequest): Promise<AccountingWork> {
    const request = CreateAccountingWorkRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/cabinet/works`, request, {
        context: cabinetContext()
      })
    );
    return GetAccountingWorkResponseSchema.parse(response).work;
  }

  async updateWork(input: UpdateAccountingWorkRequest): Promise<AccountingWork> {
    const request = UpdateAccountingWorkRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http.patch<unknown>(
        `${this.apiBaseUrl}/cabinet/works/${encodeURIComponent(request.workId)}`,
        request,
        { context: cabinetContext() }
      )
    );
    return GetAccountingWorkResponseSchema.parse(response).work;
  }

  async updateWorkStatus(input: UpdateAccountingWorkStatusRequest): Promise<AccountingWork> {
    const request = UpdateAccountingWorkStatusRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http.patch<unknown>(
        `${this.apiBaseUrl}/cabinet/works/${encodeURIComponent(request.workId)}/status`,
        request,
        { context: cabinetContext() }
      )
    );
    return GetAccountingWorkResponseSchema.parse(response).work;
  }

  async listDeadlines(input: ListCabinetDeadlinesRequest): Promise<ListCabinetDeadlinesResponse> {
    const request = ListCabinetDeadlinesRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/cabinet/deadlines`, {
        context: cabinetContext(),
        params: requestParams(request)
      })
    );
    return ListCabinetDeadlinesResponseSchema.parse(response);
  }

  async getDeadline(deadlineId: string): Promise<CabinetDeadline> {
    const response = await firstValueFrom(
      this.http.get<unknown>(
        `${this.apiBaseUrl}/cabinet/deadlines/${encodeURIComponent(deadlineId)}`,
        { context: cabinetContext() }
      )
    );
    return GetCabinetDeadlineResponseSchema.parse(response).deadline;
  }

  async createDeadline(input: CreateCabinetDeadlineRequest): Promise<CabinetDeadline> {
    const request = CreateCabinetDeadlineRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/cabinet/deadlines`, request, {
        context: cabinetContext()
      })
    );
    return GetCabinetDeadlineResponseSchema.parse(response).deadline;
  }

  async updateDeadline(input: UpdateCabinetDeadlineRequest): Promise<CabinetDeadline> {
    const request = UpdateCabinetDeadlineRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http.patch<unknown>(
        `${this.apiBaseUrl}/cabinet/deadlines/${encodeURIComponent(request.deadlineId)}`,
        request,
        { context: cabinetContext() }
      )
    );
    return GetCabinetDeadlineResponseSchema.parse(response).deadline;
  }

  async updateDeadlineStatus(input: UpdateCabinetDeadlineStatusRequest): Promise<CabinetDeadline> {
    const request = UpdateCabinetDeadlineStatusRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http.patch<unknown>(
        `${this.apiBaseUrl}/cabinet/deadlines/${encodeURIComponent(request.deadlineId)}/status`,
        request,
        { context: cabinetContext() }
      )
    );
    return GetCabinetDeadlineResponseSchema.parse(response).deadline;
  }
}
