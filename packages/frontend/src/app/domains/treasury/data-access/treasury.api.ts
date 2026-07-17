import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  CreateReconciliationRequestSchema,
  CreateTreasuryAccountRequestSchema,
  CreateTreasuryTransactionRequestSchema,
  ImportBankStatementRequestSchema,
  ImportBankStatementResponseSchema,
  ListBankStatementLinesRequestSchema,
  ListBankStatementLinesResponseSchema,
  ListReconciliationMatchesRequestSchema,
  ListReconciliationMatchesResponseSchema,
  ListTreasuryAccountsResponseSchema,
  ListTreasuryMovementsResponseSchema,
  ReconciliationMatchResponseSchema,
  TreasuryAccountResponseSchema,
  TreasurySummaryResponseSchema,
  TreasuryTransactionResponseSchema,
  type BankStatementLineDto,
  type CancelReconciliationRequest,
  type CreateReconciliationRequest,
  type CreateTreasuryAccountRequest,
  type CreateTreasuryTransactionRequest,
  type ImportBankStatementRequest,
  type ListBankStatementLinesRequest,
  type ListReconciliationMatchesRequest,
  type ReconciliationMatchDto,
  type TreasuryAccountDto,
  type TreasuryMovementDto,
  type TreasurySummaryDto
} from '@liass-ohada/shared/treasury';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';

export interface TreasuryAccountsResult {
  accounts: TreasuryAccountDto[];
  nextCursor?: string;
  hasMore: boolean;
  count: number;
}

export interface ListTreasuryAccountsParams {
  limit?: number;
  cursor?: string;
}

export type ListStatementLinesParams = Omit<ListBankStatementLinesRequest, 'treasuryAccountId'>;
export type ListReconciliationMatchesParams = Omit<ListReconciliationMatchesRequest, 'treasuryAccountId'>;

export interface BankStatementLinesResult {
  statementLines: BankStatementLineDto[];
  nextCursor?: string;
  hasMore: boolean;
  count: number;
}

export interface ImportStatementLinesResult {
  imported: number;
  skipped: number;
  rejected?: number;
  errors: { index: number; message: string }[];
  statementLines: BankStatementLineDto[];
}

export interface ReconciliationMatchesResult {
  matches: ReconciliationMatchDto[];
  nextCursor?: string;
  hasMore: boolean;
  count: number;
}

@Injectable({ providedIn: 'root' })
export class TreasuryApi {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  async listAccounts(options: ListTreasuryAccountsParams = {}): Promise<TreasuryAccountsResult> {
    let params = new HttpParams();

    if (options.limit) {
      params = params.set('limit', options.limit);
    }

    if (options.cursor) {
      params = params.set('cursor', options.cursor);
    }

    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/treasury/accounts`, { params })
    );
    const parsed = ListTreasuryAccountsResponseSchema.parse(response).data;

    return {
      accounts: parsed.accounts,
      nextCursor: parsed.nextCursor,
      hasMore: Boolean(parsed.hasMore && parsed.nextCursor),
      count: parsed.count ?? parsed.accounts.length
    };
  }

  async createAccount(payload: CreateTreasuryAccountRequest): Promise<TreasuryAccountDto> {
    const request = CreateTreasuryAccountRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/treasury/accounts`, request)
    );

    return TreasuryAccountResponseSchema.parse(response).data;
  }

  async listMovements(treasuryAccountId: string, year: string): Promise<TreasuryMovementDto[]> {
    const response = await firstValueFrom(
      this.http.get<unknown>(
        `${this.apiBaseUrl}/treasury/accounts/${encodeURIComponent(treasuryAccountId)}/movements`,
        { params: new HttpParams().set('year', year) }
      )
    );

    return ListTreasuryMovementsResponseSchema.parse(response).data.movements;
  }

  async postTransaction(payload: CreateTreasuryTransactionRequest): Promise<string> {
    const request = CreateTreasuryTransactionRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/treasury/transactions`, request)
    );

    return TreasuryTransactionResponseSchema.parse(response).data.entryId;
  }

  async listStatementLines(
    treasuryAccountId: string,
    options: ListStatementLinesParams
  ): Promise<BankStatementLinesResult> {
    const request = ListBankStatementLinesRequestSchema.parse({
      ...options,
      treasuryAccountId
    });
    let params = new HttpParams().set('year', request.year);

    if (request.limit) {
      params = params.set('limit', request.limit);
    }

    if (request.cursor) {
      params = params.set('cursor', request.cursor);
    }

    if (request.status) {
      params = params.set('status', request.status);
    }

    if (request.direction) {
      params = params.set('direction', request.direction);
    }

    if (request.startDate) {
      params = params.set('startDate', request.startDate);
    }

    if (request.endDate) {
      params = params.set('endDate', request.endDate);
    }

    const response = await firstValueFrom(
      this.http.get<unknown>(
        `${this.apiBaseUrl}/treasury/accounts/${encodeURIComponent(treasuryAccountId)}/statement-lines`,
        { params }
      )
    );
    const parsed = ListBankStatementLinesResponseSchema.parse(response).data;

    return {
      statementLines: parsed.statementLines,
      nextCursor: parsed.nextCursor,
      hasMore: Boolean(parsed.hasMore && parsed.nextCursor),
      count: parsed.count ?? parsed.statementLines.length
    };
  }

  async importStatementLines(
    treasuryAccountId: string,
    payload: ImportBankStatementRequest
  ): Promise<ImportStatementLinesResult> {
    const request = ImportBankStatementRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(
        `${this.apiBaseUrl}/treasury/accounts/${encodeURIComponent(treasuryAccountId)}/statement-lines/import`,
        request
      )
    );

    const parsed = ImportBankStatementResponseSchema.parse(response).data;

    return {
      imported: parsed.imported,
      skipped: parsed.skipped,
      rejected: parsed.rejected,
      errors: parsed.errors,
      statementLines: parsed.statementLines
    };
  }

  async reconcile(payload: CreateReconciliationRequest): Promise<ReconciliationMatchDto> {
    const request = CreateReconciliationRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/treasury/reconciliations`, request)
    );

    return ReconciliationMatchResponseSchema.parse(response).data;
  }

  async listReconciliationMatches(
    options: ListReconciliationMatchesRequest
  ): Promise<ReconciliationMatchesResult> {
    const request = ListReconciliationMatchesRequestSchema.parse(options);
    let params = new HttpParams()
      .set('treasuryAccountId', request.treasuryAccountId)
      .set('year', request.year);

    if (request.status) {
      params = params.set('status', request.status);
    }

    if (request.limit) {
      params = params.set('limit', request.limit);
    }

    if (request.cursor) {
      params = params.set('cursor', request.cursor);
    }

    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/treasury/reconciliations`, { params })
    );
    const parsed = ListReconciliationMatchesResponseSchema.parse(response).data;

    return {
      matches: parsed.matches,
      nextCursor: parsed.nextCursor,
      hasMore: Boolean(parsed.hasMore && parsed.nextCursor),
      count: parsed.count ?? parsed.matches.length
    };
  }

  async cancelReconciliation(payload: CancelReconciliationRequest): Promise<ReconciliationMatchDto> {
    const response = await firstValueFrom(
      this.http.post<unknown>(
        `${this.apiBaseUrl}/treasury/reconciliations/${encodeURIComponent(payload.matchId)}/cancel`,
        {
          treasuryAccountId: payload.treasuryAccountId,
          year: payload.year,
          matchId: payload.matchId,
          cancelReason: payload.cancelReason
        }
      )
    );

    return ReconciliationMatchResponseSchema.parse(response).data;
  }

  async getSummary(year: string): Promise<TreasurySummaryDto> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/treasury/summary`, {
        params: new HttpParams().set('year', year)
      })
    );

    return TreasurySummaryResponseSchema.parse(response).data;
  }
}
