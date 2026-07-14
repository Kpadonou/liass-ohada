import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  CreateReconciliationRequestSchema,
  CreateTreasuryAccountRequestSchema,
  CreateTreasuryTransactionRequestSchema,
  ImportBankStatementRequestSchema,
  ImportBankStatementResponseSchema,
  ListBankStatementLinesResponseSchema,
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
  type ReconciliationMatchDto,
  type TreasuryAccountDto,
  type TreasuryMovementDto,
  type TreasurySummaryDto
} from '@liass-ohada/shared/treasury';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class TreasuryApi {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  async listAccounts(): Promise<TreasuryAccountDto[]> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/treasury/accounts`)
    );

    return ListTreasuryAccountsResponseSchema.parse(response).data.accounts;
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
    year: string
  ): Promise<BankStatementLineDto[]> {
    const response = await firstValueFrom(
      this.http.get<unknown>(
        `${this.apiBaseUrl}/treasury/accounts/${encodeURIComponent(treasuryAccountId)}/statement-lines`,
        { params: new HttpParams().set('year', year) }
      )
    );

    return ListBankStatementLinesResponseSchema.parse(response).data.statementLines;
  }

  async importStatementLines(
    treasuryAccountId: string,
    payload: ImportBankStatementRequest
  ): Promise<{
    imported: number;
    skipped: number;
    errors: { index: number; message: string }[];
    statementLines: BankStatementLineDto[];
  }> {
    const request = ImportBankStatementRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(
        `${this.apiBaseUrl}/treasury/accounts/${encodeURIComponent(treasuryAccountId)}/statement-lines/import`,
        request
      )
    );

    return ImportBankStatementResponseSchema.parse(response).data;
  }

  async reconcile(payload: CreateReconciliationRequest): Promise<ReconciliationMatchDto> {
    const request = CreateReconciliationRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/treasury/reconciliations`, request)
    );

    return ReconciliationMatchResponseSchema.parse(response).data;
  }

  async cancelReconciliation(payload: CancelReconciliationRequest): Promise<ReconciliationMatchDto> {
    const response = await firstValueFrom(
      this.http.post<unknown>(
        `${this.apiBaseUrl}/treasury/reconciliations/${encodeURIComponent(payload.matchId)}/cancel`,
        {
          treasuryAccountId: payload.treasuryAccountId,
          year: payload.year,
          matchId: payload.matchId
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
