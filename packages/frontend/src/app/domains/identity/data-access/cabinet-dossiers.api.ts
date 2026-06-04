import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  CabinetDossierSummary,
  CreateCabinetDossierRequest,
  CreateCabinetDossierResponse
} from '@liass-ohada/shared/shared';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class CabinetDossiersApi {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  async listDossiers(): Promise<CabinetDossierSummary[]> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/cabinet/dossiers`)
    );
    const { ListCabinetDossiersResponseSchema } = await import('@liass-ohada/shared/shared');

    return ListCabinetDossiersResponseSchema.parse(response).dossiers;
  }

  async createDossier(
    payload: CreateCabinetDossierRequest
  ): Promise<CreateCabinetDossierResponse> {
    const { CreateCabinetDossierRequestSchema, CreateCabinetDossierResponseSchema } =
      await import('@liass-ohada/shared/shared');
    const request = CreateCabinetDossierRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/cabinet/dossiers`, request)
    );

    return CreateCabinetDossierResponseSchema.parse(response);
  }
}
