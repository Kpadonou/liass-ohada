import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  AccountResponseSchema,
  CancelLetteringMatchRequestSchema,
  CancelLetteringRequestSchema,
  CloseFiscalYearRequestSchema,
  CloseFiscalYearResponseSchema,
  CreateAccountRequestSchema,
  CreateEntryRequestSchema,
  CreateFiscalYearRequestSchema,
  CreateJournalRequestSchema,
  CreateLetteringMatchRequestSchema,
  FiscalYearDetailsResponseSchema,
  FiscalYearResponseSchema,
  GeneralLedgerQuerySchema,
  GeneralLedgerResponseSchema,
  GetAccountRequestSchema,
  GetLetteringMatchRequestSchema,
  IncomeStatementResponseSchema,
  JournalResponseSchema,
  JournalBookQuerySchema,
  JournalBookResponseSchema,
  LetteringCandidatesQuerySchema,
  LetteringCandidatesResponseSchema,
  LetteringMatchResponseSchema,
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
  TrialBalanceQuerySchema,
  TrialBalanceResponseSchema,
  UnletteredLinesResponseSchema,
  UpdateAccountRequestSchema,
  type AccountDto,
  type CancelLetteringMatchRequest,
  type CancelLetteringRequest,
  type CloseFiscalYearResultDto,
  type CreateAccountRequest,
  type CreateEntryDraftRequest,
  type CreateEntryRequest,
  type CreateFiscalYearRequest,
  type CreateJournalRequest,
  type CreateLetteringMatchRequest,
  type EntryDetailDto,
  type EntrySummaryDto,
  type FiscalYearDetailsDto,
  type FiscalYearDto,
  type GeneralLedgerDto,
  type GeneralLedgerQuery,
  type IncomeStatementDto,
  type JournalDto,
  type JournalBookEntryDto,
  type JournalBookQuery,
  type JournalBookTotalsDto,
  type LetteringCandidatesDto,
  type LetteringCandidatesQuery,
  type LetteringMatchDto,
  type LetteringResultDto,
  type MatchingReportDto,
  type PeriodLockDto,
  type PostEntryDraftRequest,
  type PostLetteringRequest,
  type ThirdPartyLedgerDto,
  type TrialBalanceQuery,
  type UnletteredLinesDto,
  type TrialBalanceDto,
  type UpdateEntryDraftRequest
} from '@liass-ohada/shared/accounting';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';

import { type ApiMutationResult, userMessageFromResponse } from '../../../core/notifications/notification-message';
import { environment } from '../../../../environments/environment';

export interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
  message?: string | null;
}

export type ApiQueryResult<T> = T & { message?: string | null };
export type ListAccountsParams = z.input<typeof ListAccountsRequestSchema>;
export type GeneralLedgerParams = z.input<typeof GeneralLedgerQuerySchema>;
export type TrialBalanceParams = z.input<typeof TrialBalanceQuerySchema>;
export type JournalBookParams = z.input<typeof JournalBookQuerySchema>;
export type LetteringCandidatesParams = z.input<typeof LetteringCandidatesQuerySchema>;
export type UpdateAccountRequest = z.infer<typeof UpdateAccountRequestSchema>;
export type UpdateEntryDraftPayload = Omit<UpdateEntryDraftRequest, 'entryId'>;
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

const LegacyTrialBalanceAmountSchema = z.number().int().nonnegative();
const LegacyTrialBalanceRowSchema = z.object({
  accountId: z.string().regex(/^\d{8}$/),
  openingDebit: LegacyTrialBalanceAmountSchema,
  openingCredit: LegacyTrialBalanceAmountSchema,
  movementDebit: LegacyTrialBalanceAmountSchema,
  movementCredit: LegacyTrialBalanceAmountSchema,
  finalDebit: LegacyTrialBalanceAmountSchema,
  finalCredit: LegacyTrialBalanceAmountSchema
});
const LegacyTrialBalanceResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z.object({
    rows: z.array(LegacyTrialBalanceRowSchema),
    totals: LegacyTrialBalanceRowSchema.omit({ accountId: true })
  })
});

export interface ListEntriesParams {
  year: string;
  journalCode?: string;
  status?: EntrySummaryDto['status'];
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

export interface JournalBookResult extends PaginatedResult<JournalBookEntryDto> {
  meta: {
    year: string;
    startDate: string;
    endDate: string;
    journalCode?: string;
  };
  totals: JournalBookTotalsDto;
  integrityWarnings: Array<{ entryNumber: string; difference: number }>;
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

    if (request.search) {
      params = params.set('search', request.search);
    }

    if (request.class) {
      params = params.set('class', request.class);
    }

    if (request.active !== undefined) {
      params = params.set('active', request.active);
    }

    if (request.activeOnly !== undefined) {
      params = params.set('activeOnly', request.activeOnly);
    }

    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/accounts`, { params })
    );
    const parsed = ListAccountsResponseSchema.parse(response);

    return {
      items: parsed.data.items,
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

    if (paramsInput.status) {
      params = params.set('status', paramsInput.status);
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

  async getEntryDetail(entryId: string, year: string | number): Promise<EntryDetailDto> {
    const { EntryDetailResponseSchema } = await import('@liass-ohada/shared/accounting');
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/entries/${entryId}`, {
        params: new HttpParams().set('year', String(year))
      })
    );

    return EntryDetailResponseSchema.parse(response).data;
  }

  async createEntryDraft(payload: CreateEntryDraftRequest): Promise<ApiMutationResult<EntryDetailDto>> {
    const { CreateEntryDraftRequestSchema, EntryDraftResponseSchema } = await import('@liass-ohada/shared/accounting');
    const request = CreateEntryDraftRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/entries/drafts`, request)
    );
    const parsed = EntryDraftResponseSchema.parse(response);

    return { data: parsed.data, message: userMessageFromResponse(response) };
  }

  async updateEntryDraft(
    entryId: string,
    payload: UpdateEntryDraftPayload
  ): Promise<ApiMutationResult<EntryDetailDto>> {
    const { EntryDraftResponseSchema, UpdateEntryDraftRequestSchema } = await import('@liass-ohada/shared/accounting');
    const request = UpdateEntryDraftRequestSchema.parse({ ...payload, entryId });
    const { entryId: _entryId, ...body } = request;
    const response = await firstValueFrom(
      this.http.put<unknown>(`${this.apiBaseUrl}/entries/${entryId}/draft`, body)
    );
    const parsed = EntryDraftResponseSchema.parse(response);

    return { data: parsed.data, message: userMessageFromResponse(response) };
  }

  async deleteEntryDraft(entryId: string, year: string | number): Promise<ApiMutationResult<string>> {
    const { DeleteEntryDraftResponseSchema, PostEntryDraftRequestSchema } = await import('@liass-ohada/shared/accounting');
    const request = PostEntryDraftRequestSchema.parse({ entryId, year });
    const response = await firstValueFrom(
      this.http.delete<unknown>(`${this.apiBaseUrl}/entries/${request.entryId}/draft`, {
        body: { year: request.year }
      })
    );
    const parsed = DeleteEntryDraftResponseSchema.parse(response);

    return { data: parsed.entryId, message: userMessageFromResponse(response) };
  }

  async postEntryDraft(entryId: string, year: string | number): Promise<ApiMutationResult<string>> {
    const { PostEntryDraftRequestSchema } = await import('@liass-ohada/shared/accounting');
    const request: PostEntryDraftRequest = PostEntryDraftRequestSchema.parse({ entryId, year });
    const response = await firstValueFrom(
      this.http.post<unknown>(
        `${this.apiBaseUrl}/entries/${request.entryId}/post`,
        { year: request.year }
      )
    );
    const parsed = PostEntryResponseSchema.parse(response);

    return { data: parsed.entryId, message: userMessageFromResponse(response) };
  }

  async getGeneralLedger(paramsInput: GeneralLedgerParams): Promise<ApiQueryResult<GeneralLedgerDto>> {
    const request: GeneralLedgerQuery = GeneralLedgerQuerySchema.parse(paramsInput);
    let params = new HttpParams()
      .set('fiscalYear', request.fiscalYear)
      .set('accountId', request.accountId);

    if (request.limit) {
      params = params.set('limit', request.limit);
    }

    if (request.cursor) {
      params = params.set('cursor', request.cursor);
    }

    if (request.startDate) {
      params = params.set('startDate', request.startDate);
    }

    if (request.endDate) {
      params = params.set('endDate', request.endDate);
    }

    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/books/general-ledger`, { params })
    );
    const parsed = GeneralLedgerResponseSchema.parse(response);

    return {
      ...parsed.data,
      message: userMessageFromResponse(response)
    };
  }

  async getTrialBalance(paramsInput: TrialBalanceParams): Promise<ApiQueryResult<TrialBalanceDto>> {
    const request: TrialBalanceQuery = TrialBalanceQuerySchema.parse(paramsInput);
    let params = new HttpParams()
      .set('year', request.year)
      .set('startDate', request.startDate)
      .set('endDate', request.endDate)
      .set('hideZeroMovement', request.hideZeroMovement);

    if (request.accountPrefix) {
      params = params.set('accountPrefix', request.accountPrefix);
    }

    if (request.accountFrom) {
      params = params.set('accountFrom', request.accountFrom);
    }

    if (request.accountTo) {
      params = params.set('accountTo', request.accountTo);
    }

    if (request.accountClass) {
      params = params.set('accountClass', request.accountClass);
    }

    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/books/trial-balance`, {
        params
      })
    );
    const parsed = await parseTrialBalanceResponse(
      response,
      request,
      () => this.loadAllAccountLabels()
    );

    return {
      ...parsed.data,
      message: userMessageFromResponse(response)
    };
  }

  async getJournalBook(paramsInput: JournalBookParams): Promise<JournalBookResult> {
    const request: JournalBookQuery = JournalBookQuerySchema.parse(paramsInput);
    let params = new HttpParams()
      .set('year', request.year)
      .set('startDate', request.startDate)
      .set('endDate', request.endDate);

    for (const key of ['journalCode', 'entryNumber', 'reference', 'accountPrefix'] as const) {
      if (request[key]) {
        params = params.set(key, request[key]);
      }
    }

    if (request.limit) {
      params = params.set('limit', request.limit);
    }

    if (request.cursor) {
      params = params.set('cursor', request.cursor);
    }

    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/books/journal-book`, { params })
    );
    const parsed = JournalBookResponseSchema.parse(response);

    return {
      items: parsed.data.entries,
      meta: parsed.data.meta,
      totals: parsed.data.totals,
      integrityWarnings: parsed.data.integrityWarnings,
      nextCursor: parsed.data.nextCursor,
      hasMore: parsed.data.hasMore,
      message: userMessageFromResponse(response)
    };
  }

  async getCompleteJournalBook(
    paramsInput: Omit<JournalBookParams, 'cursor' | 'limit'>
  ): Promise<JournalBookResult> {
    const items: JournalBookEntryDto[] = [];
    let cursor: string | undefined;
    let page: JournalBookResult;

    do {
      page = await this.getJournalBook({
        ...paramsInput,
        limit: 200,
        ...(cursor ? { cursor } : {})
      });
      items.push(...page.items);
      cursor = page.hasMore ? page.nextCursor : undefined;
    } while (cursor);

    return { ...page!, items, nextCursor: undefined, hasMore: false };
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

  async getLetteringCandidates(paramsInput: LetteringCandidatesParams): Promise<LetteringCandidatesDto> {
    const request = LetteringCandidatesQuerySchema.parse(paramsInput);
    let params = new HttpParams()
      .set('fiscalYear', String(request.fiscalYear))
      .set('accountId', request.accountId)
      .set('thirdPartyId', request.thirdPartyId)
      .set('thirdPartyType', request.thirdPartyType)
      .set('limit', String(request.limit ?? 50));

    if (request.dateFrom) {
      params = params.set('dateFrom', request.dateFrom);
    }

    if (request.dateTo) {
      params = params.set('dateTo', request.dateTo);
    }

    if (request.cursor) {
      params = params.set('cursor', request.cursor);
    }

    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/lettering/candidates`, { params })
    );

    return LetteringCandidatesResponseSchema.parse(response).data;
  }

  async createLetteringMatch(payload: CreateLetteringMatchRequest): Promise<ApiMutationResult<LetteringMatchDto>> {
    const request = CreateLetteringMatchRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/lettering/matches`, request)
    );
    const parsed = LetteringMatchResponseSchema.parse(response);

    return { data: parsed.data, message: userMessageFromResponse(response) };
  }

  async getLetteringMatch(fiscalYear: string | number, letteringId: string): Promise<LetteringMatchDto> {
    const request = GetLetteringMatchRequestSchema.parse({ fiscalYear, letteringId });
    const params = new HttpParams().set('fiscalYear', String(request.fiscalYear));
    const response = await firstValueFrom(
      this.http.get<unknown>(
        `${this.apiBaseUrl}/lettering/matches/${encodeURIComponent(request.letteringId)}`,
        { params }
      )
    );

    return LetteringMatchResponseSchema.parse(response).data;
  }

  async cancelLetteringMatch(payload: CancelLetteringMatchRequest): Promise<ApiMutationResult<LetteringMatchDto>> {
    const request = CancelLetteringMatchRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(
        `${this.apiBaseUrl}/lettering/matches/${encodeURIComponent(request.letteringId)}/cancel`,
        {
          fiscalYear: request.fiscalYear,
          ...(request.cancellationReason ? { cancellationReason: request.cancellationReason } : {})
        }
      )
    );
    const parsed = LetteringMatchResponseSchema.parse(response);

    return { data: parsed.data, message: userMessageFromResponse(response) };
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

  private async loadAllAccountLabels(): Promise<Map<string, string>> {
    const labels = new Map<string, string>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    do {
      const page = await this.listAccounts({
        limit: 200,
        ...(cursor ? { cursor } : {})
      });

      for (const account of page.items) {
        labels.set(account.accountId, account.accountName);
      }

      cursor = page.hasMore ? page.nextCursor : undefined;
      if (cursor) {
        if (seenCursors.has(cursor)) {
          throw new Error('Invalid account pagination cursor cycle');
        }
        seenCursors.add(cursor);
      }
    } while (cursor);

    return labels;
  }
}

async function parseTrialBalanceResponse(
  response: unknown,
  request: TrialBalanceQuery,
  loadAccountLabels: () => Promise<Map<string, string>>
) {
  const canonical = TrialBalanceResponseSchema.safeParse(response);

  if (canonical.success) {
    return canonical.data;
  }

  // Rolling-deployment compatibility for the previous annual-only endpoint.
  // Never accept this shape for a partial period or account filters because
  // the legacy backend ignores those parameters and would return a false scope.
  if (!isLegacyAnnualRequest(request)) {
    throw canonical.error;
  }

  const legacy = LegacyTrialBalanceResponseSchema.parse(response);
  const accountLabels = await loadAccountLabels();
  const rows = legacy.data.rows
    .map((row) => {
      const openingNet = row.openingDebit - row.openingCredit;
      const closingNet =
        openingNet + row.movementDebit - row.movementCredit;

      return {
        accountCode: row.accountId,
        accountLabel: accountLabels.get(row.accountId) ?? '—',
        openingDebit: Math.max(openingNet, 0),
        openingCredit: Math.max(-openingNet, 0),
        movementDebit: row.movementDebit,
        movementCredit: row.movementCredit,
        closingDebit: Math.max(closingNet, 0),
        closingCredit: Math.max(-closingNet, 0)
      };
    })
    .sort((left, right) => left.accountCode.localeCompare(right.accountCode));
  const totals = rows.reduce(
    (result, row) => ({
      openingDebit: result.openingDebit + row.openingDebit,
      openingCredit: result.openingCredit + row.openingCredit,
      movementDebit: result.movementDebit + row.movementDebit,
      movementCredit: result.movementCredit + row.movementCredit,
      closingDebit: result.closingDebit + row.closingDebit,
      closingCredit: result.closingCredit + row.closingCredit
    }),
    {
      openingDebit: 0,
      openingCredit: 0,
      movementDebit: 0,
      movementCredit: 0,
      closingDebit: 0,
      closingCredit: 0
    }
  );
  const movementDifference = totals.movementDebit - totals.movementCredit;
  const closingDifference = totals.closingDebit - totals.closingCredit;

  return TrialBalanceResponseSchema.parse({
    message: legacy.message,
    data: {
      rows,
      totals: {
        ...totals,
        isMovementBalanced: movementDifference === 0,
        isClosingBalanced: closingDifference === 0,
        movementDifference,
        closingDifference
      },
      period: {
        fiscalYear: request.year,
        startDate: request.startDate,
        endDate: request.endDate
      }
    }
  });
}

function isLegacyAnnualRequest(request: TrialBalanceQuery): boolean {
  return (
    request.startDate === `${request.year}-01-01` &&
    request.endDate === `${request.year}-12-31` &&
    !request.accountPrefix &&
    !request.accountFrom &&
    !request.accountTo &&
    !request.accountClass &&
    !request.hideZeroMovement
  );
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
