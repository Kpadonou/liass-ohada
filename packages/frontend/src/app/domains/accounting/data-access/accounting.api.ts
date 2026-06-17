import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  AccountResponseSchema,
  CancelLetteringRequestSchema,
  CloseFiscalYearRequestSchema,
  CloseFiscalYearResponseSchema,
  CreateAccountRequestSchema,
  CreateEntryRequestSchema,
  CreateFiscalYearRequestSchema,
  CreateJournalRequestSchema,
  FiscalYearDetailsResponseSchema,
  FiscalYearResponseSchema,
  GeneralLedgerResponseSchema,
  GetAccountRequestSchema,
  IncomeStatementResponseSchema,
  JournalResponseSchema,
  ListAccountsRequestSchema,
  ListAccountsResponseSchema,
  ListEntriesResponseSchema,
  ListJournalsResponseSchema,
  LetteringResponseSchema,
  MatchingReportResponseSchema,
  PeriodLockResponseSchema,
  PostEntryResponseSchema,
  PostLetteringRequestSchema,
  ThirdPartyLedgerResponseSchema,
  TrialBalanceResponseSchema,
  UnletteredLinesResponseSchema,
  UpdateAccountRequestSchema,
  type AccountDto,
  type CancelLetteringRequest,
  type CloseFiscalYearResultDto,
  type CreateAccountRequest,
  type CreateEntryRequest,
  type CreateFiscalYearRequest,
  type CreateJournalRequest,
  type EntrySummaryDto,
  type FiscalYearDetailsDto,
  type FiscalYearDto,
  type GeneralLedgerDto,
  type IncomeStatementDto,
  type JournalDto,
  type LetteringResultDto,
  type MatchingReportDto,
  type PeriodLockDto,
  type PostLetteringRequest,
  type ThirdPartyLedgerDto,
  type UnletteredLinesDto,
  type TrialBalanceDto
} from '@liass-ohada/shared/accounting';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';

import { type ApiMutationResult, userMessageFromResponse } from '../../../core/notifications/notification-message';
import { environment } from '../../../../environments/environment';

export interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}

export type ListAccountsParams = z.input<typeof ListAccountsRequestSchema>;
export type UpdateAccountRequest = z.infer<typeof UpdateAccountRequestSchema>;
export type UpdateJournalRequest = z.infer<typeof UpdateJournalRequestSchema>;

const GetJournalRequestSchema = z.object({
  journalCode: z.string().min(1).max(10)
});

const UpdateJournalRequestSchema = z.object({
  year: z.number().int().optional(),
  journalName: z.string().min(1),
  type: CreateJournalRequestSchema.shape.type
});

const DisableJournalResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z.object({}).optional()
});

export interface ListEntriesParams {
  year: string;
  journalCode?: string;
  month?: string;
  limit?: number;
  cursor?: string;
}

export interface ThirdPartyLedgerParams {
  accountId: string;
  thirdPartyId: string;
  startDate?: string;
  endDate?: string;
}

export interface MatchingReportParams {
  accountId: string;
  thirdPartyId: string;
}

export interface UnletteredLinesParams {
  accountId: string;
  thirdPartyId: string;
  projectId?: string;
}

@Injectable({ providedIn: 'root' })
export class AccountingApi {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  async listAccounts(options: ListAccountsParams = {}): Promise<PaginatedResult<AccountDto>> {
    const request = ListAccountsRequestSchema.parse(options);
    let params = new HttpParams();

    if (request.limit) {
      params = params.set('limit', request.limit);
    }

    if (request.cursor) {
      params = params.set('cursor', request.cursor);
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

  async getAccount(accountId: string): Promise<AccountDto> {
    const response = await firstValueFrom(
      this.http.get<unknown>(this.accountUrl(accountId))
    );

    return AccountResponseSchema.parse(response).account;
  }

  async createAccount(payload: CreateAccountRequest): Promise<ApiMutationResult<AccountDto>> {
    const request = CreateAccountRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/accounts`, request)
    );
    const parsed = AccountResponseSchema.parse(response);

    return { data: parsed.account, message: userMessageFromResponse(response) };
  }

  async updateAccount(accountId: string, payload: UpdateAccountRequest): Promise<ApiMutationResult<AccountDto>> {
    const request = UpdateAccountRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.put<unknown>(this.accountUrl(accountId), request)
    );
    const parsed = AccountResponseSchema.parse(response);

    return { data: parsed.account, message: userMessageFromResponse(response) };
  }

  async disableAccount(accountId: string): Promise<ApiMutationResult<AccountDto>> {
    const response = await firstValueFrom(
      this.http.delete<unknown>(this.accountUrl(accountId))
    );
    const parsed = AccountResponseSchema.parse(response);

    return { data: parsed.account, message: userMessageFromResponse(response) };
  }

  async listJournals(): Promise<JournalDto[]> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/journals`)
    );

    return ListJournalsResponseSchema.parse(response).data;
  }

  async getJournal(journalCode: string): Promise<JournalDto> {
    const response = await firstValueFrom(
      this.http.get<unknown>(this.journalUrl(journalCode))
    );

    return parseJournalResponse(response);
  }

  async createJournal(payload: CreateJournalRequest): Promise<ApiMutationResult<JournalDto>> {
    const request = CreateJournalRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/journals`, request)
    );

    return parseJournalMutationResponse(response);
  }

  async updateJournal(journalCode: string, payload: UpdateJournalRequest): Promise<ApiMutationResult<JournalDto>> {
    const request = UpdateJournalRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.put<unknown>(this.journalUrl(journalCode), request)
    );

    return parseJournalMutationResponse(response);
  }

  async disableJournal(journalCode: string): Promise<ApiMutationResult<void>> {
    const response = await firstValueFrom(
      this.http.delete<unknown>(this.journalUrl(journalCode))
    );

    DisableJournalResponseSchema.parse(response);

    return { data: undefined, message: userMessageFromResponse(response) };
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

  async createFiscalYear(payload: CreateFiscalYearRequest): Promise<ApiMutationResult<FiscalYearDto>> {
    const request = CreateFiscalYearRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/fiscal-year`, request)
    );
    const parsed = FiscalYearResponseSchema.parse(response);

    return { data: parsed.data, message: userMessageFromResponse(response) };
  }

  async getFiscalYearDetails(year: string | number): Promise<FiscalYearDetailsDto> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/fiscal-year/${year}`)
    );

    return FiscalYearDetailsResponseSchema.parse(response).data;
  }

  async lockPeriod(year: number, month: number): Promise<ApiMutationResult<PeriodLockDto>> {
    const request = { year, month, status: 'LOCKED' as const };
    const response = await firstValueFrom(
      this.http.post<unknown>(
        `${this.apiBaseUrl}/fiscal-year/${year}/lock`,
        request
      )
    );
    const parsed = PeriodLockResponseSchema.parse(response);

    return { data: parsed.data, message: userMessageFromResponse(response) };
  }

  async unlockPeriod(year: number, month: number): Promise<ApiMutationResult<PeriodLockDto>> {
    const response = await firstValueFrom(
      this.http.post<unknown>(
        `${this.apiBaseUrl}/fiscal-year/${year}/unlock`,
        { year, month }
      )
    );
    const parsed = PeriodLockResponseSchema.parse(response);

    return { data: parsed.data, message: userMessageFromResponse(response) };
  }

  async closeFiscalYear(year: string | number): Promise<CloseFiscalYearResultDto> {
    const request = CloseFiscalYearRequestSchema.parse({ year: String(year) });
    const response = await firstValueFrom(
      this.http.post<unknown>(
        `${this.apiBaseUrl}/fiscal-year/${request.year}/close`,
        request
      )
    );

    return CloseFiscalYearResponseSchema.parse(response).data;
  }

  async getIncomeStatement(year: string | number): Promise<IncomeStatementDto> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/reports/income-statement`, {
        params: new HttpParams().set('year', String(year))
      })
    );

    return IncomeStatementResponseSchema.parse(response).data;
  }

  async getThirdPartyLedger(paramsInput: ThirdPartyLedgerParams): Promise<ThirdPartyLedgerDto> {
    let params = new HttpParams()
      .set('accountId', paramsInput.accountId)
      .set('thirdPartyId', paramsInput.thirdPartyId);

    if (paramsInput.startDate) {
      params = params.set('startDate', paramsInput.startDate);
    }

    if (paramsInput.endDate) {
      params = params.set('endDate', paramsInput.endDate);
    }

    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/books/third-party-ledger`, { params })
    );

    return ThirdPartyLedgerResponseSchema.parse(response).data;
  }

  async getMatchingReport(paramsInput: MatchingReportParams): Promise<MatchingReportDto> {
    const params = new HttpParams()
      .set('accountId', paramsInput.accountId)
      .set('thirdPartyId', paramsInput.thirdPartyId);
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/books/matching-report`, { params })
    );

    return MatchingReportResponseSchema.parse(response).data;
  }

  async getUnletteredLines(paramsInput: UnletteredLinesParams): Promise<UnletteredLinesDto> {
    let params = new HttpParams()
      .set('accountId', paramsInput.accountId)
      .set('thirdPartyId', paramsInput.thirdPartyId);

    if (paramsInput.projectId) {
      params = params.set('projectId', paramsInput.projectId);
    }

    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/lettering/unlettered`, { params })
    );

    return UnletteredLinesResponseSchema.parse(response);
  }

  async postLettering(payload: PostLetteringRequest): Promise<LetteringResultDto> {
    const request = PostLetteringRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/lettering`, request)
    );

    return LetteringResponseSchema.parse(response);
  }

  async cancelLettering(payload: CancelLetteringRequest): Promise<LetteringResultDto> {
    const request = CancelLetteringRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/lettering/cancel`, request)
    );

    return LetteringResponseSchema.parse(response);
  }

  private accountUrl(accountId: string): string {
    const request = GetAccountRequestSchema.parse({ accountId });

    return `${this.apiBaseUrl}/accounts/${encodeURIComponent(request.accountId)}`;
  }

  private journalUrl(journalCode: string): string {
    const request = GetJournalRequestSchema.parse({ journalCode });

    return `${this.apiBaseUrl}/journals/${encodeURIComponent(request.journalCode)}`;
  }
}

function parseJournalResponse(response: unknown): JournalDto {
  const parsed = JournalResponseSchema.parse(response);
  const journal = parsed.data ?? parsed.journal;

  if (!journal) {
    throw new Error('Invalid journal response');
  }

  return journal;
}

function parseJournalMutationResponse(response: unknown): ApiMutationResult<JournalDto> {
  return {
    data: parseJournalResponse(response),
    message: userMessageFromResponse(response)
  };
}
