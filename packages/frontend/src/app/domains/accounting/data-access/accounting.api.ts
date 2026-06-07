import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  AccountResponseSchema,
  CreateAccountRequestSchema,
  CreateEntryRequestSchema,
  CreateJournalRequestSchema,
  GeneralLedgerResponseSchema,
  JournalResponseSchema,
  ListAccountsResponseSchema,
  ListEntriesResponseSchema,
  ListJournalsResponseSchema,
  PostEntryResponseSchema,
  TrialBalanceResponseSchema,
  type AccountDto,
  type CreateAccountRequest,
  type CreateEntryRequest,
  type CreateJournalRequest,
  type EntrySummaryDto,
  type GeneralLedgerDto,
  type JournalDto,
  type TrialBalanceDto
} from '@liass-ohada/shared/accounting';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';

export interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface ListEntriesParams {
  year: string;
  journalCode?: string;
  month?: string;
  limit?: number;
  cursor?: string;
}

@Injectable({ providedIn: 'root' })
export class AccountingApi {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  async listAccounts(options: { limit?: number; cursor?: string } = {}): Promise<PaginatedResult<AccountDto>> {
    let params = new HttpParams();

    if (options.limit) {
      params = params.set('limit', options.limit);
    }

    if (options.cursor) {
      params = params.set('cursor', options.cursor);
    }

    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/accounts`, { params })
    );
    const parsed = ListAccountsResponseSchema.parse(response);

    return {
      items: parsed.data.accounts,
      nextCursor: parsed.data.nextCursor,
      hasMore: parsed.data.hasMore
    };
  }

  async createAccount(payload: CreateAccountRequest): Promise<AccountDto> {
    const request = CreateAccountRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/accounts`, request)
    );

    return AccountResponseSchema.parse(response).account;
  }

  async listJournals(): Promise<JournalDto[]> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/journals`)
    );

    return ListJournalsResponseSchema.parse(response).data;
  }

  async createJournal(payload: CreateJournalRequest): Promise<JournalDto> {
    const request = CreateJournalRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/journals`, request)
    );
    const parsed = JournalResponseSchema.parse(response);

    if (!parsed.data && !parsed.journal) {
      throw new Error('Invalid journal response');
    }

    return (parsed.data ?? parsed.journal)!;
  }

  async listEntries(paramsInput: ListEntriesParams): Promise<PaginatedResult<EntrySummaryDto>> {
    let params = new HttpParams().set('year', paramsInput.year);

    if (paramsInput.journalCode) {
      params = params.set('journalCode', paramsInput.journalCode);
    }

    if (paramsInput.month) {
      params = params.set('month', paramsInput.month);
    }

    if (paramsInput.limit) {
      params = params.set('limit', paramsInput.limit);
    }

    if (paramsInput.cursor) {
      params = params.set('cursor', paramsInput.cursor);
    }

    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/entries`, { params })
    );
    const parsed = ListEntriesResponseSchema.parse(response);

    return {
      items: parsed.data.entries,
      nextCursor: parsed.data.nextCursor,
      hasMore: parsed.data.hasMore
    };
  }

  async postEntry(payload: CreateEntryRequest): Promise<string> {
    const request = CreateEntryRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/entries`, request)
    );

    return PostEntryResponseSchema.parse(response).entryId;
  }

  async getGeneralLedger(paramsInput: { fiscalYear: string; accountId: string }): Promise<GeneralLedgerDto> {
    const params = new HttpParams()
      .set('fiscalYear', paramsInput.fiscalYear)
      .set('accountId', paramsInput.accountId);
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/books/general-ledger`, { params })
    );

    return GeneralLedgerResponseSchema.parse(response).data;
  }

  async getTrialBalance(year: string): Promise<TrialBalanceDto> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/books/trial-balance`, {
        params: new HttpParams().set('year', year)
      })
    );

    return TrialBalanceResponseSchema.parse(response).data;
  }
}
